import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, CodeBlock, ErrorState, KeyValueList, SectionHeader, Sheet, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { useAnswerSheet, useOverride, type AnswerSheetAnswer } from '@/api/assessments';
import { formatDateTimeIST } from '@/lib/format';
import { ConfirmSheet, Frame, NumberField, TYPE_LABEL, fmtDuration, fmtNum, parseNum } from '@/features/assessments/kit';

const CORRECT_BADGE: Record<string, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral'; icon: any }> = {
  correct: { label: 'Correct', tone: 'success', icon: 'check-circle-outline' },
  partial: { label: 'Partial', tone: 'warning', icon: 'timelapse' },
  wrong: { label: 'Wrong', tone: 'error', icon: 'cancel' },
  unanswered: { label: 'Not answered', tone: 'neutral', icon: 'remove-circle-outline' },
};
const VERDICT_TONE = (v?: string) => (v === 'accepted' ? 'success' : v === 'wrong_answer' || v === 'compile_error' || v === 'runtime_error' ? 'error' : 'warning') as 'success' | 'error' | 'warning';

function fmtAnswer(type: string, v: any): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return 'Not answered';
  if (type === 'mcq_single') return String(v).toUpperCase();
  if (type === 'mcq_multi') return (Array.isArray(v) ? v : [v]).map((x) => String(x).toUpperCase()).join(', ');
  if (type === 'short_text' && Array.isArray(v)) return v.join(' | ');
  if (type === 'coding') return v?.language ? `${v.language}` : 'Code';
  return String(v);
}

