import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accounts, categoryCorrections, items, transactionEnrichments, transactions } from '../db/schema.js';
import { computeRollupsForWeek, mondayOf } from '../features/rollup.js';
import { isIncomeTransaction } from '../finance/classify.js';
import { detectRecurringStreams } from '../recurring/detect.js';
import { isValidCategory } from './categories.js';
import { recordAiUsage } from './cost.js';
import {
  cleanMerchantName,
  knownSubscriptionMerchant,
  merchantKey as computeMerchantKey,
} from './textNormalize.js';
import type { EnrichmentInput, EnrichmentProvider, FewShotExample } from './types.js';

const BATCH_SIZE = 75;
const FEW_SHOT_LIMIT = 15;

interface EnrichmentWrite {
  category: string;
  merchantClean: string;
  isRecurring: boolean;
  isDiscretionary: boolean;
  confidence: number;
  source: 'llm' | 'fallback' | 'user_correction';
  model: string | null;
}

interface ExpectedCurrentEnrichment {
  id: number | null;
  source: EnrichmentWrite['source'] | null;
}

/**
 * Supersede-then-insert, mirroring the pending→posted append-friendly
 * pattern already used on `transactions`: re-categorizing never destroys
 * history, it just marks the prior enrichment row superseded.
 */
export async function applyEnrichment(
  db: Db,
  transactionId: number,
  write: EnrichmentWrite,
  expectedCurrent?: ExpectedCurrentEnrichment,
): Promise<boolean> {
  const category = isValidCategory(write.category) ? write.category : 'OTHER';
  let applied = false;
  await db.transaction(async (tx) => {
    // Serialize writers for this transaction. The partial unique index is the
    // final invariant; this lock prevents two workers from both superseding
    // and then racing to insert the next current row.
    await tx.execute(sql`select id from ${transactions} where id = ${transactionId} for update`);
    if (expectedCurrent) {
      const [current] = await tx
        .select({ id: transactionEnrichments.id, source: transactionEnrichments.source })
        .from(transactionEnrichments)
        .where(
          and(
            eq(transactionEnrichments.transactionId, transactionId),
            isNull(transactionEnrichments.supersededAt),
          ),
        )
        .limit(1);
      if (
        (current?.id ?? null) !== expectedCurrent.id ||
        (current?.source ?? null) !== expectedCurrent.source ||
        current?.source === 'user_correction'
      ) {
        return;
      }
    }
    await tx
      .update(transactionEnrichments)
      .set({ supersededAt: new Date() })
      .where(and(eq(transactionEnrichments.transactionId, transactionId), isNull(transactionEnrichments.supersededAt)));
    await tx.insert(transactionEnrichments).values({
      transactionId,
      category,
      merchantClean: write.merchantClean,
      isRecurring: write.isRecurring,
      isDiscretionary: write.isDiscretionary,
      confidence: write.confidence,
      source: write.source,
      model: write.model,
    });
    applied = true;
  });
  return applied;
}

async function getFewShotExamples(db: Db, userId: number): Promise<FewShotExample[]> {
  const rows = await db
    .select({
      merchantKey: categoryCorrections.merchantKey,
      category: categoryCorrections.correctedCategory,
      isDiscretionary: categoryCorrections.correctedIsDiscretionary,
    })
    .from(categoryCorrections)
    .where(eq(categoryCorrections.userId, userId))
    .orderBy(desc(categoryCorrections.createdAt))
    .limit(100);

  const seen = new Set<string>();
  const examples: FewShotExample[] = [];
  for (const row of rows) {
    if (seen.has(row.merchantKey)) continue;
    seen.add(row.merchantKey);
    examples.push(row);
    if (examples.length >= FEW_SHOT_LIMIT) break;
  }
  return examples;
}

async function repairMisclassifiedIncome(
  db: Db,
  userId: number,
  correctedMerchantKeys: ReadonlySet<string>,
): Promise<Set<string>> {
  const rows = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantName: transactions.merchantName,
      providerCategory: transactions.providerCategory,
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      transferPairId: transactions.transferPairId,
      accountType: accounts.type,
      accountSubtype: accounts.subtype,
      enrichmentId: transactionEnrichments.id,
      enrichmentSource: transactionEnrichments.source,
      isRecurring: transactionEnrichments.isRecurring,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .innerJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(
      and(
        eq(items.userId, userId),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        eq(transactions.pending, false),
        lt(transactions.amountCents, 0),
        ne(transactionEnrichments.category, 'INCOME'),
        inArray(transactionEnrichments.source, ['llm', 'fallback']),
      ),
    );

  const repairedWeeks = new Set<string>();
  for (const row of rows) {
    if (correctedMerchantKeys.has(computeMerchantKey(row.name, row.merchantName))) continue;
    if (!isIncomeTransaction(row)) continue;
    const applied = await applyEnrichment(db, row.id, {
      category: 'INCOME',
      merchantClean: cleanMerchantName(row.name, row.merchantName),
      isRecurring: row.isRecurring,
      isDiscretionary: false,
      confidence: 0.99,
      source: 'fallback',
      model: null,
    }, {
      id: row.enrichmentId,
      source: row.enrichmentSource,
    });
    if (applied) repairedWeeks.add(row.postedDate);
  }
  return repairedWeeks;
}

