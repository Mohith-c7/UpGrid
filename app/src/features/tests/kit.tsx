/** Shared bits for the student tests screens: formatting, light markdown, verdict badges, answer helpers. */
import React from 'react';
import { View } from 'react-native';
import { Badge, CodeBlock, Text, type IconName } from '@/ui';
import { colors, monoFamily } from '@/theme';
import { ApiError } from '@/api/client';
import type { AnswerValue, CodeAnswer, OptionItem, QuestionType, StudentQuestion } from '@/api/testsTypes';

export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/* ---------------------------------------------------------------- formatting */
export const fmtMarks = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return String(Math.round(n * 100) / 100);
};
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}
export const fmtMinutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq_single: 'Single choice',
  mcq_multi: 'Multiple choice',
  numeric: 'Numeric answer',
  short_text: 'Short answer',
  coding: 'Coding',
};

export function netMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/* ---------------------------------------------------------------- verdicts */
export const VERDICT_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  wrong_answer: 'Wrong answer',
  compile_error: 'Compile error',
  runtime_error: 'Runtime error',
  time_limit_exceeded: 'Time limit exceeded',
  memory_limit_exceeded: 'Memory limit exceeded',
  internal_error: 'Judge error',
};
export const verdictTone = (v: string): Tone => (v === 'accepted' ? 'success' : v === 'internal_error' ? 'warning' : 'error');
export function VerdictBadge({ verdict }: { verdict: string }) {
  const tone = verdictTone(verdict);
  const icon: IconName = tone === 'success' ? 'check-circle' : tone === 'warning' ? 'warning-amber' : 'cancel';
  return <Badge label={VERDICT_LABEL[verdict] ?? verdict.replace(/_/g, ' ')} tone={tone} icon={icon} />;
}

/* ---------------------------------------------------------------- answers */
export const isCodeAnswer = (v: unknown): v is CodeAnswer =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as CodeAnswer).code === 'string';

/** Numeric answers are stored as text while editing. */
export const NUMERIC_RE = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
export const isNumericText = (t: string) => NUMERIC_RE.test(t.trim());

export function isAnswered(q: StudentQuestion, v: AnswerValue | undefined, starter?: string): boolean {
  if (v === null || v === undefined) return false;
  switch (q.type) {
    case 'mcq_single': return typeof v === 'string' && v !== '';
    case 'mcq_multi': return Array.isArray(v) && v.length > 0;
    case 'numeric': return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && isNumericText(v));
    case 'short_text': return typeof v === 'string' && v.trim() !== '';
    case 'coding': return isCodeAnswer(v) && v.code.trim() !== '' && v.code.trim() !== (starter ?? '').trim();
    default: return false;
  }
}

/** Human text for an answer (review screen). */
export function describeAnswer(type: QuestionType, v: AnswerValue | undefined, options?: OptionItem[]): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return 'Not answered';
  const label = (id: string) => {
    const o = options?.find((x) => x.id === id);
    return o ? `${id.toUpperCase()}. ${o.text}` : id;
  };
  if (type === 'mcq_single' && typeof v === 'string') return label(v);
  if (type === 'mcq_multi' && Array.isArray(v)) return v.map(label).join('\n');
  if (type === 'coding') return isCodeAnswer(v) ? `${v.language} (${v.code.split('\n').length} lines)` : 'Code submitted';
  return String(v);
}

/* ---------------------------------------------------------------- light markdown */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <Text key={`${keyBase}-${i++}`} maxFontSizeMultiplier={1.4} style={{ fontFamily: monoFamily, fontSize: 13, backgroundColor: colors.pressed }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else {
      out.push(<Text key={`${keyBase}-${i++}`} style={{ fontWeight: '700' }}>{tok.slice(2, -2)}</Text>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders the subset of markdown used in question bodies: paragraphs, headings, bullets, **bold**, `code`, fenced code. */
export function MarkdownLite({ text, gap = sp.sm }: { text: string; gap?: number }) {
  const src = (text ?? '').replace(/\r\n/g, '\n');
  const blocks: React.ReactNode[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  let k = 0;
  const flush = () => {
    if (para.length) {
      const t = para.join(' ').trim();
      if (t) blocks.push(<Text key={`p${k++}`} variant="body">{inline(t, `p${k}`)}</Text>);
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      blocks.push(<CodeBlock key={`c${k++}`} code={buf.join('\n')} />);
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push(<Text key={`h${k++}`} variant="subhead">{h[1]}</Text>);
      continue;
    }
    const b = /^\s*[-*]\s+(.*)$/.exec(line) ?? /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (b) {
      flush();
      blocks.push(
        <View key={`b${k++}`} style={{ flexDirection: 'row', gap: 8 }}>
          <Text variant="body">{'•'}</Text>
          <Text variant="body" style={{ flex: 1, minWidth: 0 }}>{inline(b[1], `b${k}`)}</Text>
        </View>,
      );
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return <View style={{ gap }}>{blocks}</View>;
}
