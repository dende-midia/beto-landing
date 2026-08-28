import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('A senha precisa ter pelo menos 10 caracteres.');
  }
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function verifyPassword(password, salt, storedHash) {
  try {
    const computed = scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHash, 'hex');
    return stored.length === computed.length && timingSafeEqual(stored, computed);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeJson(value) {
  return JSON.stringify(value ?? {});
}
