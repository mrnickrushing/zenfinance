import { env } from '../env.js';

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * In-memory outbox used under NODE_ENV=test (or EMAIL_PROVIDER=memory) so tests
 * can assert what would have been sent without hitting Resend. Never populated
 * in production.
 */
export const sentEmails: SentEmail[] = [];

function useMemoryTransport(): boolean {
  return env.NODE_ENV === 'test' || process.env.EMAIL_PROVIDER === 'memory';
}

async function deliver(to: string, subject: string, text: string): Promise<boolean> {
  if (useMemoryTransport()) {
    sentEmails.push({ to, subject, text });
    return true;
  }
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn('[email] RESEND_API_KEY/RESEND_FROM_EMAIL not set; email not sent');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: `ZenFinance <${env.RESEND_FROM_EMAIL}>`, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status} sending "${subject}"`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] failed to send "${subject}":`, err);
    return false;
  }
}

/** Email a single-use password reset code. */
export async function sendPasswordResetEmail(to: string, code: string): Promise<boolean> {
  return deliver(
    to,
    'Your ZenFinance password reset code',
    `Your ZenFinance password reset code is ${code}.\n\n` +
      `It expires in 15 minutes. If you didn't request a reset, you can safely ignore this email.`,
  );
}

export interface SupportEmailInput {
  ticketId: number;
  name: string;
  email: string;
  message: string;
}

/**
 * Deliver a support ticket to the support inbox via Resend.
 * Callers must persist the ticket BEFORE calling this — an email failure
 * must never lose the ticket, so this function only logs on failure.
 */
export async function sendSupportEmail(input: SupportEmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn('[email] RESEND_API_KEY/RESEND_FROM_EMAIL not set; ticket stored but not emailed');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `ZenFinance Support <${env.RESEND_FROM_EMAIL}>`,
        to: [env.SUPPORT_EMAIL],
        reply_to: input.email,
        subject: `[ZenFinance] Support ticket #${input.ticketId} from ${input.name}`,
        text: `Ticket #${input.ticketId}\nFrom: ${input.name} <${input.email}>\n\n${input.message}`,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status} for ticket #${input.ticketId}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] failed to send ticket #${input.ticketId}:`, err);
    return false;
  }
}
