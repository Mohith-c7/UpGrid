import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Badge, Banner, Button, Card, CodeBlock, EmptyState, ErrorState, Header, Icon, MetricRow, OfflineBanner, Screen, SectionHeader, Skeleton, Text } from '@/ui';
import { colors, MIN_TOUCH, SCREEN_PADDING } from '@/theme';
import { ApiError } from '@/api/client';
import { useResult } from '@/api/tests';
import type { ReviewItem } from '@/api/testsTypes';
import { formatDateTimeIST } from '@/lib/format';
import { describeAnswer, fmtDuration, fmtMarks, MarkdownLite, netMessage, sp, VerdictBadge } from '@/features/tests/kit';

const SUBMIT_REASON: Record<string, string> = {
  student: 'You submitted the test.',
  deadline: 'Submitted automatically when time ended.',
  proctor: 'Submitted automatically after the warning limit was reached.',
  closed: 'Submitted automatically when the test window closed.',
  admin: 'Submitted by the placement cell.',
};

const CORRECT_BADGE: Record<ReviewItem['correct'], { label: string; tone: 'success' | 'warning' | 'error' | 'neutral'; icon: React.ComponentProps<typeof Badge>['icon'] }> = {
  correct: { label: 'Correct', tone: 'success', icon: 'check-circle' },
  partial: { label: 'Partly correct', tone: 'warning', icon: 'timelapse' },
  wrong: { label: 'Wrong', tone: 'error', icon: 'cancel' },
  unanswered: { label: 'Not answered', tone: 'neutral', icon: 'remove-circle-outline' },
};

