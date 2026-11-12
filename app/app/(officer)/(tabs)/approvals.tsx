import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Header, OfflineBanner, Screen, SegmentedTabs, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { errFields, errMessage, publishDrive, useDrivesOfficer, useInvalidateOfficer, useStudents } from '@/features/officer/data';
import { DriveCard, QueryBoundary, StudentCard, useOnce } from '@/features/officer/components/common';
import type { DriveItem, StudentRow } from '@/features/officer/types';
import { confirm } from '@/features/pipeline/kit';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

type Tab = 'drafts' | 'students';

export default function Approvals() {
  const r = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateOfficer();
  const [tab, setTab] = useState<Tab>('drafts');
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; messages: string[] } | null>(null);
  const drives = useDrivesOfficer('draft');
  const students = useStudents({ verified: 'pending' });
  const draftItems: DriveItem[] = useMemo(() => drives.data?.pages.flatMap((p) => p.items) ?? [], [drives.data]);
  // server "not verified" also includes students with nothing to review; keep only those with changes waiting
  const studentItems: StudentRow[] = useMemo(() => {
    const seen = new Set<string>();
    return (students.data?.pages.flatMap((p) => p.items) ?? []).filter((s) => s.verification === 'pending' && !seen.has(s.id) && (seen.add(s.id), true));
  }, [students.data]);
  const sNext = students.hasNextPage, sFetching = students.isFetchingNextPage, sFetch = students.fetchNextPage;
  useEffect(() => { if (tab === 'students' && studentItems.length < 8 && sNext && !sFetching && !students.isError) void sFetch(); }, [tab, studentItems.length, sNext, sFetching, sFetch, students.isError]);

  const [approve] = useOnce(async (id: string) => {
    setPublishingId(id); setBlocked(null);
    try { await publishDrive(id); toast.show('Drive published', 'success'); void invalidate(); }
    catch (e) {
      const f = errFields(e);
      if (f && Object.keys(f).length) setBlocked({ id, messages: Object.values(f) });
      else toast.show(errMessage(e), 'error');
    } finally { setPublishingId(null); }
  });

  const onDrafts = tab === 'drafts';
  const active = onDrafts ? drives : students;
  const refresh = () => { void drives.refetch(); void students.refetch(); };

  return (
    <Screen>
      <FocusedStatusBar />
      <View style={{ paddingHorizontal: 16 }}>
        <OfflineBanner />
        <Header title="Approvals" subtitle="Publish drafts and verify student details" />
      </View>
      <FlatList<DriveItem | StudentRow>
        key={tab}
        data={onDrafts ? draftItems : studentItems}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={(drives.isRefetching || students.isRefetching) && !sFetching} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <SegmentedTabs
              value={tab}
              onChange={(v) => setTab(v === 'students' ? 'students' : 'drafts')}
              options={[
                { value: 'drafts', label: 'Draft drives', count: drives.isLoading || drives.hasNextPage ? undefined : draftItems.length },
                { value: 'students', label: 'Verifications', count: students.isLoading || sNext ? undefined : studentItems.length },
              ]}
            />
            <Text variant="caption" color={colors.muted}>
              {onDrafts ? 'Review a draft, then publish it so students can apply.' : 'Check marksheets or university records before verifying a student\'s details.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => onDrafts ? (
          <View style={{ gap: 8 }}>
            <DriveCard
              d={item as DriveItem}
              onPress={() => r.push(`/(officer)/drive/${item.id}`)}
              footer={
                <View style={{ gap: 8 }}>
                  {blocked?.id === item.id ? <Banner tone="error" title="Cannot publish yet" message={blocked.messages.slice(0, 4).join('. ')} /> : null}
                  <Button label="Publish" icon="publish" size="sm" full loading={publishingId === item.id} disabled={publishingId !== null} onPress={() => confirm('Publish this drive?', `${(item as DriveItem).company?.name ?? 'This drive'} will become visible and open for eligible students to apply.`, 'Publish', () => void approve(item.id), false)} />
                </View>
              }
            />
          </View>
        ) : (
          <StudentCard s={item as StudentRow} onPress={() => r.push(`/(officer)/student/${item.id}`)} />
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (active.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage(); }}
        ListEmptyComponent={
          <QueryBoundary
            isLoading={active.isLoading || (!onDrafts && !!sNext)} isError={active.isError} error={active.error} onRetry={() => { void active.refetch(); }}
            skeletonRows={3} skeletonHeight={onDrafts ? 190 : 96}
            isEmpty
            empty={onDrafts
              ? { icon: 'task-alt', title: 'No drafts waiting', message: 'Saved drive drafts appear here so you can review and publish them.' }
              : { icon: 'verified', title: 'Nothing to verify', message: 'Students who update academic details show up here for review.' }}
          >
            {null}
          </QueryBoundary>
        }
        ListFooterComponent={active.isFetchingNextPage ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading more" /></View> : undefined}
      />
    </Screen>
  );
}
