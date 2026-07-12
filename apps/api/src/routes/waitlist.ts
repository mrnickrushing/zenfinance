import { waitlistSignupSchema, type WaitlistSignupInput } from '@zenfinance/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { waitlistSignups } from '../db/schema.js';
import { validateBody } from '../middleware/validate.js';

export function createWaitlistRouter(): ReturnType<typeof Router> {
  const waitlistRouter = Router();

  const waitlistLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests, try again later' } },
  });

  waitlistRouter.post(
    '/api/waitlist',
    waitlistLimiter,
    validateBody(waitlistSignupSchema),
    async (_req, res) => {
      const input = res.locals.body as WaitlistSignupInput;
      const [row] = await db
        .insert(waitlistSignups)
        .values({ email: input.email, source: input.source ?? null })
        .onConflictDoNothing({ target: waitlistSignups.email })
        .returning({ id: waitlistSignups.id });

      // Duplicate signups get the same success response — no email enumeration.
      res.status(row ? 201 : 200).json({ ok: true });
    },
  );

  return waitlistRouter;
}