function ReviewCard({ r }: { r: ReviewItem }) {
  const [open, setOpen] = useState(false);
  const b = CORRECT_BADGE[r.correct];
  return (
    <Card padding={0}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Question ${r.number}, ${b.label}, ${fmtMarks(r.score)} of ${fmtMarks(r.maxScore)} marks`}
        style={({ pressed }) => ({ minHeight: MIN_TOUCH + 8, padding: sp.lg, gap: sp.sm, backgroundColor: pressed ? colors.surfaceAlt : 'transparent', borderRadius: 14 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>{`${r.number}. ${r.title}`}</Text>
          <Icon name={open ? 'expand-less' : 'expand-more'} size={24} color={colors.muted} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, flexWrap: 'wrap' }}>
          <Badge label={b.label} tone={b.tone} icon={b.icon} />
          <Text variant="caption" tabular color={colors.muted}>{`${fmtMarks(r.score)} of ${fmtMarks(r.maxScore)} marks`}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={{ padding: sp.lg, gap: sp.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <MarkdownLite text={r.body} />
          <View style={{ gap: sp.xs }}>
            <Text variant="caption" style={{ fontWeight: '700' }} color={colors.textSecondary}>Your answer</Text>
            <Text variant="body">{describeAnswer(r.type, r.yourAnswer, r.options)}</Text>
          </View>
          {r.type !== 'coding' && r.correctAnswer !== undefined ? (
            <View style={{ gap: sp.xs }}>
              <Text variant="caption" style={{ fontWeight: '700' }} color={colors.textSecondary}>Correct answer</Text>
              <Text variant="body">{describeAnswer(r.type, r.correctAnswer, r.options)}</Text>
            </View>
          ) : null}
          {r.explanation ? (
            <View style={{ gap: sp.xs }}>
              <Text variant="caption" style={{ fontWeight: '700' }} color={colors.textSecondary}>Explanation</Text>
              <MarkdownLite text={r.explanation} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Body({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const q = useResult(attemptId);
  const backToList = () => router.replace('/(student)/tests' as never);

  if (q.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}><Skeleton height={140} /><Skeleton height={100} /><Skeleton height={100} /></View>;
  if (q.isError || !q.data) {
    if (q.error instanceof ApiError && q.error.code === 'ATTEMPT_NOT_SUBMITTED') {
      return (
        <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>
          <Banner tone="info" title="This attempt is still in progress" message="You can see the result after you submit." />
          <Button label="Back to the test" full onPress={() => router.replace(`/(student)/tests/attempt/${attemptId}` as never)} />
        </View>
      );
    }
    if (q.error instanceof ApiError && q.error.status === 404) {
      return <View style={{ padding: SCREEN_PADDING }}><EmptyState icon="assignment-late" title="Result not found" message="This attempt does not exist or is not yours." actionLabel="My tests" onAction={backToList} /></View>;
    }
    return <View style={{ padding: SCREEN_PADDING }}><ErrorState title="Could not load the result" message={netMessage(q.error)} onRetry={() => void q.refetch()} /></View>;
  }

  const d = q.data;
  if (!d.available) {
    const m: Record<string, { title: string; message: string; icon: React.ComponentProps<typeof Banner>['icon'] }> = {
      AFTER_CLOSE: { title: 'Your answers are submitted', message: `Results are shown after the test window closes${d.releaseAt ? `, from ${formatDateTimeIST(d.releaseAt)}` : ''}.`, icon: 'event-available' },
      MANUAL: { title: 'Your answers are submitted', message: 'The placement cell will release results for this test. You will get a notification.', icon: 'event-available' },
      EVALUATION_PENDING: { title: 'Evaluating your answers', message: 'Coding answers are checked in the background. This page refreshes by itself.', icon: 'hourglass-empty' },
    };
    const x = m[d.reason] ?? m.MANUAL;
    return (
      <View style={{ padding: SCREEN_PADDING, gap: sp.lg }}>
        <Banner tone={d.reason === 'EVALUATION_PENDING' ? 'info' : 'success'} title={x.title} message={x.message} icon={x.icon} />
        <Button label="Check again" variant="secondary" icon="refresh" full loading={q.isRefetching} onPress={() => void q.refetch()} />
        <Button label="Back to my tests" variant="ghost" full onPress={backToList} />
      </View>
    );
  }

  const r = d.result;
  const passedBadge = r.passed == null ? null : r.passed ? <Badge label="Passed" tone="success" icon="check-circle" /> : <Badge label="Did not pass" tone="error" icon="cancel" />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, gap: sp.xl }}>
      <OfflineBanner />
      {r.evaluation === 'pending' ? (
        <Banner tone="info" icon="hourglass-empty" title="Still evaluating" message="Some coding answers are being judged. Your score can still change. This page refreshes by itself." />
      ) : null}
      <Card tinted>
        <View style={{ gap: sp.md }}>
          <Text variant="overline" color={colors.muted}>Your score</Text>
          <Text variant="display" tabular accessibilityLabel={`Score ${fmtMarks(r.score)} out of ${fmtMarks(r.maxScore)}`}>{`${fmtMarks(r.score)} / ${fmtMarks(r.maxScore)}`}</Text>
          <Text variant="subhead" tabular>{`${fmtMarks(r.percent)}%`}</Text>
          {passedBadge}
        </View>
      </Card>

      <Card>
        <MetricRow label="Rank" value={r.rank != null ? `${r.rank} of ${r.totalParticipants}` : 'Not ranked'} />
        {r.percentile != null ? <MetricRow label="Percentile" value={fmtMarks(r.percentile)} /> : null}
        <MetricRow label="Time taken" value={fmtDuration(r.timeTakenSeconds)} />
        <MetricRow label="Proctor warnings" value={r.warnings} tone={r.warnings > 0 ? 'warning' : undefined} last />
      </Card>
      {r.submitReason && SUBMIT_REASON[r.submitReason] ? <Text variant="caption" color={colors.muted}>{SUBMIT_REASON[r.submitReason]}</Text> : null}

      {(r.sections ?? []).length > 0 ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Section scores" />
          <Card>
            {(r.sections ?? []).map((s, i) => (
              <View key={s.id} style={{ borderBottomWidth: i === (r.sections ?? []).length - 1 ? 0 : 1, borderBottomColor: colors.border, paddingVertical: sp.sm, gap: sp.xs }}>
                <MetricRow label={s.title} value={`${fmtMarks(s.score)} / ${fmtMarks(s.maxScore)}`} last />
                {s.cutoffMarks != null ? (
                  <Badge label={s.cutoffMet ? `Cutoff of ${fmtMarks(s.cutoffMarks)} met` : `Cutoff of ${fmtMarks(s.cutoffMarks)} not met`} tone={s.cutoffMet ? 'success' : 'error'} />
                ) : null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {(r.coding ?? []).length > 0 ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Coding questions" />
          {(r.coding ?? []).map((c) => (
            <Card key={c.questionId}>
              <View style={{ gap: sp.sm }}>
                <Text variant="subhead">{c.title}</Text>
                <VerdictBadge verdict={c.verdict} />
                <Text variant="caption" tabular color={colors.muted}>
                  {`${c.passed} of ${c.total} tests passed, ${fmtMarks(c.score)} of ${fmtMarks(c.maxScore)} marks${c.language ? `, ${c.language}` : ''}`}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Answer review" />
        {d.review === null ? (
          <Banner tone="info" icon="visibility-off" message="The placement cell has not enabled answer review for this test." />
        ) : d.review.length === 0 ? (
          <EmptyState icon="rule" title="Nothing to review" />
        ) : (
          d.review.map((rv) => <ReviewCard key={rv.questionId} r={rv} />)
        )}
      </View>
      <Button label="Back to my tests" variant="secondary" full onPress={backToList} />
    </ScrollView>
  );
}

export default function ResultScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  return (
    <Screen padded={false} edges={['bottom']}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="Result" onBack={() => router.replace('/(student)/tests' as never)} />
      <View style={{ flex: 1 }}>
        <Body attemptId={String(attemptId)} />
      </View>
    </Screen>
  );
}
