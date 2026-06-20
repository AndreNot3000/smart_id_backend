import crypto from 'crypto';

function getKey(): Buffer {
  const key = process.env.MFA_ENCRYPTION_KEY || '';
  if (key.length < 32) {
    // In dev we allow a deterministic fallback; in production you MUST set MFA_ENCRYPTION_KEY.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_ENCRYPTION_KEY must be set (32+ chars) for MFA');
    }
    const fallback = process.env.JWT_SECRET || 'dev-jwt-secret-dev-jwt-secret-dev-jwt-secret';
    return crypto.createHash('sha256').update(fallback).digest();
  }
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.ciphertext (base64url)
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptString(packed: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = packed.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Invalid encrypted payload');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ctB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

