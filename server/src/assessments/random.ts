import crypto from 'node:crypto';

/** mulberry32 PRNG: tiny, deterministic, good enough for shuffling. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(seed: number | string, salt: string): number {
  return crypto.createHash('sha256').update(`${seed}:${salt}`).digest().readUInt32BE(0);
}

/** Deterministic Fisher-Yates; the same (seed, salt, input) always gives the same order. */
export function seededShuffle<T>(items: T[], seed: number | string, salt: string): T[] {
  const out = items.slice();
  const rnd = prng(hashSeed(seed, salt));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const newSeed = () => crypto.randomInt(1, 2 ** 31 - 1);
