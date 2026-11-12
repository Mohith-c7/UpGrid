import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button, Chip, DriveCard, EmptyState, ErrorState, SearchBar, SegmentedTabs, Sheet, Skeleton, Text, useIsOnline,
} from '@/ui';
import { spacing } from '@/theme';
import { Page } from '@/features/student/me/kit';
import { flatten, useDrives, useServerOffset } from '@/api/hooks';
import type { DriveQuery, DriveSummary, EligibilityStatus } from '@/api/types';
import {
  friendlyError, isOfflineError, modeKey, useDebounced, useNow, useSaveToggle,
} from '@/features/student/discover/helpers';

type StatusF = 'all' | 'open' | 'closing' | 'closed';
type EligF = 'all' | EligibilityStatus;
type ModeF = 'all' | 'remote' | 'hybrid' | 'onsite';
type SortF = NonNullable<DriveQuery['sort']>;

const STATUS_OPTS: { value: StatusF; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'closing', label: 'Closing soon' }, { value: 'closed', label: 'Closed' },
];
const ELIG_OPTS: { value: EligF; label: string }[] = [
  { value: 'all', label: 'Any' }, { value: 'eligible', label: 'Eligible' }, { value: 'pending', label: 'Check profile' }, { value: 'not_eligible', label: 'Not eligible' },
];
const MODE_OPTS: { value: ModeF; label: string }[] = [
  { value: 'all', label: 'Any' }, { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'onsite', label: 'On-site' },
];
const SORT_OPTS: { value: SortF; label: string }[] = [
  { value: 'closing', label: 'Closing first' }, { value: 'newest', label: 'Newest' }, { value: 'package', label: 'Highest pay' },
];

export default function OpportunitiesScreen() {
  const router = useRouter();
  const online = useIsOnline();
  const offset = useServerOffset();
  const nowMs = useNow(offset);
  const save = useSaveToggle();

  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const [status, setStatus] = useState<StatusF>('all');
  const [elig, setElig] = useState<EligF>('all');
  const [mode, setMode] = useState<ModeF>('all');
  const [sort, setSort] = useState<SortF>('closing');
  const [savedOnly, setSavedOnly] = useState(false);
  const [sheet, setSheet] = useState(false);

  const query = useMemo<DriveQuery & { limit?: number }>(
    () => ({
      q: q || undefined,
      status: status === 'all' ? undefined : status,
      eligibility: elig === 'all' ? undefined : elig,
      sort,
      saved: savedOnly ? true : undefined,
      limit: 20,
    }),
    [q, status, elig, sort, savedOnly],
  );
  const res = useDrives(query);
  const all = useMemo(() => flatten(res.data), [res.data]);
  const items = useMemo(() => (mode === 'all' ? all : all.filter((d) => modeKey(d.workMode) === mode)), [all, mode]);

  // Work mode is filtered on the device; keep pulling pages while the filtered list is short.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = res;
  useEffect(() => {
    if (mode !== 'all' && items.length < 6 && hasNextPage && !isFetchingNextPage && !res.isFetching) void fetchNextPage();
  }, [mode, items.length, hasNextPage, isFetchingNextPage, res.isFetching, fetchNextPage]);

  const activeFilters = (elig !== 'all' ? 1 : 0) + (mode !== 'all' ? 1 : 0);
  const hasAnyFilter = activeFilters > 0 || savedOnly || q.length > 0 || status !== 'all';
  const clearAll = useCallback(() => {
    setText(''); setStatus('all'); setElig('all'); setMode('all'); setSavedOnly(false);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: DriveSummary }) => {
      const saved = save.isSaved(item.id, item.saved);
      return (
        <DriveCard
          drive={{ ...item, saved }}
          serverOffsetMs={offset}
          onToggleSave={() => void save.toggle(item.id, saved)}
          onPress={() => router.push(`/(student)/drive/${item.id}` as never)}
        />
      );
    },
    [offset, save, router],
  );

  const onEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const initialLoading = res.isLoading;
  const hardError = res.isError && all.length === 0;

  let body: React.ReactNode;
  if (initialLoading) {
    body = (
      <View style={{ gap: spacing.md, padding: spacing.lg }}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={196} radius={14} />)}
      </View>
    );
  } else if (hardError) {
    body = (
      <View style={{ padding: spacing.lg }}>
        <ErrorState
          message={isOfflineError(res.error) || !online ? "You're offline. Reconnect to load drives." : friendlyError(res.error)}
          onRetry={() => void res.refetch()}
        />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        renderItem={renderItem}
        extraData={[nowMs, save.overrides]}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={onEnd}
        onEndReachedThreshold={0.5}
        refreshing={res.isRefetching && !isFetchingNextPage}
        onRefresh={() => void res.refetch()}
        ListEmptyComponent={
          hasNextPage || isFetchingNextPage ? (
            <Skeleton height={196} radius={14} />
          ) : hasAnyFilter ? (
            <EmptyState
              icon="search-off"
              title={savedOnly && activeFilters === 0 && !q ? 'Nothing saved yet' : 'No drives match'}
              message={savedOnly && activeFilters === 0 && !q ? 'Tap the bookmark on a drive to keep it here. Saving is not applying.' : 'Try a different search or clear some filters.'}
              actionLabel="Clear filters"
              onAction={clearAll}
            />
          ) : (
            <EmptyState icon="work-outline" title="No drives yet" message="When your placement cell publishes a drive it will appear here." actionLabel="Refresh" onAction={() => void res.refetch()} />
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <Skeleton height={196} radius={14} />
          ) : res.isError && all.length > 0 ? (
            <ErrorState message="Could not load more drives." onRetry={() => void fetchNextPage()} />
          ) : undefined
        }
      />
    );
  }

  return (
    <Page title="Opportunities" scroll={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.sm }}>
        <SearchBar value={text} onChangeText={setText} placeholder="Search roles or companies" />
        <SegmentedTabs value={status} onChange={(v) => setStatus(v as StatusF)} options={STATUS_OPTS} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          <Chip icon="tune" label={activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'} selected={activeFilters > 0} onPress={() => setSheet(true)} />
          <Chip icon="bookmark-border" label="Saved" selected={savedOnly} onPress={() => setSavedOnly((v) => !v)} />
          {SORT_OPTS.map((o) => (
            <Chip key={o.value} label={o.label} selected={sort === o.value} onPress={() => setSort(o.value)} />
          ))}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>{body}</View>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filters">
        <View style={{ gap: spacing.lg }}>
          <FilterGroup title="Eligibility" value={elig} options={ELIG_OPTS} onChange={setElig} />
          <FilterGroup title="Work mode" value={mode} options={MODE_OPTS} onChange={setMode} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button label="Reset" variant="secondary" full onPress={() => { setElig('all'); setMode('all'); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Done" full onPress={() => setSheet(false)} />
            </View>
          </View>
        </View>
      </Sheet>
    </Page>
  );
}

function Separator() {
  return <View style={{ height: spacing.md }} />;
}

function FilterGroup<T extends string>({
  title, value, options, onChange,
}: { title: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="subhead">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}
