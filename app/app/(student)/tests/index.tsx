import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Header, Icon, OfflineBanner, Screen, SegmentedTabs, Skeleton, Text } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { flatten } from '@/api/hooks';
import { useMyAssessments, useTestsFeatures } from '@/api/tests';
import type { Bucket, MyAssessmentItem } from '@/api/testsTypes';
import { formatDateTimeIST, durationText } from '@/lib/format';
import { effectiveBucket, TestsGate, useServerNow } from '@/features/tests/Gate';
import { fmtMarks, fmtMinutes, netMessage, plural, sp } from '@/features/tests/kit';

const TABS: { value: Bucket; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Completed' },
];

function TestCard({ t, bucket, nowMs, onPress }: { t: MyAssessmentItem; bucket: Bucket; nowMs: number; onPress: () => void }) {
  const resume = !!t.activeAttempt && bucket === 'live';
  const opensIn = t.opensAt ? Date.parse(t.opensAt) - nowMs : 0;
  let status: React.ReactNode;
  if (resume) status = <Badge label="In progress" tone="info" icon="play-circle-outline" />;
  else if (bucket === 'live') status = <Badge label="Live now" tone="success" icon="radio-button-checked" />;
  else if (bucket === 'upcoming') status = <Badge label={opensIn > 0 ? `Opens in ${durationText(opensIn)}` : 'Opening'} tone="warning" icon="schedule" />;
  else if (t.attemptsUsed === 0) status = <Badge label="Missed" tone="neutral" icon="event-busy" />;
  else if (t.myScore) status = <Badge label={`${fmtMarks(t.myScore.score)} of ${fmtMarks(t.myScore.maxScore)}`} tone={t.myScore.passed === false ? 'error' : 'success'} icon="emoji-events" />;
  else status = <Badge label={t.resultReleased ? 'Result ready' : 'Result pending'} tone="neutral" icon="hourglass-empty" />;

  return (
    <Card onPress={onPress} accessibilityLabel={`${t.title}. ${bucket}`}>
      <View style={{ gap: sp.sm }}>
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start' }}>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>{t.title}</Text>
          <Icon name="chevron-right" size={24} color={colors.subtle} />
        </View>
        {t.drive ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{`${t.drive.company}, ${t.drive.role}`}</Text> : null}
        {status}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: sp.lg, rowGap: 2 }}>
          <Text variant="caption" tabular color={colors.textSecondary}>{fmtMinutes(t.durationMinutes)}</Text>
          <Text variant="caption" tabular color={colors.textSecondary}>{plural(t.questionCount, 'question')}</Text>
          <Text variant="caption" tabular color={colors.textSecondary}>{`${fmtMarks(t.totalMarks)} marks`}</Text>
        </View>
        {t.opensAt || t.closesAt ? (
          <Text variant="caption" tabular color={colors.muted}>
            {bucket === 'upcoming' && t.opensAt ? `Opens ${formatDateTimeIST(t.opensAt)}` : t.closesAt ? `${bucket === 'past' ? 'Closed' : 'Closes'} ${formatDateTimeIST(t.closesAt)}` : ''}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function Body() {
  const router = useRouter();
  const [tab, setTab] = useState<Bucket>('live');
  const q = useMyAssessments('all');
  const nowMs = useServerNow(15000);
  const all = useMemo(() => flatten(q.data), [q.data]);
  const rows = useMemo(() => all.map((t) => ({ t, b: effectiveBucket(t, nowMs) })), [all, nowMs]);
  const counts = useMemo(() => ({
    live: rows.filter((r) => r.b === 'live').length,
    upcoming: rows.filter((r) => r.b === 'upcoming').length,
    past: rows.filter((r) => r.b === 'past').length,
  }), [rows]);
  const items = useMemo(() => {
    const list = rows.filter((r) => r.b === tab).map((r) => r.t);
    const time = (x: MyAssessmentItem) => Date.parse((tab === 'past' ? x.closesAt : x.opensAt) ?? '') || 0;
    return list.sort((a, b) => (tab === 'past' ? time(b) - time(a) : time(a) - time(b)));
  }, [rows, tab]);
  const active = useMemo(() => all.find((t) => t.activeAttempt && Date.parse(t.activeAttempt.deadlineAt) > nowMs), [all, nowMs]);
  const refresh = useCallback(() => void q.refetch(), [q]);
  const open = (t: MyAssessmentItem) => router.push(`/(student)/tests/${t.id}` as never);

  const header = (
    <View style={{ gap: sp.md, paddingBottom: sp.md }}>
      <OfflineBanner />
      {active ? (
        <Banner
          tone="info"
          title="You have a test in progress"
          message={`${active.title}. The timer is running.`}
          icon="timer"
          action={{ label: 'Resume test', onPress: () => router.push(`/(student)/tests/attempt/${active.activeAttempt!.id}` as never) }}
        />
      ) : null}
      <SegmentedTabs value={tab} onChange={(v) => setTab(v as Bucket)} options={TABS.map((x) => ({ ...x, count: q.isLoading ? undefined : counts[x.value] }))} />
    </View>
  );

  if (q.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>{header}{[0, 1, 2].map((i) => <Skeleton key={i} height={128} radius={14} />)}</View>;
  if (q.isError && all.length === 0) {
    return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}><ErrorState title="Could not load your tests" message={netMessage(q.error)} onRetry={refresh} /></View>;
  }

  const emptyCopy: Record<Bucket, { title: string; message: string }> = {
    live: { title: 'No live tests', message: 'When a test window opens for you, it shows up here. You will also get a reminder.' },
    upcoming: { title: 'Nothing scheduled', message: 'Tests assigned to you appear here before they open.' },
    past: { title: 'No completed tests yet', message: 'Tests you take, and tests you missed, are listed here with results.' },
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, flexGrow: 1 }}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: sp.md }} />}
      renderItem={({ item }) => <TestCard t={item} bucket={tab} nowMs={nowMs} onPress={() => open(item)} />}
      ListEmptyComponent={<EmptyState icon="assignment" title={emptyCopy[tab].title} message={emptyCopy[tab].message} actionLabel="Refresh" onAction={refresh} />}
      ListFooterComponent={
        <View style={{ gap: sp.md, paddingTop: sp.xl }}>
          {q.hasNextPage ? <Button label="Load more" variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} full /> : null}
          <PracticeLink />
        </View>
      }
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
    />
  );
}

function PracticeLink() {
  const router = useRouter();
  return (
    <Card tinted onPress={() => router.push('/(student)/tests/practice' as never)} accessibilityLabel="Practice. Coding problems and practice sets">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Icon name="code" size={24} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="subhead">Practice</Text>
          <Text variant="caption" color={colors.muted}>Coding problems and practice sets. Not graded, no rank.</Text>
        </View>
        <Icon name="chevron-right" size={24} color={colors.subtle} />
      </View>
    </Card>
  );
}

export default function TestsList() {
  const router = useRouter();
  const focused = useIsFocused();
  useTestsFeatures();
  return (
    <Screen padded={false} edges={['bottom']}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="My tests" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)' as never))} />
      <View style={{ flex: 1 }}>
        <TestsGate>
          <Body />
        </TestsGate>
      </View>
    </Screen>
  );
}
