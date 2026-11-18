import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, ErrorState, SegmentedTabs, Skeleton } from '@/ui';
import { useApplications, errMessage, isNetworkError, type AppRow } from '@/features/student/me/data';
import { Page, sp } from '@/features/student/me/kit';
import { ApplicationCard } from '@/features/student/me/ApplicationCard';

const TABS = [
  { key: 'all', label: 'All', test: (_: AppRow) => true },
  { key: 'active', label: 'In progress', test: (a: AppRow) => ['submitted', 'screening', 'assessment', 'interview'].includes(a.status) },
  { key: 'offers', label: 'Offers', test: (a: AppRow) => ['selected', 'offer_issued', 'offer_accepted', 'joined'].includes(a.status) },
  { key: 'closed', label: 'Closed', test: (a: AppRow) => ['rejected', 'withdrawn', 'offer_declined'].includes(a.status) },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function Gap() {
  return <View style={{ height: sp.md }} />;
}

export default function ApplicationsTab() {
  const router = useRouter();
  const q = useApplications();
  const [tab, setTab] = useState<TabKey>('all');
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const rows = useMemo(() => all.filter(current.test), [all, current]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, all.filter(t.test).length])) as Record<TabKey, number>, [all]);

  const renderItem = useCallback(
    ({ item: a }: { item: AppRow }) => (
      <ApplicationCard app={a} onPress={() => router.push(`/(student)/application/${a.id}` as never)} />
    ),
    [router],
  );

  let body: React.ReactNode;
  if (q.isLoading) {
    body = <View style={{ padding: sp.lg, gap: sp.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={168} radius={12} />)}</View>;
  } else if (q.isError && all.length === 0) {
    body = (
      <View style={{ padding: sp.lg }}>
        <ErrorState title="Could not load applications" message={isNetworkError(q.error) ? 'You appear to be offline or the server is unreachable. Check your connection and retry.' : errMessage(q.error)} onRetry={() => void q.refetch()} />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ padding: sp.lg, paddingBottom: sp.xxxl, flexGrow: 1 }}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        ListEmptyComponent={
          all.length === 0 ? (
            <EmptyState icon="assignment" title="No applications yet" message="When you apply to a drive it shows up here with every update from the placement cell." actionLabel="Browse opportunities" onAction={() => router.push('/(student)/(tabs)/opportunities' as never)} />
          ) : q.hasNextPage ? (
            <Skeleton height={196} radius={14} />
          ) : (
            <EmptyState icon="filter-list" title={`Nothing under "${current.label}"`} message="Switch to another tab to see your other applications." actionLabel="Show all" onAction={() => setTab('all')} />
          )
        }
        ListFooterComponent={
          q.isFetchNextPageError ? (
            <View style={{ paddingTop: sp.md }}><ErrorState title="Could not load more" message="Check your connection and try again." onRetry={() => void q.fetchNextPage()} /></View>
          ) : q.hasNextPage ? (
            <View style={{ paddingTop: sp.md }}><Button label="Load more" variant="secondary" full loading={q.isFetchingNextPage} onPress={async () => { await q.fetchNextPage(); }} /></View>
          ) : undefined
        }
      />
    );
  }

  return (
    <Page title="Applications" scroll={false}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <SegmentedTabs
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
          options={TABS.map((t) => ({ value: t.key, label: t.label, count: q.data ? counts[t.key] : undefined }))}
        />
      </View>
      <View style={{ flex: 1 }}>{body}</View>
    </Page>
  );
}
