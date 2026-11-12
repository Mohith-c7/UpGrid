import React from 'react';
import { View } from 'react-native';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, Chip, SectionHeader, SegmentedControl, Text, TextField, useToast } from '@/ui';
import { colors, spacing } from '@/theme';
import {
  useApproveQuestionSet, useDiscardQuestionSet, useGenerateQuestions, useQuestionSets, useUpdateQuestionSet,
} from '@/api/ai';
import type { Difficulty, QuestionItem, QuestionSet } from '@/api/aiTypes';
import { AiErrorBanner } from './kit';

export interface QuestionSetEditorProps {
  /** Application the questions are about (the candidate's apply-time snapshot is the only data the AI sees). */
  applicationId: string;
  /** Pre-fill the round, e.g. "technical". */
  defaultRoundType?: string;
  /** Optional pasted resume text, forwarded to the server. */
  resumeText?: string;
  /** Open an existing set (e.g. from GET /ai/question-sets) instead of generating. */
  initialSet?: QuestionSet;
  /** Called after the human approves the set. */
  onApproved?: (set: QuestionSet) => void;
  /** Called after the set is discarded. */
  onDiscarded?: (set: QuestionSet) => void;
  /** Called whenever the stored set changes (generated, saved, approved, discarded). */
  onChange?: (set: QuestionSet) => void;
}

