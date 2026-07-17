import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
// Express 4 does not forward a rejected promise from an `async (req, res) =>
// {}` handler to the error middleware below — it silently drops it, so the
// request never gets a response and the client hangs until its own timeout.
// This patches Router/Route to catch those rejections and call next(err).
import 'express-async-errors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createBillingRouter } from './routes/billing.js';
import { createCoachingRouter } from './routes/coaching.js';
import { createContentRouter } from './routes/content.js';
import { createFreelancerRouter } from './routes/freelancer.js';
import { createGoalsRouter } from './routes/goals.js';
import { createHealthRouter } from './routes/health.js';
import { createHouseholdsRouter } from './routes/households.js';
import { createLinkRouter } from './routes/link.js';
import { createMobileRouter } from './routes/mobile.js';
import { createMoneyPhysicalRouter } from './routes/moneyPhysical.js';
import { createPlaidOauthRouter } from './routes/plaidOauth.js';
import { createPrivacyRouter } from './routes/privacy.js';
import { createReferralsRouter } from './routes/referrals.js';
import { createSupportRouter } from './routes/support.js';
import { createTransactionsRouter } from './routes/transactions.js';
import { createVoiceBriefsRouter } from './routes/voiceBriefs.js';
import { createWaitlistRouter } from './routes/waitlist.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { safeErrorSummary } from './lib/safeError.js';

interface HttpBodyError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1); // Railway terminates TLS in front of us
  app.use(helmet());
  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? [env.FRONTEND_URL, env.ADMIN_URL] : true,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    }),
  );
  app.use(
    express.json({
      limit: '128kb',
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());
  // Financial and session responses must not be retained by browser, proxy,
  // or device HTTP caches. Public marketing assets are served elsewhere.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(createHealthRouter());
  app.use(createPlaidOauthRouter());
  app.use(createWaitlistRouter());
  app.use(createSupportRouter());
  app.use(createContentRouter());
  app.use(createAdminRouter());
  app.use(createAuthRouter());
  app.use(createBillingRouter());
  app.use(createLinkRouter());
  app.use(createTransactionsRouter());
  app.use(createGoalsRouter());
  app.use(createCoachingRouter());
  app.use(createFreelancerRouter());
  app.use(createHouseholdsRouter());
  app.use(createVoiceBriefsRouter());
  app.use(createMoneyPhysicalRouter());
  app.use(createMobileRouter());
  app.use(createPrivacyRouter());
  app.use(createReferralsRouter());
  app.use(createWebhooksRouter());

  // The marketing site and admin console are static SPAs deployed to
  // Cloudflare Workers (zenfinance.rushingtechnologies.com and
  // admin.zenfinance.rushingtechnologies.com) — this API only serves /api/*.
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  // Central error handler: consistent shape, no stack traces to clients.
  app.use((err: HttpBodyError, req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
      res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
      return;
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON request body' } });
      return;
    }
    if (err.status === 415 || err.statusCode === 415) {
      res.status(415).json({ error: { code: 'unsupported_media_type', message: 'Unsupported request encoding' } });
      return;
    }
    const summary = safeErrorSummary(err);
    console.error('[api] unhandled error:', summary);
    Sentry.captureException(err, {
      tags: { route: req.path, method: req.method },
      extra: { providerStatus: summary.providerStatus, providerError: summary.providerError },
    });
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
