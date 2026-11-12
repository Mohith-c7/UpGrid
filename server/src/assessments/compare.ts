import crypto from 'node:crypto';

export interface CompareOptions { mode?: 'tokens' | 'lines'; floatTolerance?: number }

const nl = (s: string) => s.replace(/\r\n?/g, '\n');
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function outputsMatch(actual: string, expected: string, opt: CompareOptions = {}): boolean {
  const a = nl(actual ?? '');
  const e = nl(expected ?? '');
  const tol = opt.floatTolerance;
  if (opt.mode === 'lines') {
    const norm = (s: string) => {
      const ls = s.split('\n').map((l) => l.replace(/\s+$/, ''));
      while (ls.length && ls[ls.length - 1] === '') ls.pop();
      return ls;
    };
    const la = norm(a); const le = norm(e);
    if (la.length !== le.length) return false;
    return la.every((l, i) => l === le[i] || (tol !== undefined && tokensEqual(l.split(/\s+/), le[i].split(/\s+/), tol)));
  }
  const ta = a.split(/\s+/).filter(Boolean);
  const te = e.split(/\s+/).filter(Boolean);
  return tokensEqual(ta, te, tol);
}

function tokensEqual(ta: string[], te: string[], tol?: number): boolean {
  if (ta.length !== te.length) return false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === te[i]) continue;
    if (tol !== undefined && NUM.test(ta[i]) && NUM.test(te[i])) {
      const x = Number(ta[i]); const y = Number(te[i]);
      if (Math.abs(x - y) <= tol * Math.max(1, Math.abs(y))) continue;
    }
    return false;
  }
  return true;
}

// ------------------------------------------------------------------ plagiarism-lite
const KEYWORDS = new Set((
  'if else elif for while do return def class import from as in is not and or int long double float char void bool boolean string new public private static final ' +
  'using namespace include std vector map set cout cin endl printf scanf main let const var function try catch except finally break continue true false null none ' +
  'switch case default struct typedef sizeof lambda print input range len'
).split(' '));

/** Token stream with comments removed and identifiers / literals abstracted. */
export function codeTokens(code: string): string[] {
  let s = code.replace(/\r\n?/g, '\n');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ').replace(/(^|\s)#(?!include|define)[^\n]*/g, '$1 ');
  s = s.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' STR ').replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, ' STR ');
  const toks = s.match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[^\sA-Za-z0-9_]/g) || [];
  return toks.map((t) => {
    if (/^\d/.test(t)) return 'NUM';
    if (/^[A-Za-z_]/.test(t)) return t === 'STR' ? 'STR' : KEYWORDS.has(t) ? t : 'ID';
    return t;
  });
}

export const codeHash = (code: string) => crypto.createHash('sha256').update(codeTokens(code).join(' ')).digest('hex');

export function shingles(tokens: string[], k = 4): Set<string> {
  const out = new Set<string>();
  if (tokens.length < k) { if (tokens.length) out.add(tokens.join(' ')); return out; }
  for (let i = 0; i + k <= tokens.length; i++) out.add(tokens.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
