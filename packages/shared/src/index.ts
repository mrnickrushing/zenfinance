import { z } from 'zod';

// ---------- Waitlist ----------

export const waitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().trim().max(100).optional(),
});
export type WaitlistSignupInput = z.infer<typeof waitlistSignupSchema>;

// ---------- Support ----------

export const supportRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  message: z.string().trim().min(10).max(5000),
});
export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

export const supportStatusSchema = z.enum(['open', 'resolved']);
export type SupportStatus = z.infer<typeof supportStatusSchema>;

// ---------- Admin ----------

export const adminLoginSchema = z.object({
  secret: z.string().min(1).max(512),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const supportUpdateSchema = z.object({
  status: supportStatusSchema,
});
export type SupportUpdateInput = z.infer<typeof supportUpdateSchema>;

// ---------- API response shapes ----------

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface WaitlistEntry {
  id: number;
  email: string;
  source: string | null;
  createdAt: string;
}

export interface SupportTicket {
  id: number;
  name: string;
  email: string;
  message: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMetrics {
  waitlist: {
    total: number;
    last7Days: number;
    last30Days: number;
    dailySignups: Array<{ date: string; count: number }>;
  };
  support: {
    total: number;
    open: number;
    resolved: number;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- User auth (Phase 1) ----------

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(1024),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const appleAuthSchema = z.object({
  identityToken: z.string().min(1).max(8192),
  rawNonce: z.string().min(1).max(512),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
export type AppleAuthInput = z.infer<typeof appleAuthSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ---------- Linking (Phase 1) ----------

export const linkExchangeSchema = z.object({
  publicToken: z.string().min(1).max(2048),
  institutionName: z.string().trim().max(200).optional(),
});
export type LinkExchangeInput = z.infer<typeof linkExchangeSchema>;

export interface LinkedAccount {
  id: number;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  isoCurrency: string;
}

export interface LinkedItem {
  id: number;
  provider: string;
  institutionName: string | null;
  status: 'active' | 'login_required' | 'disconnected';
  lastSyncedAt: string | null;
  accounts: LinkedAccount[];
}

export interface TransactionView {
  id: number;
  accountId: number;
  amountCents: number;
  isoCurrency: string;
  postedDate: string;
  name: string;
  merchantName: string | null;
  pending: boolean;
  transferPairId: string | null;
}
