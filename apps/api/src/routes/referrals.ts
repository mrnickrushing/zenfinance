import { referralRedeemSchema, type ReferralRedeemInput } from '@zenfinance/shared';
import { Router } from 'express';
import { getBillingStatus } from '../billing/service.js';
import { db } from '../db/client.js';
import { getReferralStatus, redeemReferralCode } from '../referrals/service.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

export function createReferralsRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/referrals/me', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    res.json(await getReferralStatus(db, userId));
  });

  router.post('/api/referrals/redeem', requireUser, validateBody(referralRedeemSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as ReferralRedeemInput;
    try {
      const referral = await redeemReferralCode(db, userId, input.code);
      res.json({ ok: true, referral, billing: await getBillingStatus(db, userId) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to redeem referral code';
      res.status(message.includes('not found') ? 404 : 400).json({
        error: { code: 'referral_redeem_failed', message },
      });
    }
  });

  return router;
}
