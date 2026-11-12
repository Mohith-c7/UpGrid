/**
 * Pure nested condition evaluator (AND / OR / NOT) used for drive eligibility extension (`rules.extra`).
 * Three-valued logic: a leaf on missing data is `unknown`, which makes the student `pending` rather than ineligible.
 */
import type { EligibilityResult } from '../eligibility';

export const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'nin', 'contains', 'exists', 'notExists'] as const;
export type Op = (typeof OPS)[number];

export type FieldKind = 'number' | 'string' | 'array' | 'boolean';
export const FIELDS: Record<string, { kind: FieldKind; label: string }> = {
  cgpa: { kind: 'number', label: 'CGPA' },
  tenthPercent: { kind: 'number', label: '10th %' },
  twelfthPercent: { kind: 'number', label: '12th %' },
  activeBacklogs: { kind: 'number', label: 'Active backlogs' },
  gapYears: { kind: 'number', label: 'Gap years' },
  semester: { kind: 'number', label: 'Semester' },
  batchYear: { kind: 'number', label: 'Batch' },
  department: { kind: 'string', label: 'Department' },
  program: { kind: 'string', label: 'Program' },
  city: { kind: 'string', label: 'City' },
  state: { kind: 'string', label: 'State' },
  skills: { kind: 'array', label: 'Skills' },
  hasAcceptedOffer: { kind: 'boolean', label: 'Accepted offer' },
  acceptedOfferLpa: { kind: 'number', label: 'Best accepted offer (LPA)' },
  academicsVerified: { kind: 'boolean', label: 'Verified academics' },
};

export const MAX_DEPTH = 6;
export const MAX_NODES = 50;

export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { field: string; op: Op; value?: unknown };

export interface CondError { path: string; message: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateConditions(tree: unknown): { valid: boolean; errors: CondError[] } {
  const errors: CondError[] = [];
  let nodes = 0;
  const walk = (n: unknown, path: string, depth: number) => {
    nodes += 1;
    if (nodes > MAX_NODES) { if (nodes === MAX_NODES + 1) errors.push({ path, message: `At most ${MAX_NODES} conditions allowed` }); return; }
    if (depth > MAX_DEPTH) { errors.push({ path, message: `Nesting deeper than ${MAX_DEPTH} levels` }); return; }
    if (!isObj(n)) { errors.push({ path, message: 'Condition must be an object' }); return; }
    const keys = Object.keys(n);
    const kinds = ['all', 'any', 'not', 'field'].filter((k) => k in n);
    if (kinds.length !== 1) { errors.push({ path, message: 'Use exactly one of all, any, not or field' }); return; }
    const kind = kinds[0];
    if (kind === 'all' || kind === 'any') {
      if (keys.length !== 1) errors.push({ path, message: `Unexpected keys next to ${kind}` });
      const arr = n[kind];
      if (!Array.isArray(arr) || arr.length === 0) { errors.push({ path: `${path}.${kind}`, message: `${kind} needs a non-empty list` }); return; }
      arr.forEach((c, i) => walk(c, `${path}.${kind}[${i}]`, depth + 1));
      return;
    }
    if (kind === 'not') {
      if (keys.length !== 1) errors.push({ path, message: 'Unexpected keys next to not' });
      walk(n.not, `${path}.not`, depth + 1);
      return;
    }
    // leaf
    const extra = keys.filter((k) => !['field', 'op', 'value'].includes(k));
    if (extra.length) errors.push({ path, message: `Unknown key: ${extra[0]}` });
    const f = FIELDS[String(n.field)];
    if (!f) { errors.push({ path: `${path}.field`, message: `Unknown field. Use one of ${Object.keys(FIELDS).join(', ')}` }); return; }
    if (!OPS.includes(n.op as Op)) { errors.push({ path: `${path}.op`, message: `Unknown operator. Use one of ${OPS.join(', ')}` }); return; }
    const op = n.op as Op;
    const v = n.value;
    const vp = `${path}.value`;
    const scalarOk = (x: unknown) => (f.kind === 'number' ? isNum(x) : f.kind === 'boolean' ? typeof x === 'boolean' : typeof x === 'string' && x.trim().length > 0 && x.length <= 80);
    if (op === 'exists' || op === 'notExists') {
      if (v !== undefined) errors.push({ path: vp, message: `${op} takes no value` });
    } else if (op === 'between') {
      if (f.kind !== 'number') errors.push({ path: `${path}.op`, message: 'between works on numeric fields only' });
      else if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) errors.push({ path: vp, message: 'between needs [low, high]' });
      else if ((v as number[])[0] > (v as number[])[1]) errors.push({ path: vp, message: 'low must not exceed high' });
    } else if (op === 'in' || op === 'nin') {
      if (f.kind === 'array' || f.kind === 'boolean') errors.push({ path: `${path}.op`, message: `${op} is not supported for ${f.label}` });
      else if (!Array.isArray(v) || v.length === 0 || v.length > 30 || !v.every(scalarOk)) errors.push({ path: vp, message: `${op} needs a list of 1-30 ${f.kind} values` });
    } else if (op === 'contains') {
      if (f.kind !== 'array' && f.kind !== 'string') errors.push({ path: `${path}.op`, message: 'contains works on text and list fields only' });
      else if (typeof v !== 'string' || !v.trim() || v.length > 80) errors.push({ path: vp, message: 'contains needs a text value' });
    } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
      if (f.kind !== 'number') errors.push({ path: `${path}.op`, message: `${op} works on numeric fields only` });
      else if (!isNum(v)) errors.push({ path: vp, message: 'A number is required' });
    } else {
      // eq / neq
      if (f.kind === 'array') errors.push({ path: `${path}.op`, message: `${op} is not supported for lists; use contains` });
      else if (!scalarOk(v)) errors.push({ path: vp, message: `A ${f.kind} value is required` });
    }
  };
  walk(tree, '$', 0);
  return { valid: errors.length === 0, errors };
}

