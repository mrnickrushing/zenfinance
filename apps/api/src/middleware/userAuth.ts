import type { NextFunction, Request, Response } from 'express';
import { verifyUserAccessToken } from '../lib/userTokens.js';

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing bearer token' } });
    return;
  }
  try {
    res.locals.userId = verifyUserAccessToken(header.slice('Bearer '.length));
    next();
  } catch {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } });
  }
}
