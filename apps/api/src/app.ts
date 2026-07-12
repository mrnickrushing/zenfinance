import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';
import { createLinkRouter } from './routes/link.js';
import { createSupportRouter } from './routes/support.js';
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
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.use(createHealthRouter());
  app.use(createWaitlistRouter());
  app.use(createSupportRouter());
  app.use(createAdminRouter());
  app.use(createAuthRouter());
  app.use(createLinkRouter());
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
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
