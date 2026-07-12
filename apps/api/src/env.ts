import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ADMIN_SECRET: z.string().min(32, 'ADMIN_SECRET must be at least 32 characters'),
  TOKEN_ENC_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'TOKEN_ENC_KEY must be 64 hex chars (32 bytes)'),
  TRANSACTION_PROVIDER: z.enum(['plaid', 'mock']).default('plaid'),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  APPLE_BUNDLE_ID: z.string().optional(),
  REDIS_URL: z.string().optional(),
  ENRICHMENT_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ENRICHMENT_MODEL: z.string().default('claude-haiku-4-5'),
  // The coaching brief is reasoning-quality-sensitive, so it runs on Sonnet
  // (PLAN §3), separate from the high-volume Haiku enrichment model. 'mock'
  // uses the deterministic template generator — no API key required.
  INSIGHT_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
  INSIGHT_MODEL: z.string().default('claude-sonnet-5'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  SUPPORT_EMAIL: z.string().email().default('support@rushingtechnologies.com'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  SENTRY_DSN: z.string().optional(),
  REVENUECAT_IOS_API_KEY: z.string().optional(),
  REVENUECAT_SECRET_API_KEY: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  REVENUECAT_WEBHOOK_SIGNING_SECRET: z.string().optional(),
  REVENUECAT_ENTITLEMENT_ID: z.string().default('zen_coach'),
  REVENUECAT_MONTHLY_PRODUCT_ID: z.string().default('com.rushingtechnologies.zenfinance.coach.monthly'),
  REVENUECAT_ANNUAL_PRODUCT_ID: z.string().default('com.rushingtechnologies.zenfinance.coach.annual'),
});

export type Env = z.infer<typeof envSchema>;

// Fail closed: the process refuses to start with missing/weak secrets rather
// than falling back to a default the way `process.env.X || "dev"` would.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — refusing to start. ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
