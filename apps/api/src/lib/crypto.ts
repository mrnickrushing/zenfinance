import crypto from 'node:crypto';
import { env } from '../env.js';

// App-layer encryption for provider access tokens (on top of disk encryption).
// AES-256-GCM with a random IV per value; format: v1:<iv>:<authTag>:<ciphertext> (base64url).

function key(): Buffer {
  const k = Buffer.from(env.TOKEN_ENC_KEY, 'hex');
  if (k.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes of hex (64 hex chars)');
  return k;
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptToken(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unrecognized encrypted token format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
