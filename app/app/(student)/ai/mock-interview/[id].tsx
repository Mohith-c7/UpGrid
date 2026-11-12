import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, MetricRow, ProgressBar, SectionHeader, Skeleton, Text, TextField } from '@/ui';
import { Icon } from '@/ui';
import { colors } from '@/theme';
import { Page, sp } from '@/features/student/me/kit';
import { errMessage } from '@/api/client';
import { useAnswerMock, useFinishMock, useMockDetail } from '@/api/ai';
import type { MockFeedback, MockQuestion, MockReport } from '@/api/aiTypes';
import { AiErrorBanner, AiGate, AI_ROUTES, TYPE_LABEL } from '@/features/ai/kit';

const MAX = 4000;

export default function MockInterviewSession() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace(AI_ROUTES.mock as never));
  return (
    <Page title="Mock interview" onBack={back} keyboard>
      <AiGate>{() => <Session id={String(id)} />}</AiGate>
    </Page>
  );
}

function Session({ id }: { id: string }) {
  const router = useRouter();
  const detail = useMockDetail(id);
  const answerM = useAnswerMock(id);
  const finishM = useFinishMock(id);
  const [current, setCurrent] = React.useState<MockQuestion | null>(null);
  const [pendingNext, setPendingNext] = React.useState<MockQuestion | null>(null);
  const [feedback, setFeedback] = React.useState<{ index: number; fb: MockFeedback } | null>(null);
  const [allAnswered, setAllAnswered] = React.useState(false);
  const [answer, setAnswer] = React.useState('');
  const [report, setReport] = React.useState<MockReport | null>(null);
  const seeded = React.useRef(false);

  const d = detail.data;
  React.useEffect(() => {
    if (!d || seeded.current) return;
    if (d.report) { setReport(d.report); seeded.current = true; return; }
    const open = d.turns.find((t) => t.answer == null);
    if (open) { setCurrent({ index: open.index, text: open.question }); seeded.current = true; }
    else if (d.turns.length > 0) { setAllAnswered(true); seeded.current = true; }
  }, [d]);

  if (detail.isLoading) return <View style={{ gap: sp.md }}><Skeleton height={120} radius={14} /><Skeleton height={160} radius={14} /></View>;
  if (detail.isError && !d) return <ErrorState title="Could not open this interview" message={errMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  if (!d) return <EmptyState title="Interview not found" message="It may have been deleted." actionLabel="Back" onAction={() => router.replace(AI_ROUTES.mock as never)} />;

  const iv = d.interview;
  const answered = d.turns.filter((t) => t.answer != null).length;

  if (report) return <ReportView role={iv.role} report={report} turns={d.turns} onDone={() => router.replace(AI_ROUTES.mock as never)} />;

  const submit = async () => {
    if (!current) return;
    try {
      const r = await answerM.mutateAsync({ answer: answer.trim(), questionIndex: current.index });
      setFeedback({ index: current.index, fb: r.feedback });
      setPendingNext(r.next);
      setAllAnswered(r.done || !r.next);
      setAnswer('');
    } catch (e) {
      const code = (e as any)?.code;
      if (code === 'STALE_QUESTION') {
        // the answer was already stored (e.g. a lost reply): re-read the interview and move to its real open question
        seeded.current = false;
        void detail.refetch();
      }
    }
  };
  const finish = async () => {
    try {
      const r = await finishM.mutateAsync();
      setReport(r.report);
    } catch { /* shown below */ }
  };

  const shownAnswered = Math.max(answered, feedback ? feedback.index : 0);
  const header = (
    <Card tinted>
      <View style={{ gap: sp.sm }}>
        <Text variant="subhead" numberOfLines={2}>{iv.role}</Text>
        <Text variant="caption" color={colors.muted}>{`${TYPE_LABEL[iv.type]}, ${iv.difficulty}${iv.personalised ? ', personalised' : ''}`}</Text>
        <ProgressBar value={iv.numQuestions ? shownAnswered / iv.numQuestions : 0} label={`${shownAnswered} of ${iv.numQuestions} answered`} />
        <Text variant="caption" tabular color={colors.muted}>{`${shownAnswered} of ${iv.numQuestions} answered`}</Text>
      </View>
    </Card>
  );

  /* feedback for the answer just given */
  if (feedback) {
    return (
      <View style={{ gap: sp.xl }}>
        {header}
        <FeedbackCard index={feedback.index} fb={feedback.fb} />
        {finishM.isError ? <AiErrorBanner error={finishM.error} onRetry={finish} /> : null}
        {pendingNext && !allAnswered ? (
          <Button label="Next question" icon="arrow-forward" full onPress={() => { setCurrent(pendingNext); setPendingNext(null); setFeedback(null); }} />
        ) : (
          <Button label="Finish and see report" icon="flag" full loading={finishM.isPending} onPress={finish} />
        )}
      </View>
    );
  }

  /* all questions answered, report not generated yet */
  if (allAnswered || !current) {
    return (
      <View style={{ gap: sp.xl }}>
        {header}
        <Banner tone="success" title="All questions answered" message="Finish to get your feedback summary." />
        {finishM.isError ? <AiErrorBanner error={finishM.error} onRetry={finish} /> : null}
        <Button label="Finish and see report" icon="flag" full loading={finishM.isPending} onPress={finish} disabled={answered === 0 && !feedback} />
      </View>
    );
  }

  const tooShort = answer.trim().length < 1;
  return (
    <View style={{ gap: sp.xl }}>
      {header}
      <Card>
        <View style={{ gap: sp.sm }}>
          <Text variant="overline" color={colors.muted}>{`Question ${current.index} of ${iv.numQuestions}`}</Text>
          <Text variant="heading" selectable>{current.text}</Text>
        </View>
      </Card>
      <TextField label="Your answer" value={answer} onChangeText={setAnswer} multiline maxLength={MAX} placeholder="Type your answer as you would say it" />
      {answerM.isError ? <AiErrorBanner error={answerM.error} onRetry={submit} onConsent={() => router.push(AI_ROUTES.consent as never)} /> : null}
      <Button label="Submit answer" icon="send" full loading={answerM.isPending} disabled={tooShort} onPress={submit} />
      {answered >= 1 ? (
        <Button label="Finish now" variant="ghost" full loading={finishM.isPending} onPress={finish} />
      ) : null}
      {finishM.isError ? <AiErrorBanner error={finishM.error} onRetry={finish} /> : null}
    </View>
  );
}

function Bullets({ title, items, icon, color }: { title: string; items: string[]; icon: 'check-circle' | 'trending-up'; color: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: sp.sm }}>
      <Text variant="caption" color={colors.muted}>{title}</Text>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: sp.sm }}>
          <Icon name={icon} size={20} color={color} />
          <Text variant="body" style={{ flex: 1, minWidth: 0 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function FeedbackCard({ index, fb }: { index: number; fb: MockFeedback }) {
  return (
    <Card>
      <View style={{ gap: sp.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>{`Feedback on question ${index}`}</Text>
          <Badge label={`${fb.score} / 10`} tone="info" />
        </View>
        <Text variant="body">{fb.summary}</Text>
        <Bullets title="What worked" items={fb.strengths ?? []} icon="check-circle" color={colors.success} />
        <Bullets title="To improve" items={fb.improve ?? []} icon="trending-up" color={colors.warning} />
        <Text variant="caption" color={colors.muted}>Advisory score for practice only.</Text>
      </View>
    </Card>
  );
}

function ReportView({ role, report, turns, onDone }: { role: string; report: MockReport; turns: { index: number; answer: string | null }[]; onDone: () => void }) {
  const overall = Math.max(0, Math.min(100, Math.round(report.overall)));
  const parts = ([
    { label: 'Communication', s: report.communication },
    { label: 'Technical depth', s: report.technical_depth },
    { label: 'Structure (STAR)', s: report.structure_star },
  ] as { label: string; s?: { score: number; notes: string } }[]).filter((p): p is { label: string; s: { score: number; notes: string } } => !!p.s);
  return (
    <View style={{ gap: sp.xl }}>
      <Card tinted>
        <View style={{ gap: sp.sm }}>
          <Text variant="caption" color={colors.muted} numberOfLines={2}>{role}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
            <Text variant="display" tabular>{String(overall)}</Text>
            <Text variant="subhead" color={colors.muted}>/ 100</Text>
          </View>
          <View style={{ flexDirection: 'row' }}><Badge label="Advisory score" tone="info" icon="info-outline" /></View>
          <Text variant="caption" color={colors.muted}>Practice feedback only. It is not shared with recruiters or the placement cell.</Text>
        </View>
      </Card>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="How you did" />
        <Card>
          <View style={{ gap: sp.lg }}>
            {parts.map((p) => (
              <View key={p.label} style={{ gap: sp.xs }}>
                <MetricRow label={p.label} value={`${p.s.score} / 10`} last />
                <Text variant="caption" color={colors.textSecondary}>{p.s.notes}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      {(report.top_tips ?? []).length ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Top tips" />
          <Card><Bullets title="" items={report.top_tips ?? []} icon="trending-up" color={colors.primary} /></Card>
        </View>
      ) : null}

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Question by question" />
        {(report.per_question ?? []).map((q) => (
          <Card key={q.index}>
            <View style={{ gap: sp.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
                <Text variant="overline" color={colors.muted} style={{ flex: 1 }}>{`Question ${q.index}`}</Text>
                <Badge label={`${q.score} / 10`} tone="info" />
              </View>
              <Text variant="body" style={{ fontWeight: '600' }}>{q.question}</Text>
              <Text variant="caption" color={colors.textSecondary}>{q.comment}</Text>
            </View>
          </Card>
        ))}
      </View>
      <Button label="Back to mock interviews" variant="secondary" full onPress={onDone} />
    </View>
  );
}
