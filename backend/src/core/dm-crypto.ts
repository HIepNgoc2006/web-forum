import crypto from 'node:crypto';

/**
 * AES-256-GCM encryption for direct-message bodies at rest.
 * Key material: DM_ENCRYPTION_KEY, else JWT_SECRET, else a dev-only fallback
 * (never used in production — createForumService / server startup should
 * prefer an explicit secret).
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export function resolveDmEncryptionSecret(explicit?: string): string {
  const fromEnv = String(explicit || process.env.DM_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DM encryption requires DM_ENCRYPTION_KEY or JWT_SECRET in production');
  }
  return 'dev-dm-encryption-key-not-for-production';
}

export function dmEncryptionKey(secret?: string): Buffer {
  return crypto.createHash('sha256').update(resolveDmEncryptionSecret(secret)).digest();
}

export type EncryptedDmPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptDmBody(plaintext: string, secret?: string): EncryptedDmPayload {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, dmEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptDmBody(payload: EncryptedDmPayload, secret?: string): string {
  const decipher = crypto.createDecipheriv(
    ALGO,
    dmEncryptionKey(secret),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
