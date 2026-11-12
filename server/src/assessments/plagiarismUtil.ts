import { codeHash, codeTokens, shingles } from './compare';

export function codeShingles(code: string) {
  const tokens = codeTokens(code);
  return { hash: codeHash(code), shingles: shingles(tokens), tokenCount: tokens.length };
}
