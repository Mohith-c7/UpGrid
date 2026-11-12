import { outputsMatch, type CompareOptions } from './compare';
import type { Language } from './schemas';

/** Untrusted code is NEVER executed on this server: everything goes through Judge0 (or a test double). */
export class JudgeUnavailableError extends Error {
  constructor(message = 'Code execution is not available') { super(message); }
}

export interface ExecItem { language: Language; code: string; stdin: string }
export interface ExecLimits { timeLimitMs: number; memoryLimitMb: number }
export type ExecStatus = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'memory_limit' | 'internal_error';
export interface ExecResult { status: ExecStatus; stdout: string; stderr: string; compileOutput: string; timeMs: number; memoryKb: number }

export interface Judge0Client {
  isConfigured(): boolean;
  /** Runs every item (same language limits) and returns results in order. Throws JudgeUnavailableError when the service cannot be reached. */
  execute(items: ExecItem[], limits: ExecLimits): Promise<ExecResult[]>;
}

export const LANGUAGE_IDS: Record<Language, number> = { python3: 71, java: 62, cpp: 54, c: 50, javascript: 63 };

export interface Judge0Options {
  url: string; apiKey?: string; apiHost?: string; authToken?: string;
  fetchImpl?: typeof fetch; pollIntervalMs?: number; timeoutMs?: number; batchSize?: number;
  languageIds?: Partial<Record<Language, number>>;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_OUT = 64 * 1024;

export function createJudge0Client(o: Judge0Options): Judge0Client {
  const base = o.url.replace(/\/+$/, '');
  const f = o.fetchImpl ?? fetch;
  const ids = { ...LANGUAGE_IDS, ...(o.languageIds || {}) };
  const poll = o.pollIntervalMs ?? 1000;
  const timeout = o.timeoutMs ?? 60_000;
  const size = o.batchSize ?? 20;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.apiKey) { headers['X-RapidAPI-Key'] = o.apiKey; if (o.apiHost) headers['X-RapidAPI-Host'] = o.apiHost; }
  if (o.authToken) headers['X-Auth-Token'] = o.authToken;

