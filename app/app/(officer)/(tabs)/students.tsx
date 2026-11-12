import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Chip, Header, OfflineBanner, Screen, SearchBar, SegmentedTabs } from '@/ui';
import { colors } from '@/theme';
import { useStudents } from '@/features/officer/data';
import { QueryBoundary, StudentCard } from '@/features/officer/components/common';
import type { StudentRow } from '@/features/officer/types';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

const V = [{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'pending', label: 'Pending' }, { value: 'unverified', label: 'Unverified' }];

export default function StudentsTab() {
  const r = useRouter();
  const [text, setText] = useState('');
  const [qd, setQd] = useState('');
  const [verified, setVerified] = useState('all');
  const [batch, setBatch] = useState<string | undefined>();
  useEffect(() => { const t = setTimeout(() => setQd(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const q = useStudents({ q: qd, verified: verified === 'all' ? undefined : verified, batch });
  const all: StudentRow[] = useMemo(() => {
    const seen = new Set<string>();
    return (q.data?.pages.flatMap((p) => p.items) ?? []).filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }, [q.data]);
  // The server only knows verified / not verified; split "pending review" from "unverified" here.
  const items = useMemo(
    () => (verified === 'pending' ? all.filter((s) => s.verification === 'pending') : verified === 'unverified' ? all.filter((s) => s.verification !== 'pending' && s.verification !== 'verified') : all),
    [all, verified],
  );
  const clientFiltered = verified === 'pending' || verified === 'unverified';
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => { if (clientFiltered && items.length < 8 && hasNextPage && !isFetchingNextPage && !q.isError) void fetchNextPage(); }, [clientFiltered, items.length, hasNextPage, isFetchingNextPage, fetchNextPage, q.isError]);
  const year = new Date().getFullYear();
  const filtered = verified !== 'all' || !!batch || qd.length > 0;

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <SearchBar value={text} onChangeText={setText} placeholder="Search name, email or reg. no." />
      <SegmentedTabs value={verified} onChange={setVerified} options={V} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Batch filter">
        <Chip label="All batches" selected={!batch} onPress={() => setBatch(undefined)} />
        {[year, year + 1, year + 2].map((y) => <Chip key={y} label={`Batch ${y}`} selected={batch === String(y)} onPress={() => setBatch(batch === String(y) ? undefined : String(y))} />)}
      </ScrollView>
    </View>
  );

  return (
    <Screen>
      <FocusedStatusBar />
      <View style={{ paddingHorizontal: 16 }}>
        <OfflineBanner />
        <Header title="Students" />
      </View>
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !isFetchingNextPage} onRefresh={() => { void q.refetch(); }} colors={[colors.primary]} tintColor={colors.primary} />}
        renderItem={({ item }) => <StudentCard s={item} onPress={() => r.push(`/(officer)/student/${item.id}`)} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }}
        ListEmptyComponent={
          <QueryBoundary
            isLoading={q.isLoading || (clientFiltered && items.length === 0 && !!hasNextPage)} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} skeletonRows={5} skeletonHeight={96}
            isEmpty
            empty={{ icon: 'school', title: filtered ? 'No students match' : 'No students yet', message: filtered ? 'Adjust the search or filters.' : 'Students appear here after they register.' }}
          >
            {null}
          </QueryBoundary>
        }
        ListFooterComponent={
          isFetchingNextPage ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading more" /></View>
            : q.isError && items.length > 0 ? <View style={{ paddingVertical: 12, alignItems: 'center' }}><Button label="Could not load more. Retry" variant="ghost" onPress={async () => { await fetchNextPage(); }} /></View>
            : undefined
        }
      />
    </Screen>
  );
}
