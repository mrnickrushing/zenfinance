import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { env } from '../env.js';

const APPLE_ISSUER = 'https://appleid.apple.com';

let defaultJwks: JWTVerifyGetKey | null = null;
function appleJwks(): JWTVerifyGetKey {
  defaultJwks ??= createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  return defaultJwks;
}

export interface AppleIdentity {
  sub: string;
  email?: string;
}

/**
 * Verify an Apple Sign-In identity token per house rules: JWKS signature,
 * issuer, audience (bundle id), and the client's raw nonce hashed with SHA-256
 * against the token's nonce claim.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  jwks: JWTVerifyGetKey = appleJwks(),
): Promise<AppleIdentity> {
  if (!env.APPLE_BUNDLE_ID) throw new Error('APPLE_BUNDLE_ID not configured');

  const { payload } = await jwtVerify(identityToken, jwks, {
    issuer: APPLE_ISSUER,
    audience: env.APPLE_BUNDLE_ID,
  });

  const expectedNonce = crypto.createHash('sha256').update(rawNonce).digest('hex');
  if (payload.nonce !== expectedNonce) throw new Error('nonce mismatch');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('missing subject');
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}
