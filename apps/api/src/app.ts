import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
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
import { createPrivacyRouter } from './routes/privacy.js';
import { createReferralsRouter } from './routes/referrals.js';
import { createSupportRouter } from './routes/support.js';
import { createTransactionsRouter } from './routes/transactions.js';
import { createWaitlistRouter } from './routes/waitlist.js';
import { createWebhooksRouter } from './routes/webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1); // Railway terminates TLS in front of us
  app.use(helmet());
  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? env.FRONTEND_URL : true,
      credentials: true,
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

  app.use(createHealthRouter());
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
  app.use(createMobileRouter());
  app.use(createPrivacyRouter());
  app.use(createReferralsRouter());
  app.use(createWebhooksRouter());

  // Serve the built site (marketing/support/admin pages) in production.
  const siteDist = path.resolve(__dirname, '../../site/dist');
  app.use(express.static(siteDist));
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    res.sendFile(path.join(siteDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  // Central error handler: consistent shape, no stack traces to clients.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', err);
    Sentry.captureException(err, {
      tags: { route: req.path, method: req.method },
    });
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
