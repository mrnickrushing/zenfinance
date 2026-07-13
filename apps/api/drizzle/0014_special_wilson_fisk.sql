DROP INDEX "txn_enrich_current_idx";--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "transaction_id"
		ORDER BY "created_at" DESC, "id" DESC
	) AS "position"
	FROM "transaction_enrichments"
	WHERE "superseded_at" IS NULL
)
UPDATE "transaction_enrichments"
SET "superseded_at" = now()
FROM ranked
WHERE "transaction_enrichments"."id" = ranked."id"
	AND ranked."position" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "txn_enrich_one_current_idx" ON "transaction_enrichments" USING btree ("transaction_id") WHERE "transaction_enrichments"."superseded_at" is null;