export type Outcome = 'true' | 'false' | 'unknown';
export interface LeafReason {
  path: string; field: string; op: Op; expected: unknown; actual: unknown; outcome: Outcome; message: string;
}
export interface ConditionResult { result: Outcome; reasons: LeafReason[] }

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const missing = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && false);

const OP_TEXT: Record<Op, string> = {
  eq: 'must be', neq: 'must not be', gt: 'must be above', gte: 'must be at least', lt: 'must be below', lte: 'must be at most',
  between: 'must be between', in: 'must be one of', nin: 'must not be one of', contains: 'must include', exists: 'must be provided', notExists: 'must not be set',
};

function leaf(n: { field: string; op: Op; value?: unknown }, ctx: Record<string, unknown>, path: string): LeafReason {
  const label = FIELDS[n.field]?.label ?? n.field;
  const actual = ctx[n.field];
  const mk = (outcome: Outcome): LeafReason => {
    const exp = Array.isArray(n.value) ? n.value.join(n.op === 'between' ? ' and ' : ', ') : n.value;
    const message = outcome === 'unknown'
      ? `Add your ${label.toLowerCase()} to check eligibility`
      : outcome === 'true' ? `${label}: meets requirement`
        : n.op === 'exists' || n.op === 'notExists' ? `${label} ${OP_TEXT[n.op]}` : `${label} ${OP_TEXT[n.op]} ${exp}`;
    return { path, field: n.field, op: n.op, expected: n.value ?? null, actual: actual ?? null, outcome, message };
  };
  if (n.op === 'exists') return mk(missing(actual) ? 'false' : 'true');
  if (n.op === 'notExists') return mk(missing(actual) ? 'true' : 'false');
  if (missing(actual)) return mk('unknown');
  const kind = FIELDS[n.field]?.kind;
  if (kind === 'array') {
    const arr = Array.isArray(actual) ? actual.map(norm) : null;
    if (!arr) return mk('unknown');
    return mk(arr.includes(norm(n.value)) ? 'true' : 'false');
  }
  if (kind === 'number') {
    if (!isNum(actual)) return mk('unknown');
    const v = n.value as any;
    switch (n.op) {
      case 'eq': return mk(actual === v ? 'true' : 'false');
      case 'neq': return mk(actual !== v ? 'true' : 'false');
      case 'gt': return mk(actual > v ? 'true' : 'false');
      case 'gte': return mk(actual >= v ? 'true' : 'false');
      case 'lt': return mk(actual < v ? 'true' : 'false');
      case 'lte': return mk(actual <= v ? 'true' : 'false');
      case 'between': return mk(actual >= v[0] && actual <= v[1] ? 'true' : 'false');
      case 'in': return mk((v as number[]).includes(actual) ? 'true' : 'false');
      case 'nin': return mk(!(v as number[]).includes(actual) ? 'true' : 'false');
      default: return mk('unknown');
    }
  }
  if (kind === 'boolean') {
    if (typeof actual !== 'boolean') return mk('unknown');
    return mk(n.op === 'eq' ? (actual === n.value ? 'true' : 'false') : (actual !== n.value ? 'true' : 'false'));
  }
  // string
  const a = norm(actual) as string;
  const v = n.value;
  switch (n.op) {
    case 'eq': return mk(a === norm(v) ? 'true' : 'false');
    case 'neq': return mk(a !== norm(v) ? 'true' : 'false');
    case 'in': return mk((v as string[]).map(norm).includes(a) ? 'true' : 'false');
    case 'nin': return mk(!(v as string[]).map(norm).includes(a) ? 'true' : 'false');
    case 'contains': return mk(a.includes(String(norm(v))) ? 'true' : 'false');
    default: return mk('unknown');
  }
}

