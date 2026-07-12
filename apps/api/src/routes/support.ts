import { supportRequestSchema, type SupportRequestInput } from '@zenfinance/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { supportRequests } from '../db/schema.js';
import { sendSupportEmail } from '../lib/email.js';
import { validateBody } from '../middleware/validate.js';

export function createSupportRouter(): ReturnType<typeof Router> {
  const supportRouter = Router();

  const supportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests, try again later' } },
  });

  supportRouter.post(
    '/api/support',
    supportLimiter,
    validateBody(supportRequestSchema),
    async (_req, res) => {
      const input = res.locals.body as SupportRequestInput;

      // DB first — the ticket must survive an email outage.
      const [ticket] = await db
        .insert(supportRequests)
        .values({ name: input.name, email: input.email, message: input.message })
        .returning({ id: supportRequests.id });

      const emailed = await sendSupportEmail({ ticketId: ticket!.id, ...input });

      res.status(201).json({ ok: true, ticketId: ticket!.id, emailed });
    },
  );

  return supportRouter;
}
