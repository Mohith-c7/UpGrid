import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, EmptyState, ListRow, OfflineBanner, Screen, ScreenHero, SectionHeader, Skeleton, StatTile, Text } from '@/ui';
import { colors } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { useAuth } from '@/api/hooks';
import { useFeature } from '@/config/features';
import { useDashboard } from '@/features/officer/data';
import { DriveCard, greetingIST } from '@/features/officer/components/common';
import { spacing } from '@/features/officer/layout';

export default function Dashboard() {
  const r = useRouter();
  const q = useDashboard();
  const auth = useAuth();
  const testsOn = useFeature('assessments');
  const d = q.data;
  const first = (auth.user?.name ?? '').trim().split(/\s+/)[0] || 'Placement cell';
  const open = d?.openDrives ?? 0;
  const summary = d
    ? d.closingToday > 0
      ? `${open} open ${open === 1 ? 'drive' : 'drives'}, ${d.closingToday} closing today.`
      : `${open} open ${open === 1 ? 'drive' : 'drives'}. Nothing closes today.`
    : '';

  return (
    <Screen scroll padded={false} edges={['bottom']} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
      <ScreenHero eyebrow={greetingIST(getServerOffsetMs())} title={first} subtitle="Placement cell dashboard">
        <Card padding={16} style={{ gap: 12 }}>
          {q.isLoading ? (
            <Skeleton height={20} width="70%" radius={6} />
          ) : (
            <Text variant="body" color={colors.textSecondary} accessibilityLiveRegion="polite">
              {q.isError ? 'Could not load today\'s numbers.' : summary}
            </Text>
          )}
          <Button label="Create drive" icon="add" full onPress={() => r.push('/(officer)/drive/new')} />
        </Card>
      </ScreenHero>

      <View style={{ padding: 16, gap: spacing[4] }}>
        <OfflineBanner />
        {q.isLoading ? (
          <View style={{ gap: spacing[3] }} accessibilityLabel="Loading">
            <View style={{ flexDirection: 'row', gap: spacing[3] }}><View style={{ flex: 1 }}><Skeleton height={132} radius={14} /></View><View style={{ flex: 1 }}><Skeleton height={132} radius={14} /></View></View>
            <View style={{ flexDirection: 'row', gap: spacing[3] }}><View style={{ flex: 1 }}><Skeleton height={132} radius={14} /></View><View style={{ flex: 1 }}><Skeleton height={132} radius={14} /></View></View>
            <Skeleton height={132} radius={14} />
          </View>
        ) : q.isError || !d ? (
          <Banner tone="error" title="Dashboard unavailable" message={(q.error as any)?.message ?? 'Could not load. Check your connection and retry.'} action={{ label: 'Try again', onPress: () => { void q.refetch(); } }} />
        ) : (
          <>
            {d.pendingVerifications > 0 ? (
              <Banner
                tone="warning"
                title={`${d.pendingVerifications} ${d.pendingVerifications === 1 ? 'verification needs' : 'verifications need'} review`}
                message="Students are waiting for their academic details to be checked."
                action={{ label: 'Review now', onPress: () => r.push('/(officer)/(tabs)/approvals') }}
              />
            ) : null}
            <View style={{ gap: spacing[3] }}>
              <View style={{ flexDirection: 'row', gap: spacing[3] }}>
                <StatTile label="Open drives" value={d.openDrives} icon="work-outline" onPress={() => r.push('/(officer)/(tabs)/drives')} />
                <StatTile label="Closing today" value={d.closingToday} icon="timer" tone={d.closingToday > 0 ? 'warning' : 'neutral'} onPress={() => r.push('/(officer)/(tabs)/drives')} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing[3] }}>
                <StatTile label="Applications today" value={d.applicationsToday} icon="assignment" />
                <StatTile label="Pending verifications" value={d.pendingVerifications} icon="fact-check" tone={d.pendingVerifications > 0 ? 'warning' : 'neutral'} onPress={() => r.push('/(officer)/(tabs)/approvals')} />
              </View>
            </View>

            {testsOn ? (
              <Card padding={0} style={{ paddingHorizontal: 16 }}>
                <ListRow icon="quiz" title="Tests and question bank" subtitle="Build online tests, review results, shortlist" onPress={() => r.push('/(officer)/assessments')} last />
              </Card>
            ) : null}

            <SectionHeader title="Upcoming deadlines" action={d.upcoming?.length ? { label: 'All drives', onPress: () => r.push('/(officer)/(tabs)/drives') } : undefined} />
            {d.upcoming?.length ? (
              <View style={{ gap: spacing[3] }}>
                {d.upcoming.map((x) => <DriveCard key={x.id} d={x} onPress={() => r.push(`/(officer)/drive/${x.id}`)} />)}
              </View>
            ) : (
              <EmptyState icon="event-available" title="No upcoming deadlines" message="Published drives with future deadlines appear here." />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
