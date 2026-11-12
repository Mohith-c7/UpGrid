import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Card, EmptyState, MetricRow, ProgressBar, SectionHeader, StatTile, Text } from '@/ui';
import { colors } from '@/theme';
import { Page, QueryBoundary, sp } from '@/features/student/me/kit';
import { useFeature } from '@/config/features';
import { usePublicStats, isMissingRoute } from '@/api/studentExtras';
import { formatLpa } from '@/lib/format';

const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}%` : 'Not shown');

function GroupRow({ name, students, placedPct }: { name: string; students: number; placedPct: number | null }) {
  return (
    <View style={{ gap: sp.sm, paddingVertical: sp.md }} accessible accessibilityLabel={`${name}, ${students} students, ${pct(placedPct)} placed`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md }}>
        <Text variant="body" style={{ flex: 1, minWidth: 0, fontWeight: '600' }}>{name}</Text>
        <Text variant="body" tabular style={{ fontWeight: '600' }}>{pct(placedPct)}</Text>
      </View>
      <ProgressBar value={typeof placedPct === 'number' ? placedPct / 100 : 0} />
      <Text variant="caption" tabular color={colors.muted}>{`${students} students`}</Text>
    </View>
  );
}

/** Campus placement stats from GET /stats/public: anonymised, small groups hidden by the server. */
export default function CampusStatsScreen() {
  const router = useRouter();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)' as never)), [router]);
  const on = useFeature('opsAnalytics');
  const q = usePublicStats(on);
  const s = q.data;
  const unavailable = !on || (q.isError && isMissingRoute(q.error));
  const k = s?.minGroupSize ?? 5;
  const hidden = s?.suppressedGroups ?? 0;

  return (
    <Page title="Campus placement stats" onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} gap={sp.xl}>
      {unavailable ? (
        <EmptyState icon="insights" title="Stats are not available" message="Your placement cell has not turned on campus statistics." />
      ) : (
        <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} skeletonRows={3} skeletonHeight={110}>
          {s && !s.enabled ? (
            <EmptyState icon="visibility-off" title="Not published yet" message="Your placement cell has not shared campus statistics. Check back after the season progresses." />
          ) : s ? (
            <View style={{ gap: sp.xl }}>
              <Banner tone="info" message={`Anonymous totals for your campus. Any group with fewer than ${k} students is hidden so nobody can be identified.`} />

              <View style={{ flexDirection: 'row', gap: sp.md }}>
                <StatTile label="Students" value={s.totals?.students ?? 0} icon="groups" />
                <StatTile label="Placed" value={pct(s.totals?.placedPct)} icon="work-outline" />
              </View>

              <View style={{ gap: sp.md }}>
                <SectionHeader title="Salary (LPA)" subtitle="Annual packages of placed students" />
                {s.ctc ? (
                  <Card>
                    <MetricRow label="Average" value={s.ctc.averageLpa != null ? formatLpa(s.ctc.averageLpa) : '-'} />
                    <MetricRow label="Median" value={s.ctc.medianLpa != null ? formatLpa(s.ctc.medianLpa) : '-'} />
                    <MetricRow last label="Highest" value={s.ctc.highestLpa != null ? formatLpa(s.ctc.highestLpa) : "-"} />
                  </Card>
                ) : (
                  <Card><Text variant="body" color={colors.muted}>{`Salary figures appear once at least ${k} students are placed, to protect privacy.`}</Text></Card>
                )}
              </View>

              <View style={{ gap: sp.md }}>
                <SectionHeader title="By branch" />
                {(s.byBranch ?? []).length === 0 ? (
                  <Card><Text variant="body" color={colors.muted}>{`No branch has ${k} or more students yet, so none can be shown.`}</Text></Card>
                ) : (
                  <Card>{(s.byBranch ?? []).map((b, i, a) => (
                    <View key={b.department} style={i < a.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.border } : undefined}>
                      <GroupRow name={b.department} students={b.students} placedPct={b.placedPct} />
                    </View>
                  ))}</Card>
                )}
              </View>

              <View style={{ gap: sp.md }}>
                <SectionHeader title="By batch" />
                {(s.byBatch ?? []).length === 0 ? (
                  <Card><Text variant="body" color={colors.muted}>{`No batch has ${k} or more students yet, so none can be shown.`}</Text></Card>
                ) : (
                  <Card>{(s.byBatch ?? []).map((b, i, a) => (
                    <View key={b.batchYear} style={i < a.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.border } : undefined}>
                      <GroupRow name={`Batch ${b.batchYear}`} students={b.students} placedPct={b.placedPct} />
                    </View>
                  ))}</Card>
                )}
              </View>

              {hidden > 0 ? (
                <Text variant="caption" color={colors.muted}>{`${hidden} ${hidden === 1 ? 'group is' : 'groups are'} hidden because ${hidden === 1 ? 'it has' : 'they have'} fewer than ${k} students.`}</Text>
              ) : null}
              <Text variant="caption" color={colors.muted}>Percentages are shares of students in each group who are placed. Figures update as the placement cell records offers.</Text>
            </View>
          ) : null}
        </QueryBoundary>
      )}
    </Page>
  );
}
