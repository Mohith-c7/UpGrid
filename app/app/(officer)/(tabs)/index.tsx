import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, EmptyState, IconBadge, MetricStrip, OfflineBanner, Panel, PanelRow, Screen, ScreenHero, Skeleton, Text } from '@/ui';
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
        {q.isError && !d ? (
          <Banner tone="error" title="Dashboard unavailable" message={(q.error as any)?.message ?? 'Could not load. Check your connection and retry.'} action={{ label: 'Try again', onPress: () => { void q.refetch(); } }} />
        ) : (
          <>
            <MetricStrip
              loading={q.isLoading}
              items={[
                { label: 'Open drives', value: d?.openDrives ?? 0, onPress: () => r.push('/(officer)/(tabs)/drives') },
                { label: 'Closing today', value: d?.closingToday ?? 0, tone: (d?.closingToday ?? 0) > 0 ? 'warning' : undefined, onPress: () => r.push('/(officer)/(tabs)/drives') },
                { label: 'Applied today', value: d?.applicationsToday ?? 0 },
                { label: 'To verify', value: d?.pendingVerifications ?? 0, tone: (d?.pendingVerifications ?? 0) > 0 ? 'warning' : undefined, onPress: () => r.push('/(officer)/(tabs)/approvals') },
              ]}
            />

            {q.isLoading ? (
              <View style={{ gap: spacing[3] }} accessibilityLabel="Loading">
                <Skeleton height={120} radius={12} />
                <Skeleton height={180} radius={12} />
              </View>
            ) : d ? (
              <>
                {d.pendingVerifications > 0 || d.closingToday > 0 ? (
                  <Panel title="Needs your attention">
                    {d.pendingVerifications > 0 ? (
                      <PanelRow
                        left={<IconBadge name="fact-check" tone="warning" />}
                        title={`${d.pendingVerifications} ${d.pendingVerifications === 1 ? 'student' : 'students'} waiting for verification`}
                        subtitle="Check academic details so they can apply"
                        onPress={() => r.push('/(officer)/(tabs)/approvals')}
                        last={d.closingToday === 0}
                      />
                    ) : null}
                    {d.closingToday > 0 ? (
                      <PanelRow
                        left={<IconBadge name="timer" tone="warning" />}
                        title={`${d.closingToday} ${d.closingToday === 1 ? 'drive closes' : 'drives close'} today`}
                        subtitle="Remind students before applications close"
                        onPress={() => r.push('/(officer)/(tabs)/drives')}
                        last
                      />
                    ) : null}
                  </Panel>
                ) : null}

                <Panel
                  title="Upcoming deadlines"
                  action={d.upcoming?.length ? { label: 'All drives', onPress: () => r.push('/(officer)/(tabs)/drives') } : undefined}
                >
                  {d.upcoming?.length ? (
                    <View style={{ padding: 12, gap: spacing[3] }}>
                      {d.upcoming.map((x) => <DriveCard key={x.id} d={x} onPress={() => r.push(`/(officer)/drive/${x.id}`)} />)}
                    </View>
                  ) : (
                    <EmptyState icon="event-available" title="No upcoming deadlines" message="Published drives with future deadlines appear here." />
                  )}
                </Panel>

                {testsOn ? (
                  <Panel>
                    <PanelRow left={<IconBadge name="quiz" />} title="Tests and question bank" subtitle="Build online tests, review results, shortlist" onPress={() => r.push('/(officer)/assessments')} last />
                  </Panel>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
