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
