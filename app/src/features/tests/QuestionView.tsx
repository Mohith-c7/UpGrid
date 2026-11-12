/** One question of a test: statement, answer controls (MCQ single/multi, numeric, short text) or the coding panel. */
import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Banner, Button, Card, Icon, Text, TextField } from '@/ui';
import { colors, MIN_TOUCH, radius } from '@/theme';
import type { AnswerValue, CodeAnswer, CodeSubmission, CodeSummary, StudentQuestion } from '@/api/testsTypes';
import { CodingPanel, type CodingRunner, starterFor } from './CodingPanel';
import { fmtMarks, isCodeAnswer, isNumericText, MarkdownLite, sp, TYPE_LABEL } from './kit';

function OptionRow({ letter, text, selected, multi, onPress, disabled }: { letter: string; text: string; selected: boolean; multi: boolean; onPress: () => void; disabled?: boolean }) {
  const icon = multi ? (selected ? 'check-box' : 'check-box-outline-blank') : selected ? 'radio-button-checked' : 'radio-button-unchecked';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`Option ${letter.toUpperCase()}. ${text}${selected ? '. Selected' : ''}`}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: radius.card,
        borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primaryTint : pressed ? colors.surfaceAlt : colors.surface,
      })}
    >
      <Icon name={icon} size={24} color={selected ? colors.primary : colors.muted} />
      <Text variant="body" style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" style={{ fontWeight: '700' }}>{`${letter.toUpperCase()}.  `}</Text>
        {text}
      </Text>
    </Pressable>
  );
}

export interface QuestionViewProps {
  q: StudentQuestion;
  position: string; // "Question 3 of 20"
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue | undefined) => void;
  readOnly?: boolean;
  negativeMarking?: boolean;
  // coding
  runner?: CodingRunner;
  execDisabled?: boolean;
  codeSummary?: CodeSummary;
  lastSubmittedCode?: string;
  beforeSend?: () => Promise<void> | void;
  onCodeSubmitted?: (code: string, sub: CodeSubmission | null) => void;
}

export function QuestionView(p: QuestionViewProps) {
  const { q, value, onChange, readOnly } = p;
  const marksText = `${fmtMarks(q.marks)} ${q.marks === 1 ? 'mark' : 'marks'}${p.negativeMarking && q.negativeMarks > 0 ? `, -${fmtMarks(q.negativeMarks)} for a wrong answer` : ''}`;

  const head = (
    <View style={{ gap: sp.xs }}>
      <Text variant="overline" color={colors.muted}>{`${p.position}  |  ${TYPE_LABEL[q.type]}`}</Text>
      <Text variant="heading">{q.title}</Text>
      <Text variant="caption" tabular color={colors.muted}>{marksText}</Text>
    </View>
  );

  if (q.type === 'coding' && q.coding && p.runner) {
    const spec = q.coding;
    const lang0 = spec.languages[0];
    const cur: CodeAnswer = isCodeAnswer(value) ? value : { language: lang0, code: starterFor(spec, lang0) };
    return (
      <View style={{ gap: sp.lg }}>
        {head}
        <CodingPanel
          problem={{ body: q.body, constraints: spec.constraints, languages: spec.languages, timeLimitMs: spec.timeLimitMs, memoryLimitMb: spec.memoryLimitMb, starterCode: spec.starterCode, samples: spec.samples, hiddenCount: spec.hiddenCount }}
          value={cur}
          onChange={(v) => onChange(v)}
          runner={p.runner}
          readOnly={readOnly}
          execDisabled={p.execDisabled}
          best={p.codeSummary?.best}
          judgePending={p.codeSummary?.pending}
          beforeSend={p.beforeSend}
          lastSubmittedCode={p.lastSubmittedCode}
          onSubmitted={p.onCodeSubmitted}
        />
      </View>
    );
  }

  let control: React.ReactNode = null;
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    const multi = q.type === 'mcq_multi' || !!q.multi;
    const sel = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
    const toggle = (id: string) => {
      if (readOnly) return;
      if (multi) {
        const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        onChange(next.length ? next : undefined);
      } else onChange(id);
    };
    control = (
      <View style={{ gap: sp.md }} accessibilityRole={multi ? undefined : 'radiogroup'}>
        {multi ? <Text variant="caption" color={colors.textSecondary}>Select all that apply.</Text> : null}
        {(q.options ?? []).map((o, i) => (
          <OptionRow key={o.id} letter={o.id || String.fromCharCode(97 + i)} text={o.text} selected={sel.includes(o.id)} multi={multi} onPress={() => toggle(o.id)} disabled={readOnly} />
        ))}
        {sel.length > 0 && !readOnly ? <Button label="Clear answer" variant="ghost" size="sm" icon="clear" onPress={() => onChange(undefined)} /> : null}
      </View>
    );
  } else if (q.type === 'numeric') {
    const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
    const invalid = text.trim() !== '' && !isNumericText(text);
    control = (
      <TextField
        label="Your answer (number)"
        value={text}
        onChangeText={(t) => onChange(t === '' ? undefined : t.replace(/[^0-9eE+\-.]/g, ''))}
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'} // the iOS decimal pad has no minus sign
        editable={!readOnly}
        maxLength={30}
        error={invalid ? 'Enter a number such as 12 or 12.5. This is not saved yet.' : null}
        helper="Decimals are allowed."
      />
    );
  } else if (q.type === 'short_text') {
    const text = typeof value === 'string' ? value : '';
    control = (
      <TextField
        label="Your answer"
        value={text}
        onChangeText={(t) => onChange(t === '' ? undefined : t)}
        editable={!readOnly}
        maxLength={500}
        multiline
        helper={`${text.length} of 500 characters`}
        autoCapitalize="none"
      />
    );
  } else {
    control = <Banner tone="warning" message="This question type is not supported in this version of the app." />;
  }

  return (
    <View style={{ gap: sp.lg }}>
      {head}
      <Card tinted><MarkdownLite text={q.body} /></Card>
      {control}
    </View>
  );
}
