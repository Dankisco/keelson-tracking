import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto - no native dependency, and
 * memory-hard, which bcrypt is not. Format: scrypt$N$r$p$salt$hash, all hex.
 */
const N = 16384;   // CPU/memory cost
const R = 8;       // block size
const P = 1;       // parallelisation
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('hex'), hash.toString('hex')].join('$');
}

export function checkPassword(stored, password) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length,
                              { N: Number(n), r: Number(r), p: Number(p) });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