/** Evaluates a (previously validated) tree against a flat context. Never throws on bad data: invalid nodes are unknown. */
export function evaluateConditions(tree: Cond, ctx: Record<string, unknown>): ConditionResult {
  const reasons: LeafReason[] = [];
  const walk = (n: any, path: string, depth: number): Outcome => {
    if (!isObj(n) || depth > MAX_DEPTH + 1) return 'unknown';
    if (Array.isArray(n.all)) {
      const rs = n.all.map((c: Cond, i: number) => walk(c, `${path}.all[${i}]`, depth + 1));
      return rs.includes('false') ? 'false' : rs.includes('unknown') ? 'unknown' : 'true';
    }
    if (Array.isArray(n.any)) {
      const rs = n.any.map((c: Cond, i: number) => walk(c, `${path}.any[${i}]`, depth + 1));
      return rs.includes('true') ? 'true' : rs.includes('unknown') ? 'unknown' : 'false';
    }
    if ('not' in n) {
      const r = walk(n.not, `${path}.not`, depth + 1);
      return r === 'true' ? 'false' : r === 'false' ? 'true' : 'unknown';
    }
    if (typeof n.field === "string" && OPS.includes(n.op as Op)) {
      const lr = leaf(n as any, ctx, path);
      reasons.push(lr);
      return lr.outcome;
    }
    return 'unknown';
  };
  return { result: walk(tree, '$', 0), reasons };
}

// ----------------------------------------------------------------------------- context + composition with the base engine
export interface OfferInfo { count: number; hasAccepted: boolean; bestLpa: number | null }

export function buildConditionContext(
  profile: { academics?: any; contact?: any; skills?: string[]; verification?: Record<string, string> | null } | null | undefined,
  offers?: OfferInfo | null,
): Record<string, unknown> {
  const a = profile?.academics || {};
  const scale = typeof a.cgpaScale === 'number' && a.cgpaScale > 0 ? a.cgpaScale : 10;
  const v = profile?.verification || {};
  const hasAcad = Object.keys(a).length > 0;
  const ctx: Record<string, unknown> = {
    cgpa: typeof a.cgpa === 'number' ? Math.round((a.cgpa / scale) * 10 * 100) / 100 : undefined,
    tenthPercent: a.tenthPercent, twelfthPercent: a.twelfthPercent, activeBacklogs: a.activeBacklogs, gapYears: a.gapYears,
    semester: a.semester, batchYear: a.batchYear, department: a.department, program: a.program,
    city: profile?.contact?.city, state: profile?.contact?.state,
    skills: Array.isArray(profile?.skills) && profile!.skills!.length ? profile!.skills : undefined,
    academicsVerified: hasAcad ? ['academics.cgpa', 'academics.department', 'academics.batchYear'].every((k) => v[k] === 'verified') : undefined,
  };
  if (offers) {
    ctx.hasAcceptedOffer = offers.hasAccepted;
    ctx.acceptedOfferLpa = offers.bestLpa ?? undefined;
  }
  return ctx;
}

/** Composes the `extra` tree with a base eligibility result. With no `extra` the base result is returned untouched. */
export function composeExtra(base: EligibilityResult, extra: unknown, ctx: Record<string, unknown>): EligibilityResult {
  if (!isObj(extra) || Object.keys(extra).length === 0) return base;
  if (!validateConditions(extra).valid) return base; // never block students because of a malformed stored tree
  const ev = evaluateConditions(extra as Cond, ctx);
  const failed = ev.reasons.filter((r) => r.outcome === 'false');
  const unknown = ev.reasons.filter((r) => r.outcome === 'unknown');
  const met = ev.result === 'true' ? true : ev.result === 'false' ? false : null;
  const msg = met === false ? (failed[0]?.message ?? 'Additional criteria not met') : met === null ? (unknown[0]?.message ?? 'More profile details are needed') : 'Additional criteria: met';
  const reason: any = {
    criterion: 'custom', label: 'Additional criteria', required: 'Drive-specific conditions', actual: null, met, source: 'profile',
    verification: 'unverified', message: msg, detail: ev.reasons,
  };
  const reasons = [...base.reasons, reason];
  const anyFailed = base.status === 'not_eligible' || met === false;
  const anyPending = base.status === 'pending' || met === null;
  if (anyFailed) return { status: 'not_eligible', reasons, reason: base.status === 'not_eligible' ? base.reason : msg };
  if (anyPending) return { status: 'pending', reasons, reason: base.status === 'pending' ? base.reason : msg };
  return { status: 'eligible', reasons, reason: '' };
}