const COUNTS = [3, 5, 8, 10, 15];
const DIFFS: { value: Difficulty; label: string }[] = [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/**
 * Generate interview questions from a candidate's resume snapshot, then edit, approve or discard them.
 * AI output is always a draft: nothing is attached to a scorecard until a person taps Approve.
 */
export function QuestionSetEditor({ applicationId, defaultRoundType, resumeText, initialSet, onApproved, onDiscarded, onChange }: QuestionSetEditorProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const gen = useGenerateQuestions();
  const save = useUpdateQuestionSet();
  const approve = useApproveQuestionSet();
  const discard = useDiscardQuestionSet();

  const [set, setSet] = React.useState<QuestionSet | null>(initialSet ?? null);
  const [questions, setQuestions] = React.useState<QuestionItem[]>(initialSet?.questions ?? []);
  const [dirty, setDirty] = React.useState(false);
  const [round, setRound] = React.useState(defaultRoundType ?? '');
  const [count, setCount] = React.useState(5);
  const [difficulty, setDifficulty] = React.useState<Difficulty>('medium');
  const [focus, setFocus] = React.useState('');
  const [error, setError] = React.useState<unknown>(null);

  // A different candidate must never show the previous candidate's questions.
  const lastApp = React.useRef(applicationId);
  const skipAuto = React.useRef(false);
  React.useEffect(() => {
    if (lastApp.current === applicationId) return;
    lastApp.current = applicationId;
    skipAuto.current = false;
    setSet(initialSet ?? null);
    setQuestions(initialSet?.questions ?? []);
    setDirty(false);
    setError(null);
  }, [applicationId, initialSet]);

  // Switching tabs unmounts this editor: reopen the latest stored draft instead of asking for a new (quota-costing) generation.
  const stored = useQuestionSets(initialSet ? undefined : applicationId);
  React.useEffect(() => {
    if (set || skipAuto.current || !stored.data?.length) return;
    const latest = stored.data.find((x) => x.status !== 'discarded');
    if (latest) {
      setSet(latest);
      setQuestions(latest.questions);
      setDirty(false);
    }
  }, [stored.data, set]);

  const adopt = (s: QuestionSet) => {
    setSet(s);
    setQuestions(s.questions);
    setDirty(false);
    void qc.invalidateQueries({ queryKey: ['ai', 'question-sets'] }); // so the next visit to this tab reopens the latest set
    onChange?.(s);
  };

  const roundOk = round.trim().length >= 2 && round.trim().length <= 40;
  const generate = async () => {
    setError(null);
    try {
      const focusList = focus.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
      const r = await gen.mutateAsync({ applicationId, roundType: round.trim(), count, difficulty, focus: focusList.length ? focusList : undefined, resumeText: resumeText || undefined });
      adopt(r.questionSet);
    } catch (e) {
      setError(e);
    }
  };

  const patch = (id: string, p: Partial<QuestionItem>) => {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...p } : q)));
    setDirty(true);
  };
  const remove = (id: string) => {
    setQuestions((qs) => qs.filter((q) => q.id !== id));
    setDirty(true);
  };

  const persist = async (): Promise<QuestionSet | null> => {
    if (!set) return null;
    if (!dirty) return set;
    const clean = questions.map((q) => ({ ...q, expected_points: lines(q.expected_points.join('\n')), follow_ups: lines(q.follow_ups.join('\n')) }));
    const r = await save.mutateAsync({ id: set.id, questions: clean });
    adopt(r.questionSet);
    return r.questionSet;
  };
  const onSave = async () => {
    setError(null);
    try { await persist(); toast.show('Edits saved', 'success'); } catch (e) { setError(e); }
  };
  const doApprove = async () => {
    setError(null);
    try {
      const saved = await persist();
      if (!saved) return;
      const r = await approve.mutateAsync(saved.id);
      adopt(r.questionSet);
      toast.show('Question set approved', 'success');
      onApproved?.(r.questionSet);
    } catch (e) { setError(e); }
  };
  const onApprove = () =>
    Alert.alert('Approve these questions?', 'You are confirming a person has reviewed them. Approved sets can be attached to a scorecard.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => void doApprove() },
    ]);
  const doDiscard = async () => {
    if (!set) return;
    setError(null);
    try {
      const r = await discard.mutateAsync(set.id);
      adopt(r.questionSet);
      onDiscarded?.(r.questionSet);
    } catch (e) { setError(e); }
  };
  const onDiscard = () =>
    Alert.alert('Discard this set?', 'The draft will be marked discarded and cannot be approved.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void doDiscard() },
    ]);

  const busy = save.isPending || approve.isPending || discard.isPending;
  const editable = set?.status === 'draft';

  if (!set) {
    return (
      <View style={{ gap: spacing.lg }}>
        <Banner tone="info" message="Questions are drafted from the candidate's apply-time details and the drive description. You review and approve them." />
        <TextField label="Round" value={round} onChangeText={setRound} maxLength={40} placeholder="e.g. technical, HR" />
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color={colors.muted}>Number of questions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {COUNTS.map((n) => <Chip key={n} label={String(n)} selected={count === n} onPress={() => setCount(n)} />)}
          </View>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color={colors.muted}>Difficulty</Text>
          <SegmentedControl value={difficulty} onChange={(v) => setDifficulty(v as Difficulty)} options={DIFFS} />
        </View>
        <TextField label="Focus areas (optional)" value={focus} onChangeText={setFocus} placeholder="e.g. React, SQL, projects" helper="Separate with commas, up to 8" />
        {error ? <AiErrorBanner error={error} onRetry={generate} /> : null}
        <Button label="Generate draft questions" icon="auto-awesome" full loading={gen.isPending} disabled={!roundOk} onPress={generate} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <Card tinted>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Badge label={set.status === 'draft' ? 'Draft' : set.status === 'approved' ? 'Approved' : 'Discarded'} tone={set.status === 'approved' ? 'success' : set.status === 'discarded' ? 'neutral' : 'warning'} />
            <Badge label={`${set.roundType}, ${set.difficulty}`} tone="neutral" icon={false} />
          </View>
          <Text variant="caption" color={colors.muted}>{`Based on: ${set.groundedOn.length ? set.groundedOn.join(', ') : 'application details'}`}</Text>
        </View>
      </Card>

      {questions.length === 0 ? <Banner tone="warning" message="No questions left. Discard this set and generate a new one." /> : null}

      {questions.map((q, i) => (
        <Card key={q.id}>
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <Text variant="overline" color={colors.muted}>{`Question ${i + 1}`}</Text>
              <Badge label={q.difficulty} tone="neutral" icon={false} />
            </View>
            {editable ? (
              <TextField label="Question" value={q.question} onChangeText={(v) => patch(q.id, { question: v })} multiline maxLength={600} />
            ) : (
              <Text variant="body" style={{ fontWeight: '600' }}>{q.question}</Text>
            )}
            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color={colors.muted}>Why this is asked</Text>
              <Text variant="body">{q.why_asked}</Text>
            </View>
            {q.evidence ? (
              <View style={{ gap: spacing.xs }}>
                <Text variant="caption" color={colors.muted}>{`Evidence (${q.evidence.source})`}</Text>
                <Text variant="body" style={{ fontStyle: 'italic' }}>{`"${q.evidence.quote}"`}</Text>
                {q.evidence_verified ? <Badge label="Verified in source" tone="success" /> : <Badge label="Not verified against resume/JD" tone="warning" />}
              </View>
            ) : (
              <Badge label="No evidence quoted" tone="neutral" icon="info-outline" />
            )}
            {editable ? (
              <>
                <TextField label="Expected points (one per line)" value={q.expected_points.join('\n')} onChangeText={(v) => patch(q.id, { expected_points: v.split('\n') })} multiline />
                <TextField label="Follow-ups (one per line)" value={q.follow_ups.join('\n')} onChangeText={(v) => patch(q.id, { follow_ups: v.split('\n') })} multiline />
              </>
            ) : (
              <>
                {q.expected_points.length ? <List title="Expected points" items={q.expected_points} /> : null}
                {q.follow_ups.length ? <List title="Follow-ups" items={q.follow_ups} /> : null}
              </>
            )}
            <List title="Rubric (1 to 5)" items={(['1', '2', '3', '4', '5'] as const).map((k) => `${k}: ${q.rubric?.[k] ?? '-'}`)} />
            {editable ? <Button label="Remove question" variant="ghost" icon="delete-outline" size="sm" onPress={() => remove(q.id)} /> : null}
          </View>
        </Card>
      ))}

      {error ? <AiErrorBanner error={error} /> : null}
      {editable ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Review" subtitle="Nothing is shared or attached until you approve." />
          <Button label="Save edits" variant="secondary" icon="save" full loading={save.isPending} disabled={!dirty || busy} onPress={onSave} />
          <Button label="Approve question set" icon="check" full loading={approve.isPending} disabled={questions.length === 0 || busy} onPress={onApprove} />
          <Button label="Discard set" variant="danger" icon="delete-outline" full loading={discard.isPending} disabled={busy} onPress={onDiscard} />
        </View>
      ) : (
        <Button label="Generate a new set" variant="secondary" icon="refresh" full onPress={() => { skipAuto.current = true; setSet(null); setQuestions([]); setError(null); }} />
      )}
    </View>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" color={colors.muted}>{title}</Text>
      {items.filter((x) => x.trim()).map((t, i) => <Text key={i} variant="body">{`• ${t}`}</Text>)}
    </View>
  );
}
