import React, { useCallback, useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, EmptyState, ErrorState, HeaderAction, Icon, Skeleton, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import type { Notification as NotificationRow } from '@/api/types';
import { errMessage, isNetworkError, isRead, useMarkRead, useNotifications, useUnreadCount } from '@/features/student/me/data';
import { Page, sp, timeAgo, useBack, useOnce } from '@/features/student/me/kit';

function Gap() {
  return <View style={{ height: sp.md }} />;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const toast = useToast();
  const back = useBack('/(student)/(tabs)');
  const q = useNotifications();
  const mark = useMarkRead();
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const unreadQ = useUnreadCount();
  const unread = unreadQ.data ?? items.filter((n) => !isRead(n)).length;

  const [markAll] = useOnce(async () => {
    try { await mark.mutateAsync({ all: true }); toast.show('All marked as read', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
  });

  const open = useCallback((n: NotificationRow) => {
    if (!isRead(n)) mark.mutateAsync({ ids: [n.id] }).catch(() => undefined); // failure just leaves it unread
    const d = n.data;
    if (d?.applicationId) router.push(`/(student)/application/${d.applicationId}` as never);
    else if (d?.driveId) router.push(`/(student)/drive/${d.driveId}` as never);
  }, [mark, router]);

  const renderItem = useCallback(({ item: n }: { item: NotificationRow }) => {
    const unreadRow = !isRead(n);
    const target = n.data?.applicationId ? 'View application' : n.data?.driveId ? 'View drive' : null;
    const icon = n.data?.applicationId ? 'assignment' : n.data?.driveId ? 'work-outline' : 'campaign';
    return (
      <Card
        onPress={target ? () => open(n) : unreadRow ? () => open(n) : undefined}
        accessibilityLabel={`${unreadRow ? 'Unread. ' : ''}${n.title}. ${n.body}`}
        style={unreadRow ? { borderColor: colors.primary } : undefined}
      >
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: unreadRow ? colors.primaryTint2 : colors.neutralBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={22} color={unreadRow ? colors.primaryDark : colors.muted} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: sp.xs }}>
            <Text variant="subhead" numberOfLines={3} ellipsizeMode="tail" style={{ fontWeight: unreadRow ? '700' : '500' }}>{n.title}</Text>
            <Text variant="body" color={unreadRow ? colors.ink : colors.muted}>{n.body}</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              {unreadRow ? <Badge label="New" tone="info" icon="fiber-manual-record" /> : null}
              <Text variant="caption" color={colors.muted} tabular>{timeAgo(n.createdAt)}</Text>
              {target ? <Text variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>{target}</Text> : null}
            </View>
          </View>
        </View>
      </Card>
    );
  }, [open]);

  let body: React.ReactNode;
  if (q.isLoading) {
    body = <View style={{ padding: sp.lg, gap: sp.md }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={110} radius={14} />)}</View>;
  } else if (q.isError && items.length === 0) {
    body = (
      <View style={{ padding: sp.lg }}>
        <ErrorState message={isNetworkError(q.error) ? 'You appear to be offline or the server is unreachable. Check your connection and retry.' : errMessage(q.error)} onRetry={() => void q.refetch()} />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ padding: sp.lg, paddingBottom: sp.xxxl, flexGrow: 1 }}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => void q.refetch()}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        ListEmptyComponent={
          <EmptyState icon="notifications-none" title="No notifications yet" message="Deadline reminders, application updates and announcements from the placement cell show up here." actionLabel="Reminder settings" onAction={() => router.push('/(student)/settings/reminders' as never)} />
        }
        ListFooterComponent={
          q.isFetchNextPageError ? (
            <View style={{ paddingTop: sp.md }}><ErrorState title="Could not load older" message="Check your connection and try again." onRetry={() => void q.fetchNextPage()} /></View>
          ) : q.hasNextPage ? (
            <View style={{ paddingTop: sp.md }}><Button label="Load older" variant="secondary" full loading={q.isFetchingNextPage} onPress={async () => { await q.fetchNextPage(); }} /></View>
          ) : items.length > 0 ? (
            <Text variant="caption" color={colors.muted} align="center" style={{ paddingTop: sp.lg }}>You are all caught up.</Text>
          ) : undefined
        }
      />
    );
  }

  return (
    <Page
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : undefined}
      onBack={back}
      scroll={false}
      right={unread > 0 ? <HeaderAction icon="done-all" label={`Mark all ${unread} as read`} onPress={() => void markAll()} /> : undefined}
    >
      <View style={{ flex: 1 }}>{body}</View>
    </Page>
  );
}
