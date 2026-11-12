import React from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ErrorState, HeaderAction, Skeleton, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { confirm, Page, sp } from '@/features/student/me/kit';
import { errMessage } from '@/api/client';
import { flattenPages, useConversations, useDeleteConversation } from '@/api/ai';
import { AiGate, AI_ROUTES } from '@/features/ai/kit';
import { timeAgo } from '@/lib/format';

export default function AiHistory() {
  const router = useRouter();
  const toast = useToast();
  const q = useConversations(true);
  const del = useDeleteConversation();
  const items = flattenPages(q.data);

  const remove = (id: string, title: string) =>
    confirm('Delete conversation?', `"${title}" will be permanently deleted.`, 'Delete', async () => {
      try { await del.mutateAsync(id); toast.show('Conversation deleted', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
    });

  return (
    <Page
      title="Past conversations"
      scroll={false}
      onBack={() => (router.canGoBack() ? router.back() : router.replace(AI_ROUTES.hub as never))}
      right={<HeaderAction icon="add-comment" label="New chat" onPress={() => router.push(AI_ROUTES.chat as never)} />}
    >
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <AiGate>
          {() =>
            q.isLoading ? (
              <View style={{ gap: sp.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={84} radius={14} />)}</View>
            ) : q.isError && items.length === 0 ? (
              <ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState icon="chat-bubble-outline" title="No conversations yet" message="Your chats with the AI assistant are saved here." actionLabel="Start a chat" onAction={() => router.push(AI_ROUTES.chat as never)} />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingVertical: sp.sm, paddingBottom: sp.xxxl, gap: sp.md }}
                refreshing={q.isRefetching}
                onRefresh={() => void q.refetch()}
                onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
                renderItem={({ item }) => (
                  <Card onPress={() => router.push({ pathname: AI_ROUTES.chat, params: { id: item.id } } as never)} accessibilityLabel={`${item.title}, ${item.messageCount} messages`}>
                    <View style={{ gap: sp.sm }}>
                      <Text variant="subhead" numberOfLines={2}>{item.title || 'Conversation'}</Text>
                      <Text variant="caption" tabular color={colors.muted}>{`${item.messageCount} messages, ${timeAgo(item.updatedAt)}`}</Text>
                      <View style={{ flexDirection: 'row' }}>
                        <Button label="Delete" icon="delete-outline" variant="ghost" size="sm" onPress={() => remove(item.id, item.title || 'Conversation')} />
                      </View>
                    </View>
                  </Card>
                )}
                ListFooterComponent={
                  q.isFetchingNextPage ? <Skeleton height={84} radius={14} /> : q.isError ? <ErrorState message="Could not load more." onRetry={() => void q.fetchNextPage()} /> : undefined
                }
              />
            )
          }
        </AiGate>
      </View>
    </Page>
  );
}
