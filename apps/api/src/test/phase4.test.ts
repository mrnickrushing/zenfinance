import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';
import { db } from '../db/client.js';
import { billingEntitlements, featureRollups, users } from '../db/schema.js';

let app: Express;

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

async function registerAndLink(email: string): Promise<{ access: string }> {
  const auth = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(auth.status).toBe(201);
  const access = auth.body.accessToken as string;
  const link = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: 'mock-public-token', institutionName: 'Mock Bank' });
  expect(link.status).toBe(201);
  return { access };
}

async function grantPremium(email: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  await db.insert(billingEntitlements).values({
    userId: user!.id,
    entitlementId: 'zen_coach',
    status: 'active',
    plan: 'monthly',
    productId: 'com.rushingtechnologies.zenfinance.coach.monthly',
    environment: 'SANDBOX',
    source: 'manual_test',
  });
}

describe('Phase 4 mobile product API', () => {
  it('returns a complete mobile home summary', async () => {
    const { access } = await registerAndLink('mobile-home@example.com');
    await grantPremium('mobile-home@example.com');
    const res = await request(app).get('/api/mobile/home').set('Authorization', `Bearer ${access}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.transactionCount).toBeGreaterThan(0);
    expect(res.body.firstLook.headline).toBeTruthy();
    expect(Array.isArray(res.body.goals)).toBe(true);
    expect(res.body.subscriptionAudit.totalMonthlyCents).toBeGreaterThan(0);
    expect(Array.isArray(res.body.recentTransactions)).toBe(true);
  });

  it('answers chat questions using scoped transaction data', async () => {
    const { access } = await registerAndLink('chat@example.com');
    await grantPremium('chat@example.com');
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'How much did I spend on Netflix in the last 90 days?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('$');
    expect(res.body.facts[0].source).toBe('transaction_query');
    expect(res.body.actions.length).toBeGreaterThan(0);
  });

  it('answers the goal and budget prompts shown by the iOS coach', async () => {
    const email = 'chat-prompts@example.com';
    const { access } = await registerAndLink(email);
    await grantPremium(email);
    await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 300000, currentAmountCents: 50000, targetDate: '2027-12-31' });

    const goal = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Am I on pace for my top goal?' });
    expect(goal.status).toBe(201);
    expect(goal.body.answer).toContain('Emergency fund');
    expect(goal.body.facts.some((fact: { source: string }) => fact.source === 'goal')).toBe(true);

    const budget = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Help me set a new budget limit.' });
    expect(budget.status).toBe(201);
    expect(budget.body.answer).not.toContain('could not safely tailor');
    expect(budget.body.actions.length).toBeGreaterThan(0);

    const explicitLimit = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Set a $100 spending limit.' });
    expect(explicitLimit.status).toBe(201);
    expect(explicitLimit.body.answer).toContain('$100.00');
    expect(explicitLimit.body.actions.some((action: string) => action.includes('$100.00'))).toBe(true);

    const accelerated = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'What would move my goal up by two weeks?' });
    expect(accelerated.status).toBe(201);
    expect(accelerated.body.answer).toContain('2 weeks');
    expect(accelerated.body.answer).toContain('weekly savings');
  });

  it('streams chat answers over server-sent events', async () => {
    const { access } = await registerAndLink('chat-stream@example.com');
    await grantPremium('chat-stream@example.com');
    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Can I afford $600?' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('event: done');
  });

  it('runs deterministic what-if simulations without model arithmetic', async () => {
    const { access } = await registerAndLink('whatif@example.com');
    await grantPremium('whatif@example.com');
    const [whatIfUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'whatif@example.com')).limit(1);
    await db.delete(featureRollups).where(eq(featureRollups.userId, whatIfUser!.id));
    await db.insert(featureRollups).values([
      { aggregateId: 'whatif:income', userId: whatIfUser!.id, weekStart: '2026-07-13', metric: 'income_total', valueCents: 100000 },
      { aggregateId: 'whatif:spend', userId: whatIfUser!.id, weekStart: '2026-07-13', metric: 'total_spend', valueCents: 50000 },
    ]);
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 300000, currentAmountCents: 50000 });
    expect(goal.status).toBe(201);

    const res = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, forecastStartMonth: '2026-07-01', monthlySavingsCents: 20000, oneTimeSavingsCents: 25000 });

    expect(res.status).toBe(200);
    expect(res.body.monthlySavingsCents).toBe(20000);
    expect(res.body.weeklyNetChangeCents).toBe(0);
    expect(res.body.projections[0].remainingAmountCents).toBe(225000);
    expect(res.body.projections[0].plannedMonthsToGoal).toBe(12);
    expect(res.body.forecastStartMonth).toBe('2026-07-01');
    expect(res.body.projections[0].plannedCompletionMonth).toBe('2027-06-01');
    expect(res.body.narration).toContain('each month starting');
    expect(res.body.narration).toContain('1 year');

    const missingGoal = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ monthlySavingsCents: 20000 });
    expect(missingGoal.status).toBe(400);

    const fundedAtStart = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, forecastStartMonth: '2026-09-01', monthlySavingsCents: 20000, oneTimeSavingsCents: 250000 });
    expect(fundedAtStart.status).toBe(200);
    expect(fundedAtStart.body.projections[0].plannedMonthsToGoal).toBe(0);
    expect(fundedAtStart.body.narration).toContain('fully funded in September 2026');

    const distantGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Distant goal', targetAmountCents: 100000000 });
    expect(distantGoal.status).toBe(201);
    const distantForecast = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: distantGoal.body.id, forecastStartMonth: '2026-07-01', monthlySavingsCents: 1 });
    expect(distantForecast.status).toBe(200);
    expect(distantForecast.body.projections[0].plannedMonthsToGoal).toBe(100000000);
    expect(distantForecast.body.projections[0].plannedCompletionMonth).toBeNull();
    expect(distantForecast.body.narration).toContain('outside the supported calendar range');

    const setback = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlyIncomeChangeCents: -300000 });

    expect(setback.status).toBe(200);
    expect(setback.body.weeklyNetChangeCents).toBeLessThan(0);
    expect(setback.body.narration).toContain('reduces weekly cash flow');
    expect(setback.body.projections[0].currentProjectedCompletionDate).not.toBeNull();
    expect(setback.body.projections[0].simulatedProjectedCompletionDate).toBeNull();
    expect(setback.body.projections[0].timelineChangeWeeks).toBeNull();
    expect(setback.body.narration).toContain('no longer has a projected completion date');
  });

  it('builds an explainable monthly budget around a savings goal and every detected bill', async () => {
    const email = 'budget-plan@example.com';
    const { access } = await registerAndLink(email);
    const [budgetUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 500000, currentAmountCents: 100000 });
    expect(goal.status).toBe(201);

    const gated = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: 50000, planMonth: '2026-07-01' });
    expect(gated.status).toBe(402);

    await grantPremium(email);
    await db.delete(featureRollups).where(eq(featureRollups.userId, budgetUser!.id));
    await db.insert(featureRollups).values([
      { aggregateId: 'budget:income:1', userId: budgetUser!.id, weekStart: '2026-07-06', metric: 'income_total', valueCents: 100000 },
      { aggregateId: 'budget:groceries:1', userId: budgetUser!.id, weekStart: '2026-07-06', metric: 'category_spend', category: 'GROCERIES', valueCents: 20000 },
      { aggregateId: 'budget:dining:1', userId: budgetUser!.id, weekStart: '2026-07-06', metric: 'category_spend', category: 'RESTAURANTS_AND_DINING', valueCents: 10000 },
      { aggregateId: 'budget:income:2', userId: budgetUser!.id, weekStart: '2026-07-13', metric: 'income_total', valueCents: 100000 },
      { aggregateId: 'budget:groceries:2', userId: budgetUser!.id, weekStart: '2026-07-13', metric: 'category_spend', category: 'GROCERIES', valueCents: 20000 },
      { aggregateId: 'budget:dining:2', userId: budgetUser!.id, weekStart: '2026-07-13', metric: 'category_spend', category: 'RESTAURANTS_AND_DINING', valueCents: 10000 },
    ]);

    const plan = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: 50000, planMonth: '2026-07-01' });
    expect(plan.status).toBe(200);
    expect(plan.body.planMonth).toBe('2026-07-01');
    expect(plan.body.goal.name).toBe('Emergency fund');
    expect(plan.body.goal.plannedSavingsCents).toBe(50000);
    expect(plan.body.monthlyIncomeCents).toBe(433333);
    expect(plan.body.dataCoverage.weeksAnalyzed).toBe(2);
    expect(plan.body.dataCoverage.detectedBillCount).toBeGreaterThan(0);
    expect(plan.body.dataCoverage.allDetectedBillsIncluded).toBe(true);
    expect(plan.body.bills).toHaveLength(plan.body.dataCoverage.detectedBillCount);
    expect(plan.body.recurringBillsTotalCents).toBe(
      plan.body.bills.reduce((sum: number, bill: { monthlyEquivalentCents: number }) => sum + bill.monthlyEquivalentCents, 0),
    );
    expect(['ready', 'tight']).toContain(plan.body.status);
    expect(plan.body.recommendedSpendingCents + plan.body.goal.plannedSavingsCents + plan.body.bufferCents).toBe(plan.body.monthlyIncomeCents);
    expect(plan.body.categories.some((category: { category: string }) => category.category === 'GROCERIES')).toBe(true);
    expect(plan.body.explanation).toContain('detected recurring bill');

    const detectedBill = plan.body.bills.find((bill: { recurringStreamId: number | null }) => bill.recurringStreamId !== null);
    expect(detectedBill).toBeDefined();
    const adjustedPlan = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({
        goalId: goal.body.id,
        monthlySavingsCents: 80000,
        planMonth: '2026-07-01',
        monthlyIncomeOverrideCents: 600000,
        targetBufferCents: 25000,
        billOverrides: [{ recurringStreamId: detectedBill.recurringStreamId, included: false, monthlyEquivalentCents: detectedBill.monthlyEquivalentCents }],
        customBills: [{ clientId: 'manual-openai', merchantClean: 'OpenAI', monthlyEquivalentCents: 2000, category: 'SUBSCRIPTIONS_AND_STREAMING', cadence: 'monthly' }],
        categoryOverrides: [{ category: 'GROCERIES', recommendedCents: 60000 }],
      });
    expect(adjustedPlan.status).toBe(200);
    expect(adjustedPlan.body.monthlyIncomeCents).toBe(600000);
    expect(adjustedPlan.body.adjustments.incomeSource).toBe('user');
    expect(adjustedPlan.body.adjustments.detectedMonthlyIncomeCents).toBe(433333);
    expect(adjustedPlan.body.adjustments.targetBufferCents).toBe(25000);
    expect(adjustedPlan.body.adjustments.billOverrideCount).toBe(1);
    expect(adjustedPlan.body.adjustments.customBillCount).toBe(1);
    expect(adjustedPlan.body.dataCoverage.allDetectedBillsIncluded).toBe(false);
    expect(adjustedPlan.body.bills.some((bill: { merchantClean: string; source: string }) => bill.merchantClean === 'OpenAI' && bill.source === 'user')).toBe(true);
    expect(adjustedPlan.body.categories.find((category: { category: string }) => category.category === 'GROCERIES')?.recommendedCents).toBe(60000);

    const stretchGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Home deposit', targetAmountCents: 1000000 });
    expect(stretchGoal.status).toBe(201);
    const shortfall = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: stretchGoal.body.id, monthlySavingsCents: 500000, planMonth: '2026-07-01' });
    expect(shortfall.status).toBe(200);
    expect(shortfall.body.status).toBe('shortfall');
    expect(shortfall.body.shortfallCents).toBeGreaterThan(
      Math.max(0, shortfall.body.goal.plannedSavingsCents + shortfall.body.recurringBillsTotalCents - shortfall.body.monthlyIncomeCents),
    );

    const savingsLeavingOneDollar = plan.body.monthlyIncomeCents - plan.body.recurringBillsTotalCents - 100;
    const essentialShortfall = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: savingsLeavingOneDollar, planMonth: '2026-07-01' });
    expect(essentialShortfall.status).toBe(200);
    expect(essentialShortfall.body.availableAfterGoalAndBillsCents).toBe(100);
    expect(essentialShortfall.body.status).toBe('shortfall');
    expect(essentialShortfall.body.shortfallCents).toBeGreaterThan(0);

    const missingGoal = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: 999999, monthlySavingsCents: 50000, planMonth: '2026-07-01' });
    expect(missingGoal.status).toBe(404);

    await db.delete(featureRollups).where(eq(featureRollups.userId, budgetUser!.id));
    const withoutIncome = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: 50000, planMonth: '2026-07-01' });
    expect(withoutIncome.status).toBe(200);
    expect(withoutIncome.body.status).toBe('needs_income');
    expect(withoutIncome.body.dataCoverage.hasIncomeData).toBe(false);

    await db.insert(featureRollups).values({
      aggregateId: 'budget:income:zero',
      userId: budgetUser!.id,
      weekStart: '2026-07-13',
      metric: 'income_total',
      valueCents: 0,
    });
    const zeroIncome = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: 50000, planMonth: '2026-07-01' });
    expect(zeroIncome.status).toBe(200);
    expect(zeroIncome.body.monthlyIncomeCents).toBe(0);
    expect(zeroIncome.body.dataCoverage.hasIncomeData).toBe(true);
    expect(zeroIncome.body.status).toBe('shortfall');
  });

  it('models monthly income across twelve weeks so older monthly pay is not dropped', async () => {
    const email = 'budget-income-horizon@example.com';
    const { access } = await registerAndLink(email);
    await grantPremium(email);
    const [budgetUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Income horizon', targetAmountCents: 500000 });
    expect(goal.status).toBe(201);

    await db.delete(featureRollups).where(eq(featureRollups.userId, budgetUser!.id));
    const weekStarts = [
      '2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18',
      '2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15',
      '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13',
    ];
    await db.insert(featureRollups).values(weekStarts.map((weekStart, index) => ({
      aggregateId: `budget:horizon:${weekStart}`,
      userId: budgetUser!.id,
      weekStart,
      metric: 'income_total',
      valueCents: index === 0 ? 300000 : 0,
    })));

    const plan = await request(app)
      .post('/api/budget/plan')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySavingsCents: 10000, planMonth: '2026-07-01' });
    expect(plan.status).toBe(200);
    expect(plan.body.dataCoverage.weeksAnalyzed).toBe(12);
    expect(plan.body.monthlyIncomeCents).toBe(108333);
  });

  it('persists push token and per-type notification preferences', async () => {
    const { access } = await registerAndLink('notifications@example.com');

    const token = await request(app)
      .post('/api/push-tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ token: 'ExponentPushToken[phase4-test-token]', platform: 'ios' });
    expect(token.status).toBe(201);
    expect(token.body.pushEnabled).toBe(true);

    const prefs = await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${access}`)
      .send({ weeklyBrief: true, anomalies: false, goalPacing: true, marketing: false });
    expect(prefs.status).toBe(200);
    expect(prefs.body.anomalies).toBe(false);

    const after = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${access}`);
    expect(after.body.pushEnabled).toBe(true);
    expect(after.body.weeklyBrief).toBe(true);
    expect(after.body.anomalies).toBe(false);

    const unregistered = await request(app)
      .delete('/api/push-tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ token: 'ExponentPushToken[phase4-test-token]', platform: 'ios' });
    expect(unregistered.status).toBe(204);
    const disabled = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${access}`);
    expect(disabled.body.pushEnabled).toBe(false);
  });

  it('records app funnel events', async () => {
    const { access } = await registerAndLink('events@example.com');
    const res = await request(app)
      .post('/api/app-events')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'onboarding:linked_bank', properties: { source: 'test' } });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});
