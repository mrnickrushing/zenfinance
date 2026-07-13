import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

function loadLocalEnv(): void {
  for (const candidate of [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
  ]) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
    }
    return;
  }
}

loadLocalEnv();

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
  ADMIN_URL: z.string().url().default('http://localhost:5174'),
  SENTRY_DSN: z.string().optional(),
  REVENUECAT_IOS_API_KEY: z.string().optional(),
  REVENUECAT_SECRET_API_KEY: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  REVENUECAT_WEBHOOK_SIGNING_SECRET: z.string().optional(),
  REVENUECAT_ENTITLEMENT_ID: z.string().default('zen_coach'),
  REVENUECAT_MONTHLY_PRODUCT_ID: z.string().default('com.rushingtechnologies.zenfinance.coach.monthly'),
  REVENUECAT_ANNUAL_PRODUCT_ID: z.string().default('com.rushingtechnologies.zenfinance.coach.annual'),
}).superRefine((value, ctx) => {
  const requireProduction = (key: keyof typeof value, message: string) => {
    if (value.NODE_ENV === 'production' && !value[key]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
    }
  };

  requireProduction('REDIS_URL', 'REDIS_URL is required in production');
  requireProduction('RESEND_API_KEY', 'RESEND_API_KEY is required in production');
  requireProduction('RESEND_FROM_EMAIL', 'RESEND_FROM_EMAIL is required in production');
  requireProduction('REVENUECAT_WEBHOOK_AUTH', 'REVENUECAT_WEBHOOK_AUTH is required in production');
  requireProduction('REVENUECAT_WEBHOOK_SIGNING_SECRET', 'REVENUECAT_WEBHOOK_SIGNING_SECRET is required in production');

  if (value.NODE_ENV === 'production' && value.FRONTEND_URL.includes('localhost')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FRONTEND_URL'], message: 'FRONTEND_URL must not default to localhost in production' });
  }
  if (value.NODE_ENV === 'production' && value.ADMIN_URL.includes('localhost')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ADMIN_URL'], message: 'ADMIN_URL must not default to localhost in production' });
  }

  if (value.NODE_ENV === 'production' && value.TRANSACTION_PROVIDER === 'plaid') {
    if (!value.PLAID_CLIENT_ID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PLAID_CLIENT_ID'], message: 'PLAID_CLIENT_ID is required when TRANSACTION_PROVIDER=plaid' });
    }
    if (!value.PLAID_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PLAID_SECRET'], message: 'PLAID_SECRET is required when TRANSACTION_PROVIDER=plaid' });
    }
  }

  if (
    value.NODE_ENV === 'production' &&
    (value.ENRICHMENT_PROVIDER === 'anthropic' || value.INSIGHT_PROVIDER === 'anthropic') &&
    !value.ANTHROPIC_API_KEY
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ANTHROPIC_API_KEY'], message: 'ANTHROPIC_API_KEY is required when an Anthropic provider is enabled' });
  }
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