async function repairMisclassifiedSubscriptions(
  db: Db,
  userId: number,
  correctedMerchantKeys: ReadonlySet<string>,
): Promise<Set<string>> {
  const rows = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantName: transactions.merchantName,
      postedDate: transactions.postedDate,
      enrichmentId: transactionEnrichments.id,
      enrichmentSource: transactionEnrichments.source,
      category: transactionEnrichments.category,
      merchantClean: transactionEnrichments.merchantClean,
      isRecurring: transactionEnrichments.isRecurring,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .innerJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(
      and(
        eq(items.userId, userId),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        eq(transactions.pending, false),
        gt(transactions.amountCents, 0),
        inArray(transactionEnrichments.source, ['llm', 'fallback']),
        or(
          ne(transactionEnrichments.category, 'SUBSCRIPTIONS_AND_STREAMING'),
          eq(transactionEnrichments.isRecurring, false),
        ),
      ),
    );

  const repairedWeeks = new Set<string>();
  for (const row of rows) {
    const knownSubscription = knownSubscriptionMerchant(row.name, row.merchantName);
    if (!knownSubscription) continue;
    if (correctedMerchantKeys.has(computeMerchantKey(row.name, row.merchantName))) continue;
    if (
      row.category === 'SUBSCRIPTIONS_AND_STREAMING' &&
      row.isRecurring &&
      row.merchantClean === knownSubscription.displayName
    ) {
      continue;
    }
    const applied = await applyEnrichment(db, row.id, {
      category: 'SUBSCRIPTIONS_AND_STREAMING',
      merchantClean: knownSubscription.displayName,
      isRecurring: true,
      isDiscretionary: true,
      confidence: 0.99,
      source: 'fallback',
      model: null,
    }, {
      id: row.enrichmentId,
      source: row.enrichmentSource,
    });
    if (applied) repairedWeeks.add(row.postedDate);
  }
  return repairedWeeks;
}

/**
 * Batch-enrich every un-enriched, non-pending transaction for a user (PLAN
 * §4 Stage 2): categorize, clean the merchant name, flag recurring/
 * discretionary, all with per-user few-shot correction context. Runs
 * recurring-stream detection afterward since it depends on merchant cleanup.
 */
export async function enrichUserTransactions(
  db: Db,
  provider: EnrichmentProvider,
  userId: number,
): Promise<void> {
  const fewShot = await getFewShotExamples(db, userId);
  const fewShotByMerchantKey = new Map(fewShot.map((example) => [example.merchantKey, example]));
  const correctedMerchantKeys = new Set(fewShotByMerchantKey.keys());
  const repairedIncomeDates = await repairMisclassifiedIncome(db, userId, correctedMerchantKeys);
  const repairedSubscriptionDates = await repairMisclassifiedSubscriptions(db, userId, correctedMerchantKeys);
  const repairedDates = new Set([...repairedIncomeDates, ...repairedSubscriptionDates]);
  const rows = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantName: transactions.merchantName,
      providerCategory: transactions.providerCategory,
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      accountType: accounts.type,
      accountSubtype: accounts.subtype,
      transferPairId: transactions.transferPairId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .leftJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(
      and(
        eq(items.userId, userId),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        eq(transactions.pending, false),
        isNull(transactionEnrichments.id),
      ),
    );

  if (rows.length === 0) {
    for (const postedDate of repairedDates) {
      await computeRollupsForWeek(db, userId, mondayOf(new Date(`${postedDate}T00:00:00Z`)));
    }
    // Detection also canonicalizes older billing descriptors, so run it even
    // when this sync did not add a new transaction or repair a category.
    await detectRecurringStreams(db, userId);
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inputs: EnrichmentInput[] = batch.map((t) => ({
      transactionId: t.id,
      name: t.name,
      merchantName: t.merchantName,
      providerCategory: t.providerCategory,
      amountCents: t.amountCents,
      postedDate: t.postedDate,
      accountType: t.accountType,
      accountSubtype: t.accountSubtype,
      transferPairId: t.transferPairId,
    }));

    const { results, usage } = await provider.enrichBatch(inputs, fewShot);
    const byId = new Map(results.map((r) => [r.transactionId, r]));

    for (const input of inputs) {
      const result = byId.get(input.transactionId);
      const learnedCorrection = fewShotByMerchantKey.get(computeMerchantKey(input.name, input.merchantName));
      const knownSubscription = input.amountCents > 0
        ? knownSubscriptionMerchant(input.name, input.merchantName)
        : null;
      const forceIncome = !learnedCorrection && isIncomeTransaction(input) && result?.category !== 'INCOME';
      if (!result && !forceIncome && !learnedCorrection && !knownSubscription) continue;
      const normalized = learnedCorrection
        ? {
            transactionId: input.transactionId,
            category: learnedCorrection.category,
            merchantClean: cleanMerchantName(input.name, input.merchantName),
            isRecurring: result?.isRecurring ?? false,
            isDiscretionary: learnedCorrection.isDiscretionary,
            confidence: 0.99,
            source: 'llm' as const,
          }
        : knownSubscription
        ? {
            transactionId: input.transactionId,
            category: 'SUBSCRIPTIONS_AND_STREAMING',
            merchantClean: knownSubscription.displayName,
            isRecurring: true,
            isDiscretionary: true,
            confidence: 0.99,
            source: 'fallback' as const,
          }
        : forceIncome
        ? {
            transactionId: input.transactionId,
            category: 'INCOME',
            merchantClean: cleanMerchantName(input.name, input.merchantName),
            isRecurring: result?.isRecurring ?? false,
            isDiscretionary: false,
            confidence: 0.99,
            source: 'fallback' as const,
          }
        : result!;
      await applyEnrichment(
        db,
        input.transactionId,
        { ...normalized, model: forceIncome ? null : provider.model },
        { id: null, source: null },
      );
    }

    if (usage) {
      await recordAiUsage(db, {
        userId,
        purpose: 'enrichment',
        model: provider.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    }
  }

  for (const postedDate of repairedDates) {
    await computeRollupsForWeek(db, userId, mondayOf(new Date(`${postedDate}T00:00:00Z`)));
  }
  await detectRecurringStreams(db, userId);
}
