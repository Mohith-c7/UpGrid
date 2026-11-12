/** Per-type answer inputs and field-level validation for drive questions (apply flow). */
import React from 'react';
import { View } from 'react-native';
import { Icon, SegmentedControl, Text, TextField } from '@/ui';
import { colors, spacing } from '@/theme';
import { validateUrl } from '@/lib/validation';
import type { Question } from '@/api/types';
import { CheckRow } from './blocks';

export type AnswerValue = string | string[] | boolean | undefined;

const DEFAULT_MAX: Record<string, number> = { short_text: 200, long_text: 2000, url: 300, number: 20, date: 10 };
export const maxLenOf = (q: Question) => q.maxLength && q.maxLength > 0 ? q.maxLength : DEFAULT_MAX[q.type] ?? 500;

export function isEmptyAnswer(q: Question, v: AnswerValue): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (q.type === 'declaration') return v !== true;
  return false; // boolean false for yes_no is a real answer
}

/** Returns an error message or null. */
export function validateAnswer(q: Question, v: AnswerValue): string | null {
  const label = q.label;
  if (q.type === 'declaration') {
    if (q.required && v !== true) return 'You must accept this to continue';
    return null;
  }
  if (isEmptyAnswer(q, v)) return q.required ? (q.type === 'yes_no' ? 'Choose Yes or No' : q.type.endsWith('select') ? 'Choose an option' : `${label} is required`) : null;
  switch (q.type) {
    case 'short_text':
    case 'long_text': {
      const s = String(v);
      const max = maxLenOf(q);
      if (s.trim().length > max) return `Keep it within ${max} characters`;
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) return 'Contains invalid characters';
      return null;
    }
    case 'number': {
      const s = String(v).trim();
      if (!/^-?\d+(\.\d+)?$/.test(s)) return 'Enter a valid number';
      if (!Number.isFinite(Number(s))) return 'Enter a valid number';
      return null;
    }
    case 'date': {
      const s = String(v).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return 'Use the format YYYY-MM-DD';
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return 'Enter a real calendar date';
      return null;
    }
    case 'url': {
      const r = validateUrl(String(v), 'any', q.required);
      return r.ok ? null : r.error;
    }
    case 'single_select':
      return q.options && !q.options.includes(String(v)) ? 'Choose one of the listed options' : null;
    case 'multi_select': {
      const arr = Array.isArray(v) ? v : [];
      return q.options && arr.some((x) => !q.options!.includes(x)) ? 'Choose from the listed options' : null;
    }
    case 'yes_no':
      return typeof v === 'boolean' ? null : 'Choose Yes or No';
    default:
      return null;
  }
}

/** Convert UI state to the value sent to the API; undefined means "omit". */
export function toApiValue(q: Question, v: AnswerValue): unknown {
  if (isEmptyAnswer(q, v)) return q.type === 'declaration' ? (q.required ? true : undefined) : undefined;
  switch (q.type) {
    case 'number': return Number(String(v).trim());
    case 'short_text':
    case 'long_text':
    case 'url':
    case 'date':
    case 'single_select': return String(v).trim();
    case 'multi_select': return Array.isArray(v) ? v : [];
    case 'yes_no': return v === true;
    case 'declaration': return true;
    default: return v;
  }
}

export function QuestionInput({
  q, value, error, onChange, onBlur,
}: { q: Question; value: AnswerValue; error?: string | null; onChange: (v: AnswerValue) => void; onBlur: () => void }) {
  const label = q.required ? q.label : `${q.label} (optional)`;
  const max = maxLenOf(q);

  switch (q.type) {
    case 'short_text':
      return <TextField label={label} value={typeof value === 'string' ? value : ''} onChangeText={onChange} onBlur={onBlur} error={error} helper={q.helpText} maxLength={max} />;
    case 'long_text': {
      const s = typeof value === 'string' ? value : '';
      return (
        <TextField
          label={label}
          value={s}
          onChangeText={onChange}
          onBlur={onBlur}
          error={error}
          helper={q.helpText}
          multiline
          maxLength={max}
        />
      );
    }
    case 'number':
      return <TextField label={label} value={typeof value === 'string' ? value : ''} onChangeText={(t) => onChange(t.replace(/[^0-9.\-]/g, ''))} onBlur={onBlur} error={error} helper={q.helpText} keyboardType="decimal-pad" maxLength={20} />;
    case 'date':
      return <TextField label={label} value={typeof value === 'string' ? value : ''} onChangeText={(t) => onChange(t.replace(/[^0-9-]/g, ''))} onBlur={onBlur} error={error} helper={q.helpText ?? 'Format: YYYY-MM-DD'} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />;
    case 'url':
      return <TextField label={label} value={typeof value === 'string' ? value : ''} onChangeText={onChange} onBlur={onBlur} error={error} helper={q.helpText ?? 'Must start with https://'} keyboardType="url" autoCapitalize="none" maxLength={300} placeholder="https://" />;
    case 'single_select':
      return (
        <Group label={label} helper={q.helpText} error={error}>
          {(q.options ?? []).map((o) => (
            <CheckRow key={o} radio label={o} checked={value === o} onToggle={() => { onChange(o); }} />
          ))}
        </Group>
      );
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <Group label={label} helper={q.helpText} error={error}>
          {(q.options ?? []).map((o) => (
            <CheckRow key={o} label={o} checked={arr.includes(o)} onToggle={() => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])} />
          ))}
        </Group>
      );
    }
    case 'yes_no':
      return (
        <Group label={label} helper={q.helpText} error={error}>
          <SegmentedControl
            value={value === true ? 'yes' : value === false ? 'no' : null}
            onChange={(v) => onChange(v === 'yes')}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          />
        </Group>
      );
    case 'declaration':
      return <CheckRow label={q.required ? q.label : `${q.label} (optional)`} helper={q.helpText} checked={value === true} onToggle={() => onChange(value !== true)} error={error} />;
    default:
      return null;
  }
}

function Group({ label, helper, error, children }: { label: string; helper?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="subhead">{label}</Text>
      {helper ? <Text variant="caption" color={colors.muted}>{helper}</Text> : null}
      {children}
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityRole="alert">
          <Icon name="error-outline" size={16} color={colors.error} />
          <Text variant="caption" color={colors.error} style={{ flex: 1 }}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
