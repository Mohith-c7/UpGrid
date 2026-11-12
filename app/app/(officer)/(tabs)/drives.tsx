import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Header, OfflineBanner, Screen, SearchBar, SegmentedTabs } from '@/ui';
import { colors } from '@/theme';
import { useDrivesOfficer } from '@/features/officer/data';
import { DriveCard, QueryBoundary } from '@/features/officer/components/common';
import type { DriveItem } from '@/features/officer/types';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'closing', label: 'Closing' },
  { value: 'closed', label: 'Closed' }, { value: 'draft', label: 'Drafts' },
];

export default function DrivesTab() {
  const r = useRouter();
  const [status, setStatus] = useState('all');
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const q = useDrivesOfficer(status === 'all' ? undefined : status, debounced);
  const seen = new Set<string>();
  const items: DriveItem[] = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const filtered = status !== 'all' || debounced.length > 0;

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <SearchBar value={text} onChangeText={setText} placeholder="Search company or role" />
      <SegmentedTabs value={status} onChange={setStatus} options={FILTERS} />
    </View>
  );

  return (
    <Screen>
      <FocusedStatusBar />
      <View style={{ paddingHorizontal: 16 }}>
        <OfflineBanner />
        <Header title="Drives" right={<Button label="New drive" icon="add" size="sm" onPress={() => r.push('/(officer)/drive/new')} />} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { void q.refetch(); }} colors={[colors.primary]} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <DriveCard d={item} onPress={() => r.push(item.status === 'draft' ? `/(officer)/drive/new?draftId=${item.id}` : `/(officer)/drive/${item.id}`)} />
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        ListEmptyComponent={
          <QueryBoundary
            isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} skeletonRows={4} skeletonHeight={156}
            isEmpty
            empty={{
              icon: 'work-outline',
              title: filtered ? 'No drives match' : 'No drives yet',
              message: filtered ? 'Try a different filter or search.' : 'Create your first drive to start collecting applications.',
              actionLabel: filtered ? undefined : 'Create drive',
              onAction: filtered ? undefined : () => r.push('/(officer)/drive/new'),
            }}
          >
            {null}
          </QueryBoundary>
        }
        ListFooterComponent={
          q.isFetchingNextPage ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading more" /></View>
            : q.isError && items.length > 0 ? <View style={{ paddingVertical: 12, alignItems: 'center' }}><Button label="Could not load more. Retry" variant="ghost" onPress={async () => { await q.fetchNextPage(); }} /></View>
            : undefined
        }
      />
    </Screen>
  );
}
