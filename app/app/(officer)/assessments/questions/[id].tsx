import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Icon, SectionHeader, SegmentedControl, Select, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { CODE_LANGUAGES, useQuestion, useSaveQuestion, type CodeLanguage } from '@/api/assessments';
import { ErrorList, Frame, LANG_LABEL, NumberField, ToggleRow, TYPE_LABEL, ROOT, errorLines } from '@/features/assessments/kit';
import { useUnsavedGuard } from '@/features/student/me/kit';
import { EMPTY_FORM, fromQuestion, toWrite, type QuestionForm, type TestForm } from '@/features/assessments/questionForm';

const TYPE_OPTIONS = (['mcq_single', 'mcq_multi', 'coding', 'numeric', 'short_text'] as const).map((t) => ({ value: t, label: TYPE_LABEL[t] }));

export default function QuestionEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const r = useRouter();
  const toast = useToast();
  const existing = useQuestion(isNew ? undefined : id);
  const save = useSaveQuestion();
  const [f, setF] = useState<QuestionForm>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const set = <K extends keyof QuestionForm>(k: K, v: QuestionForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const base = useRef(JSON.stringify(EMPTY_FORM));
  useEffect(() => { if (existing.data && !loaded) { const nf = fromQuestion(existing.data); base.current = JSON.stringify(nf); setF(nf); setLoaded(true); } }, [existing.data, loaded]);
  const { allowLeave } = useUnsavedGuard(loaded && JSON.stringify(f) !== base.current);

  if (!isNew && (existing.isLoading || existing.isError || !loaded)) {
    return (
      <Frame title="Question">
        {existing.isError ? <ErrorState message={errMessage(existing.error)} onRetry={() => { void existing.refetch(); }} />
          : <><Skeleton height={56} /><Skeleton height={160} radius={14} /><Skeleton height={160} radius={14} /></>}
      </Frame>
    );
  }
  const q = existing.data;
  const e = (k: string) => errors[k] ?? null;
  const isMcq = f.type === 'mcq_single' || f.type === 'mcq_multi';

  const submit = async () => {
    const { body, errors: ce } = toWrite(f);
    if (!body) { setErrors(ce); setSummary(Object.values(ce)); toast.show('Fix the highlighted fields', 'error'); return; }
    setErrors({}); setSummary([]);
    try {
      await save.mutateAsync({ id: isNew ? undefined : id, body });
      toast.show(isNew ? 'Question added' : 'Question saved', 'success');
      allowLeave();
      r.canGoBack() ? r.back() : r.replace(`${ROOT}/questions` as any);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) { setErrors(err.fields); setSummary(errorLines(err)); }
      else if (err instanceof ApiError && err.code === 'NOT_PRACTICE_READY') setSummary([err.message]);
      else toast.show(errMessage(err), 'error');
    }
  };

  const setOption = (i: number, text: string) => setF((p) => ({ ...p, options: p.options.map((o, j) => (j === i ? { text } : o)) }));
  const toggleCorrect = (i: number) => setF((p) => ({
    ...p,
    correct: p.type === 'mcq_single' ? p.options.map((_, j) => j === i) : p.correct.map((c, j) => (j === i ? !c : c)),
  }));
  const addOption = () => setF((p) => (p.options.length >= 8 ? p : { ...p, options: [...p.options, { text: '' }], correct: [...p.correct, false] }));
  const removeOption = (i: number) => setF((p) => (p.options.length <= 2 ? p : { ...p, options: p.options.filter((_, j) => j !== i), correct: p.correct.filter((_, j) => j !== i) }));
  const setTest = (i: number, patch: Partial<TestForm>) => setF((p) => ({ ...p, tests: p.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const addTest = (kind: 'sample' | 'hidden') => setF((p) => ({ ...p, tests: [...p.tests, { kind, input: '', expected: '', weight: '1', explanation: '' }] }));
  const removeTest = (i: number) => setF((p) => ({ ...p, tests: p.tests.filter((_, j) => j !== i) }));
  const toggleLang = (l: CodeLanguage) => setF((p) => ({ ...p, languages: p.languages.includes(l) ? p.languages.filter((x) => x !== l) : [...p.languages, l] }));

  return (
    <Frame
      title={isNew ? 'New question' : 'Edit question'}
      keyboard
      footer={<Button label={isNew ? 'Add to question bank' : 'Save changes'} icon="check" full loading={save.isPending} onPress={submit} />}
    >
      {q?.status === 'archived' ? <Banner tone="info" message="This question is archived. Restore it from the question bank to use it in new tests." /> : null}
      {q && (q.usedIn ?? 0) > 0 ? <Banner tone="info" message={`Used in ${q.usedIn} test${q.usedIn === 1 ? '' : 's'}. Published tests keep their own copy, so edits only affect tests you build next.`} /> : null}
      <ErrorList title="Please fix these" lines={summary} />

      <Card style={{ gap: 14 }}>
        <Select label="Question type" value={f.type} onChange={(v) => set('type', v as any)} options={TYPE_OPTIONS} />
        <TextField label="Title" value={f.title} onChangeText={(t) => set('title', t)} error={e('title')} maxLength={200} helper="Shown in lists. Keep it short." />
        <TextField label="Statement (markdown)" value={f.body} onChangeText={(t) => set('body', t)} error={e('body')} multiline helper="Leave blank to use the title as the statement." />
        <TextField label="Topic" value={f.topic} onChangeText={(t) => set('topic', t)} error={e('topic')} maxLength={80} placeholder="For example Arrays" />
        <TextField label="Tags" value={f.tagsText} onChangeText={(t) => set('tagsText', t)} error={e('tags')} placeholder="Separated by commas" autoCapitalize="none" helper="Up to 10, stored in lowercase." />
        <View style={{ gap: 6 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Difficulty</Text>
          <SegmentedControl value={f.difficulty} onChange={(v) => set('difficulty', v as any)} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
        </View>
        <NumberField label="Marks" value={f.marks} onChange={(t) => set('marks', t)} error={e('marks')} helper="0.25 to 100" />
        <NumberField label="Negative marks" value={f.negativeMarks} onChange={(t) => set('negativeMarks', t)} error={e('negativeMarks')} helper="Deducted for a wrong answer when the test has negative marking on." />
      </Card>

      {isMcq ? (
        <>
          <SectionHeader title="Options" subtitle={f.type === 'mcq_single' ? 'Mark the one correct option' : 'Mark every correct option'} />
          <Card style={{ gap: 12 }}>
            {f.options.map((o, i) => (
              <View key={i} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                  <Pressable
                    onPress={() => toggleCorrect(i)}
                    accessibilityRole={f.type === 'mcq_single' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: !!f.correct[i], selected: !!f.correct[i] }}
                    accessibilityLabel={`Option ${String.fromCharCode(65 + i)} is ${f.correct[i] ? '' : 'not '}correct. Tap to change`}
                    style={{ width: MIN_TOUCH, height: 52, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name={f.type === 'mcq_single' ? (f.correct[i] ? 'radio-button-checked' : 'radio-button-unchecked') : (f.correct[i] ? 'check-box' : 'check-box-outline-blank')} size={26} color={f.correct[i] ? colors.primary : colors.muted} />
                  </Pressable>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <TextField label={`Option ${String.fromCharCode(65 + i)}${f.correct[i] ? ' (correct)' : ''}`} value={o.text} onChangeText={(t) => setOption(i, t)} error={e(`options.${i}.text`)} />
                  </View>
                  <Pressable onPress={() => removeOption(i)} disabled={f.options.length <= 2} accessibilityRole="button" accessibilityLabel={`Remove option ${String.fromCharCode(65 + i)}`}
                    style={{ width: MIN_TOUCH, height: 52, alignItems: 'center', justifyContent: 'center', opacity: f.options.length <= 2 ? 0.35 : 1 }}>
                    <Icon name="delete-outline" size={24} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
            ))}
            {e('options') ? <Text variant="caption" color={colors.error}>{e('options')}</Text> : null}
            {e('answer.correct') ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{e('answer.correct')}</Text></View> : null}
            <Button label="Add option" icon="add" variant="secondary" size="sm" disabled={f.options.length >= 8} onPress={addOption} />
          </Card>
        </>
      ) : null}

      {f.type === 'numeric' ? (
        <Card style={{ gap: 14 }}>
          <NumberField label="Correct value" value={f.numValue} onChange={(t) => set('numValue', t)} error={e('answer.value')} />
          <NumberField label="Tolerance" value={f.numTol} onChange={(t) => set('numTol', t)} error={e('answer.tolerance')} helper="Answers within this distance of the value are correct." />
        </Card>
      ) : null}

      {f.type === 'short_text' ? (
        <Card style={{ gap: 14 }}>
          <TextField label="Accepted answers (one per line)" value={f.acceptedText} onChangeText={(t) => set('acceptedText', t)} multiline error={e('answer.accepted')} autoCapitalize="none" />
          <SegmentedControl value={f.shortMode} onChange={(v) => set('shortMode', v as any)} options={[{ value: 'exact', label: 'Exact match' }, { value: 'regex', label: 'Pattern (regex)' }]} />
          <ToggleRow label="Case sensitive" value={f.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
        </Card>
      ) : null}

      {f.type === 'coding' ? (
        <>
          <SectionHeader title="Coding settings" />
          <Card style={{ gap: 14 }}>
            <TextField label="Constraints and input format (markdown)" value={f.constraints} onChangeText={(t) => set('constraints', t)} multiline />
            <View style={{ gap: 8 }}>
              <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Languages allowed</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CODE_LANGUAGES.map((l) => <Chip key={l} label={LANG_LABEL[l]} selected={f.languages.includes(l)} onPress={() => toggleLang(l)} />)}
              </View>
              {e('coding.languages') ? <Text variant="caption" color={colors.error}>{e('coding.languages')}</Text> : null}
            </View>
            <NumberField label="Time limit (ms)" integer value={f.timeLimitMs} onChange={(t) => set('timeLimitMs', t)} error={e('coding.timeLimitMs')} helper="100 to 15000" />
            <NumberField label="Memory limit (MB)" integer value={f.memoryLimitMb} onChange={(t) => set('memoryLimitMb', t)} error={e('coding.memoryLimitMb')} helper="16 to 512" />
            <View style={{ gap: 6 }}>
              <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Output comparison</Text>
              <SegmentedControl value={f.compareMode} onChange={(v) => set('compareMode', v as any)} options={[{ value: 'tokens', label: 'Ignore whitespace' }, { value: 'lines', label: 'Line by line' }]} />
            </View>
            <NumberField label="Float tolerance (optional)" value={f.floatTol} onChange={(t) => set('floatTol', t)} error={e('coding.compare.floatTolerance')} helper="For problems with decimal output, for example 0.000001" />
          </Card>

          <SectionHeader title="Test cases" subtitle={`${f.tests.filter((t) => t.kind === 'sample').length} sample, ${f.tests.filter((t) => t.kind === 'hidden').length} hidden. Students see samples only.`} />
          {e('coding.testCases') ? <Banner tone="error" message={e('coding.testCases')!} /> : null}
          {f.tests.map((t, i) => (
            <Card key={i} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="subhead" style={{ flex: 1 }}>Test {i + 1}</Text>
                <Pressable onPress={() => removeTest(i)} accessibilityRole="button" accessibilityLabel={`Remove test ${i + 1}`} style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="delete-outline" size={24} color={colors.muted} />
                </Pressable>
              </View>
              <SegmentedControl value={t.kind} onChange={(v) => setTest(i, { kind: v as any })} options={[{ value: 'sample', label: 'Sample (visible)' }, { value: 'hidden', label: 'Hidden' }]} />
              <TextField label="Input" value={t.input} onChangeText={(v) => setTest(i, { input: v })} multiline autoCapitalize="none" error={e(`coding.testCases.${i}.input`)} />
              <TextField label="Expected output" value={t.expected} onChangeText={(v) => setTest(i, { expected: v })} multiline autoCapitalize="none" error={e(`coding.testCases.${i}.expectedOutput`)} />
              <NumberField label="Weight" integer value={t.weight} onChange={(v) => setTest(i, { weight: v })} error={e(`coding.testCases.${i}.weight`)} helper="Share of the marks this test carries" />
              {t.kind === 'sample' ? <TextField label="Explanation (optional)" value={t.explanation} onChangeText={(v) => setTest(i, { explanation: v })} multiline /> : null}
            </Card>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label="Add sample" icon="add" variant="secondary" size="sm" onPress={() => addTest('sample')} />
            <Button label="Add hidden" icon="add" variant="secondary" size="sm" onPress={() => addTest('hidden')} />
          </View>

          <SectionHeader title="Starter code" subtitle="Optional, per language. Java must declare public class Main." />
          <Card style={{ gap: 14 }}>
            {f.languages.length === 0 ? <Text variant="caption" color={colors.muted}>Choose a language above first.</Text> : null}
            {f.languages.map((l) => (
              <TextField key={l} label={`${LANG_LABEL[l]} starter`} value={f.starter[l] ?? ''} onChangeText={(v) => setF((p) => ({ ...p, starter: { ...p.starter, [l]: v } }))} multiline autoCapitalize="none" error={e(`coding.starterCode.${l}`)} />
            ))}
          </Card>

          <SectionHeader title="Reference solution" subtitle="Optional. Only officers can see it." />
          <Card style={{ gap: 14 }}>
            <Select label="Language" value={f.refLang || null} onChange={(v) => set('refLang', v as CodeLanguage)} placeholder="None" options={f.languages.map((l) => ({ value: l, label: LANG_LABEL[l] }))} error={e('coding.referenceSolution')} />
            <TextField label="Code" value={f.refCode} onChangeText={(v) => set('refCode', v)} multiline autoCapitalize="none" />
          </Card>
        </>
      ) : null}

      <SectionHeader title="Explanation and practice" />
      <Card style={{ gap: 10 }}>
        <TextField label="Explanation (optional)" value={f.explanation} onChangeText={(t) => set('explanation', t)} multiline error={e('explanation')} helper="Students see it in the review when the test allows review." />
        <ToggleRow label="Available as a practice question" hint={f.type === 'coding' ? 'Coding practice needs 1 sample and 2 hidden tests.' : 'Students can practise it outside tests.'} value={f.practice} onChange={(v) => set('practice', v)} />
      </Card>
    </Frame>
  );
}