function AnswerCard({ a }: { a: AnswerSheetAnswer }) {
  const b = CORRECT_BADGE[a.correct] ?? CORRECT_BADGE.unanswered;
  const code = a.type === 'coding' ? (a.answer as any)?.code as string | undefined : undefined;
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Text variant="overline" color={colors.muted}>Question {a.number}</Text>
        <Badge label={TYPE_LABEL[a.type]} tone="info" />
        <Badge label={b.label} tone={b.tone} icon={b.icon} />
        {a.flagged ? <Badge label="Flagged by student" tone="neutral" icon="flag" /> : null}
      </View>
      <Text variant="subhead">{a.title}</Text>
      <Text variant="body" tabular>Score {fmtNum(a.score)} / {fmtNum(a.maxScore)}</Text>
      <KeyValueList items={[
        { label: 'Student answer', value: fmtAnswer(a.type, a.answer) },
        ...(a.type !== 'coding' ? [{ label: 'Correct answer', value: fmtAnswer(a.type, a.correctAnswer) }] : []),
        { label: 'Time spent', value: a.timeSpentMs ? fmtDuration(Math.round(a.timeSpentMs / 1000)) : '-' },
      ]} />
      {code ? <CodeBlock label={`Final code (${(a.answer as any).language})`} code={code} /> : null}
      {a.submissions?.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Judged submissions ({a.submissions.length})</Text>
          {a.submissions.slice(-5).map((s) => (
            <View key={s.id} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Badge label={String(s.verdict ?? s.status ?? 'pending').replace(/_/g, ' ')} tone={VERDICT_TONE(s.verdict)} />
                <Text variant="caption" tabular color={colors.muted}>{s.language} · {s.passed}/{s.total} tests · {fmtNum(s.score)} marks</Text>
              </View>
              {s.createdAt ? <Text variant="caption" color={colors.muted}>{formatDateTimeIST(s.createdAt)}</Text> : null}
            </View>
          ))}
          {a.submissions.length > 5 ? <Text variant="caption" color={colors.muted}>Showing the latest 5.</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function AttemptSheet() {
  const { id, attemptId } = useLocalSearchParams<{ id: string; attemptId: string }>();
  const toast = useToast();
  const q = useAnswerSheet(id, attemptId);
  const ov = useOverride();
  const [open, setOpen] = useState(false); const [clearOpen, setClearOpen] = useState(false);
  const [score, setScore] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const max = d?.attempt.maxScore ?? 0;
  useEffect(() => { if (open && d) { setScore(d.override ? String(d.override.score) : ''); setReason(''); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const sv = parseNum(score);
  const sErr = score.trim() !== '' && (sv === null || sv < 0 || sv > max) ? `Score must be between 0 and ${fmtNum(max)}.` : null;
  const rErr = reason.trim().length < 3 ? 'Enter a reason (3 to 300 characters).' : null;

  const run = async (clear: boolean) => {
    setErr(null);
    try {
      await ov.mutateAsync({ id: id!, attemptId: attemptId!, score: clear ? null : sv, reason: reason.trim() || (clear ? 'Override removed' : '') });
      toast.show(clear ? 'Override removed' : 'Score overridden', 'success'); setOpen(false); setClearOpen(false);
    } catch (e) { setErr(e instanceof ApiError && e.fields?.score ? e.fields.score : errMessage(e)); }
  };

  if (q.isLoading || q.isError || !d) {
    return (
      <Frame title="Answer sheet">
        {q.isError ? <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} /> : <><Skeleton height={140} radius={14} /><Skeleton height={160} radius={14} /><Skeleton height={160} radius={14} /></>}
      </Frame>
    );
  }
  const at = d.attempt;
  const submitted = at.status === 'submitted';
  return (
    <Frame title={d.student.name} subtitle={d.student.registrationNumber ?? d.student.email} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={submitted ? <Button label={d.override ? 'Change score override' : 'Override score'} icon="edit" full onPress={() => setOpen(true)} /> : undefined}>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Badge label={submitted ? 'Submitted' : 'In progress'} tone={submitted ? 'info' : 'warning'} />
          {at.passed === true ? <Badge label="Passed" tone="success" icon="check-circle-outline" /> : at.passed === false ? <Badge label="Failed" tone="error" icon="cancel" /> : null}
          {at.evaluation === 'pending' ? <Badge label="Evaluating" tone="warning" icon="hourglass-empty" /> : null}
          {d.override ? <Badge label="Score overridden" tone="info" icon="edit" /> : null}
        </View>
        <KeyValueList items={[
          { label: 'Score', value: at.score != null ? `${fmtNum(at.score)} / ${fmtNum(at.maxScore)}` : '-' },
          ...(d.override ? [{ label: 'Effective score', value: `${fmtNum(at.effectiveScore)} / ${fmtNum(at.maxScore)}` }] : []),
          { label: 'Attempt', value: at.attemptNo != null ? `#${at.attemptNo}` : '-' },
          { label: 'Submitted', value: at.submittedAt ? formatDateTimeIST(at.submittedAt) : 'Not yet' },
          { label: 'How it ended', value: at.submitReason ? at.submitReason.replace(/_/g, ' ') : '-' },
          { label: 'Proctor warnings', value: String(at.warnings ?? 0) },
        ]} />
      </Card>
      {d.override ? <Banner tone="info" title="Score override" message={`Set to ${fmtNum(d.override.score)}. Reason: ${d.override.reason}`} action={{ label: 'Remove override', onPress: () => setClearOpen(true) }} /> : null}
      {at.evaluation === 'pending' ? <Banner tone="warning" message="Coding answers are still being judged. Scores may change." /> : null}

      <SectionHeader title="Answers" subtitle={`${d.answers.length} questions`} />
      {d.answers.map((a) => <AnswerCard key={a.questionId} a={a} />)}

      {d.proctorEvents.length ? (
        <>
          <SectionHeader title="Proctoring log" subtitle="Counted events become warnings" />
          <Card padding={0} style={{ paddingHorizontal: 16 }}>
            {d.proctorEvents.map((e, i) => (
              <View key={i} style={{ paddingVertical: 10, borderBottomWidth: i === d.proctorEvents.length - 1 ? 0 : 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text variant="caption" style={{ flex: 1 }}>{e.type.replace(/_/g, ' ')}{e.counted ? ' (warning)' : ''}</Text>
                <Text variant="caption" color={colors.muted} tabular>{formatDateTimeIST(e.createdAt)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Override score">
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <Text variant="caption" color={colors.muted}>The computed score is {fmtNum(at.score)} out of {fmtNum(max)}. The override replaces it in rank, pass and shortlist. Regrading never erases it.</Text>
          {err ? <Banner tone="error" message={err} /> : null}
          <NumberField label="New score" value={score} onChange={setScore} error={sErr} helper={`0 to ${fmtNum(max)}`} />
          <TextField label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} multiline maxLength={300} error={reason ? rErr : null} />
          <Button label="Save override" full loading={ov.isPending} disabled={sv === null || !!sErr || !!rErr} onPress={() => run(false)} />
        </View>
      </Sheet>
      <ConfirmSheet visible={clearOpen} onClose={() => setClearOpen(false)} title="Remove the override?" confirmLabel="Remove override" tone="danger"
        message="The score goes back to the computed value." onConfirm={() => run(true)} disabled={ov.isPending}>
        {err ? <Banner tone="error" message={err} /> : null}
      </ConfirmSheet>
    </Frame>
  );
}