  const call = async (path: string, init?: RequestInit): Promise<any> => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new JudgeUnavailableError(`Judge0 unreachable: ${(e as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) throw new JudgeUnavailableError(`Judge0 responded ${res.status}`);
    if (!res.ok) throw new JudgeUnavailableError(`Judge0 rejected the request (${res.status})`);
    try { return await res.json(); } catch { throw new JudgeUnavailableError('Judge0 returned invalid JSON'); }
  };

  const mapStatus = (r: any): ExecResult => {
    const id = Number(r?.status?.id);
    const memoryKb = Number(r?.memory) || 0;
    const base = {
      stdout: unb64(r?.stdout).slice(0, MAX_OUT), stderr: unb64(r?.stderr).slice(0, 4096), compileOutput: unb64(r?.compile_output).slice(0, 4096),
      timeMs: Math.round((Number(r?.time) || 0) * 1000), memoryKb,
    };
    if (id === 3 || id === 4) return { status: 'ok', ...base };
    if (id === 5) return { status: 'time_limit', ...base };
    if (id === 6) return { status: 'compile_error', ...base };
    if (id >= 7 && id <= 12) return { status: 'runtime_error', ...base };
    return { status: 'internal_error', ...base };
  };

  return {
    isConfigured: () => true,
    async execute(items, limits) {
      const out: ExecResult[] = [];
      for (let i = 0; i < items.length; i += size) {
        const chunk = items.slice(i, i + size);
        const created = await call('/submissions/batch?base64_encoded=true', {
          method: 'POST',
          body: JSON.stringify({
            submissions: chunk.map((it) => ({
              language_id: ids[it.language], source_code: b64(it.code), stdin: b64(it.stdin),
              cpu_time_limit: limits.timeLimitMs / 1000, wall_time_limit: Math.max(2, (limits.timeLimitMs / 1000) * 3),
              memory_limit: limits.memoryLimitMb * 1024,
            })),
          }),
        });
        const tokens: string[] = (Array.isArray(created) ? created : []).map((c: any) => c?.token).filter(Boolean);
        if (tokens.length !== chunk.length) throw new JudgeUnavailableError('Judge0 did not accept the whole batch');
        const started = Date.now();
        let results: any[] = [];
        for (;;) {
          const r = await call(`/submissions/batch?base64_encoded=true&tokens=${tokens.join(',')}&fields=token,status,stdout,stderr,compile_output,time,memory`);
          results = Array.isArray(r?.submissions) ? r.submissions : [];
          if (results.length === tokens.length && results.every((x) => Number(x?.status?.id) > 2)) break;
          if (Date.now() - started > timeout) throw new JudgeUnavailableError('Judge0 timed out');
          await sleep(poll);
        }
        const byToken = new Map(results.map((x) => [x.token, x]));
        for (const t of tokens) {
          const m = mapStatus(byToken.get(t));
          if (m.status === 'internal_error') throw new JudgeUnavailableError('Judge0 internal error');
          // Judge0 has no dedicated memory-limit status: a runtime error at the limit is reported as MLE
          if (m.status === 'runtime_error' && m.memoryKb >= limits.memoryLimitMb * 1024 * 0.98) m.status = 'memory_limit';
          out.push(m);
        }
      }
      return out;
    },
  };
}

export function judgeFromEnv(env: NodeJS.ProcessEnv = process.env): Judge0Client {
  if (!env.JUDGE0_URL) return unconfiguredJudge;
  let languageIds: Partial<Record<Language, number>> | undefined;
  try { if (env.JUDGE0_LANGUAGE_IDS) languageIds = JSON.parse(env.JUDGE0_LANGUAGE_IDS); } catch { /* ignore bad override */ }
  return createJudge0Client({ url: env.JUDGE0_URL, apiKey: env.JUDGE0_API_KEY, apiHost: env.JUDGE0_API_HOST, authToken: env.JUDGE0_AUTH_TOKEN, languageIds });
}

export const unconfiguredJudge: Judge0Client = {
  isConfigured: () => false,
  async execute() { throw new JudgeUnavailableError('Code execution is not configured'); },
};

let current: Judge0Client | null = null;
export const getJudge = (): Judge0Client => (current ??= judgeFromEnv());
/** Tests inject a double; pass null to fall back to the environment. */
export const setJudge = (j: Judge0Client | null) => { current = j; };

// ------------------------------------------------------------------ verdicts
export type Verdict = 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'internal_error';
const SEVERITY: Verdict[] = ['compile_error', 'runtime_error', 'time_limit_exceeded', 'memory_limit_exceeded', 'wrong_answer', 'internal_error'];

export interface TestSpec { id: string; kind: 'sample' | 'hidden'; input: string; expectedOutput: string; weight: number; explanation?: string }
export interface TestOutcome { id: string; kind: 'sample' | 'hidden'; weight: number; verdict: Verdict; passed: boolean; stdout: string; stderr: string; timeMs: number; memoryKb: number }
export interface CodeEvaluation {
  verdict: Verdict; compileOutput: string | null; outcomes: TestOutcome[];
  passed: number; total: number; passedWeight: number; totalWeight: number;
}

export interface CodingConfig {
  timeLimitMs: number; memoryLimitMb: number; compare?: CompareOptions;
}

export function overallVerdict(outcomes: { verdict: Verdict; passed: boolean }[]): Verdict {
  const failed = outcomes.filter((o) => !o.passed).map((o) => o.verdict);
  if (!failed.length) return 'accepted';
  for (const v of SEVERITY) if (failed.includes(v)) return v;
  return 'wrong_answer';
}

/** Runs `tests` through the judge and compares outputs. */
export async function evaluateCode(judge: Judge0Client, cfg: CodingConfig, language: Language, code: string, tests: TestSpec[]): Promise<CodeEvaluation> {
  if (!judge.isConfigured()) throw new JudgeUnavailableError('Code execution is not configured');
  const raw = await judge.execute(tests.map((t) => ({ language, code, stdin: t.input })), { timeLimitMs: cfg.timeLimitMs, memoryLimitMb: cfg.memoryLimitMb });
  if (raw.length !== tests.length) throw new JudgeUnavailableError('Judge returned an incomplete result');
  let compileOutput: string | null = null;
  const outcomes: TestOutcome[] = tests.map((t, i) => {
    const r = raw[i];
    let verdict: Verdict;
    switch (r.status) {
      case 'ok': verdict = outputsMatch(r.stdout, t.expectedOutput, cfg.compare) ? 'accepted' : 'wrong_answer'; break;
      case 'compile_error': verdict = 'compile_error'; compileOutput = compileOutput ?? (r.compileOutput || r.stderr || 'Compilation failed'); break;
      case 'runtime_error': verdict = 'runtime_error'; break;
      case 'time_limit': verdict = 'time_limit_exceeded'; break;
      case 'memory_limit': verdict = 'memory_limit_exceeded'; break;
      default: verdict = 'internal_error';
    }
    return { id: t.id, kind: t.kind, weight: t.weight, verdict, passed: verdict === 'accepted', stdout: r.stdout, stderr: r.stderr, timeMs: r.timeMs, memoryKb: r.memoryKb };
  });
  return {
    verdict: overallVerdict(outcomes), compileOutput, outcomes,
    passed: outcomes.filter((o) => o.passed).length, total: outcomes.length,
    passedWeight: outcomes.reduce((s, o) => s + (o.passed ? o.weight : 0), 0), totalWeight: outcomes.reduce((s, o) => s + o.weight, 0),
  };
}
