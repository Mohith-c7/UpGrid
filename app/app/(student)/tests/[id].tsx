import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Badge, Banner, Button, Card, Checkbox, EmptyState, ErrorState, Header, KeyValueList, OfflineBanner, Screen, SectionHeader, Skeleton, Text } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { ApiError } from '@/api/client';
import { useMyAssessment, useStartAttempt } from '@/api/tests';
import { durationText, formatDateTimeIST } from '@/lib/format';
import { TestsGate } from '@/features/tests/Gate';
import { fmtMarks, fmtMinutes, MarkdownLite, netMessage, plural, sp } from '@/features/tests/kit';

const VISIBILITY: Record<string, string> = {
  immediate: 'Shown right after your test is evaluated',
  after_close: 'Shown after the test window closes',
  manual: 'Shown when the placement cell releases results',
};

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const q = useMyAssessment(id);
  const start = useStartAttempt();
  const [agree, setAgree] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const d = q.data;
  // Server clock: offset = serverNow (from the response) - the device time when it arrived.
  const offset = useMemo(() => (d ? Date.parse(d.serverNow) - (q.dataUpdatedAt || Date.now()) : 0), [d, q.dataUpdatedAt]);
  const nowMs = Date.now() + offset + 0 * tick;

  if (q.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}><Skeleton height={80} /><Skeleton height={160} /><Skeleton height={120} /></View>;
  if (q.isError || !d) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.code === 'ASSESSMENT_NOT_FOUND');
    return (
      <View style={{ padding: SCREEN_PADDING }}>
        {notFound ? (
          <EmptyState icon="assignment-late" title="Test not found" message="This test is not assigned to you, or it was removed." actionLabel="Back to my tests" onAction={() => router.replace('/(student)/tests' as never)} />
        ) : (
          <ErrorState title="Could not load this test" message={netMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </View>
    );
  }

  const a = d.assessment;
  const opensMs = a.opensAt ? Date.parse(a.opensAt) : null;
  const closesMs = a.closesAt ? Date.parse(a.closesAt) : null;
  const active = a.activeAttempt && Date.parse(a.activeAttempt.deadlineAt) > nowMs ? a.activeAttempt : null;
  const notOpen = opensMs !== null && nowMs < opensMs;
  const closed = closesMs !== null && nowMs >= closesMs;
  const noAttempts = a.attemptsUsed >= a.attemptsAllowed && !active;
  const canStart = !active && !notOpen && !closed && !noAttempts && a.canStart !== false;
  const unlimited = a.attemptsAllowed > 50;

  const doStart = async () => {
    setStartError(null);
    try {
      const s = await start.mutateAsync(a.id);
      router.replace(`/(student)/tests/attempt/${s.attempt.id}` as never);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'NOT_OPEN_YET') setStartError('This test has not opened yet according to the server clock. Wait for the start time.');
      else if (code === 'ASSESSMENT_CLOSED') setStartError('This test window has closed.');
      else if (code === 'MAX_ATTEMPTS_REACHED') setStartError('You have used all your attempts.');
      else setStartError(netMessage(e, 'Could not start the test.'));
      void q.refetch();
    }
  };

  const rules = [
    { label: 'Duration', value: fmtMinutes(a.durationMinutes) },
    { label: 'Questions', value: a.questionCount },
    { label: 'Total marks', value: fmtMarks(a.totalMarks) },
    { label: 'Negative marking', value: a.settings.negativeMarking ? 'Yes. Wrong answers can lose marks.' : 'No' },
    { label: 'Attempts', value: unlimited ? 'Unlimited' : `${a.settings.maxAttempts} allowed, ${a.attemptsUsed} used` },
    { label: 'Question order', value: a.settings.randomised ? 'Shuffled for each student' : 'Fixed' },
    { label: 'Ranking', value: a.settings.rankingEnabled ? 'Yes' : 'No rank is shown' },
    { label: 'Results', value: VISIBILITY[a.settings.resultVisibility] ?? a.settings.resultVisibility },
    { label: 'Review answers afterwards', value: a.settings.allowReview ? 'Allowed' : 'Not allowed' },
  ];

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, gap: sp.xl }} keyboardShouldPersistTaps="handled">
        <OfflineBanner />
        <View style={{ gap: sp.xs }}>
          <Text variant="title">{a.title}</Text>
          {a.drive ? <Text variant="body" color={colors.muted}>{`${a.drive.company}, ${a.drive.role}`}</Text> : null}
        </View>

        {active ? (
          <Banner tone="info" icon="timer" title="Your attempt is in progress" message={`Time left: ${durationText(Date.parse(active.deadlineAt) - nowMs)}. The timer runs on the server.`} />
        ) : notOpen && opensMs ? (
          <Banner tone="warning" icon="schedule" title={`Opens in ${durationText(opensMs - nowMs)}`} message={`Start window opens ${formatDateTimeIST(a.opensAt)}. This uses the server clock, not your phone clock.`} />
        ) : closed ? (
          <Banner tone="error" icon="event-busy" title="This test has closed" message={a.closesAt ? `The window ended ${formatDateTimeIST(a.closesAt)}.` : undefined as never} />
        ) : noAttempts ? (
          <Banner tone="warning" title="No attempts left" message="You have used every attempt for this test." />
        ) : closesMs ? (
          <Banner tone="success" icon="radio-button-checked" title="Open now" message={`You can start until ${formatDateTimeIST(a.closesAt)}. Once started you get the full duration, or until the window closes, whichever is earlier.`} />
        ) : null}

        <Card>
          <KeyValueList inline items={[
            ...(a.opensAt ? [{ label: 'Opens', value: formatDateTimeIST(a.opensAt) }] : []),
            ...(a.closesAt ? [{ label: 'Closes', value: formatDateTimeIST(a.closesAt) }] : []),
            ...rules,
          ]} />
        </Card>

        {a.settings.proctoring?.enabled ? (
          <Banner
            tone="info"
            icon="visibility"
            title="Proctoring is on"
            message={`Switching to another app or leaving the test screen is recorded as a warning${a.settings.proctoring?.maxWarnings ? ` (up to ${a.settings.proctoring.maxWarnings})` : ''}${a.settings.proctoring?.autoSubmit ? ' and the test is submitted automatically at the limit' : ''}. Only these events are logged. Nothing else on your phone is monitored.`}
          />
        ) : null}

        <View style={{ gap: sp.md }}>
          <SectionHeader title="Sections" />
          {(a.sections ?? []).map((s, i) => (
            <Card key={s.id}>
              <View style={{ gap: sp.xs }}>
                <Text variant="subhead">{`${i + 1}. ${s.title}`}</Text>
                <Text variant="caption" tabular color={colors.muted}>
                  {`${plural(s.questionCount, 'question')}${s.timeLimitMinutes ? `, ${fmtMinutes(s.timeLimitMinutes)} for this section` : ''}${s.cutoffMarks ? `, cutoff ${fmtMarks(s.cutoffMarks)} marks` : ''}`}
                </Text>
              </View>
            </Card>
          ))}
          {(a.sections ?? []).some((s) => s.timeLimitMinutes) ? (
            <Banner tone="warning" icon="lock" title="Timed sections" message="Sections open one after another. When you move to the next section, or its time runs out, you cannot go back to the earlier one." />
          ) : null}
        </View>

        {a.instructions?.trim() ? (
          <View style={{ gap: sp.md }}>
            <SectionHeader title="Instructions" />
            <Card><MarkdownLite text={a.instructions} /></Card>
          </View>
        ) : null}

        {(d.attempts ?? []).length > 0 ? (
          <View style={{ gap: sp.md }}>
            <SectionHeader title="Your attempts" />
            {(d.attempts ?? []).map((t) => (
              <Card key={t.id}>
                <View style={{ gap: sp.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.sm, flexWrap: 'wrap' }}>
                    <Text variant="subhead">{`Attempt ${t.attemptNo}`}</Text>
                    {t.status === 'in_progress' ? <Badge label="In progress" tone="info" icon="timer" /> : t.evaluation === 'pending' ? <Badge label="Evaluating" tone="warning" icon="hourglass-empty" /> : <Badge label="Submitted" tone="success" />}
                  </View>
                  <Text variant="caption" tabular color={colors.muted}>
                    {t.submittedAt ? `Submitted ${formatDateTimeIST(t.submittedAt)}` : `Started ${formatDateTimeIST(t.startedAt)}`}
                  </Text>
                  {t.status === 'submitted' ? (
                    <Button label="View result" variant="secondary" size="sm" onPress={() => router.push(`/(student)/tests/result/${t.id}` as never)} />
                  ) : (
                    <Button label="Continue" variant="secondary" size="sm" onPress={() => router.push(`/(student)/tests/attempt/${t.id}` as never)} />
                  )}
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: SCREEN_PADDING, paddingTop: sp.md, paddingBottom: sp.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: sp.sm }}>
        {startError ? <Banner tone="error" message={startError} /> : null}
        {active ? (
          <Button label="Resume test" icon="play-arrow" full onPress={() => router.push(`/(student)/tests/attempt/${active.id}` as never)} />
        ) : canStart ? (
          <>
            <Checkbox checked={agree} onChange={setAgree} accessibilityLabel="I have read the instructions and rules">
              <Text variant="body">I have read the instructions and rules above.</Text>
            </Checkbox>
            <Button label={a.attemptsUsed > 0 ? 'Start another attempt' : 'Start test'} icon="play-arrow" full disabled={!agree} loading={start.isPending} onPress={doStart} />
          </>
        ) : (
          <Button label={notOpen ? 'Not open yet' : closed ? 'Closed' : 'No attempts left'} full disabled onPress={() => undefined} />
        )}
      </View>
    </>
  );
}

export default function TestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  return (
    <Screen padded={false} edges={['bottom']}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="Test details" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/tests' as never))} />
      <View style={{ flex: 1 }}>
        <TestsGate>
          <Detail id={String(id)} />
        </TestsGate>
      </View>
    </Screen>
  );
}
