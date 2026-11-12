import React, { useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, RefreshControl, View } from 'react-native';
import { Banner, Button, EmptyState, ErrorState, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { flatten, useAuth } from '@/api/hooks';
import { useMessages, usePostMessage, useRecruiterDrive } from '@/api/recruiter';
import { newIdempotencyKey } from '@/lib/idempotency';
import { formatDateTimeIST } from '@/lib/format';
import { can, SkeletonList } from './kit';

/** Drive message thread: assigned recruiters and placement officers. Newest message at the bottom. */
export function MessageThread({ driveId }: { driveId: string }) {
  const { user } = useAuth();
  const drive = useRecruiterDrive(driveId);
  const q = useMessages(driveId);
  const post = usePostMessage(driveId);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const clientId = useRef<{ id: string; body: string } | null>(null);
  const items = useMemo(() => flatten(q.data), [q.data]); // newest first
  const canPost = can(drive.data?.permissions, 'message');

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (body.length > 2000) { setErr('Messages can be up to 2000 characters.'); return; }
    setErr(null);
    // Same id when the SAME text is retried, so a message whose reply was lost is not posted twice. Edited text gets a new id,
    // otherwise the server would replay the old message and silently drop the edit.
    if (!clientId.current || clientId.current.body !== body) clientId.current = { id: newIdempotencyKey(), body };
    try {
      await post.mutateAsync({ body, clientId: clientId.current.id });
      clientId.current = null;
      setText('');
    } catch (e) {
      setErr(errMessage(e));
    }
  };

  let list: React.ReactNode;
  if (q.isLoading) list = <View style={{ padding: 16 }}><SkeletonList rows={4} height={64} /></View>;
  else if (q.isError && !items.length) list = <View style={{ padding: 16 }}><ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /></View>;
  else
    list = (
      <FlatList
        inverted
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }] }}><EmptyState icon="chat-bubble-outline" title="No messages yet" message="Start the conversation with the placement cell and the other recruiters on this drive." /></View>}
        ListFooterComponent={q.isFetchingNextPage ? <Text variant="caption" color={colors.muted} align="center">Loading earlier messages</Text> : undefined}
        renderItem={({ item }) => {
          const mine = item.author.id === user?.id;
          return (
            <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <View
                accessible
                accessibilityLabel={`${mine ? 'You' : item.author.name}, ${formatDateTimeIST(item.createdAt)}: ${item.body}`}
                style={{ maxWidth: '88%', gap: 4, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: mine ? colors.primaryTint2 : colors.border, backgroundColor: mine ? colors.primaryTint : colors.surface }}
              >
                <Text variant="caption" color={colors.muted} style={{ fontWeight: '600' }}>
                  {mine ? 'You' : item.author.name}{item.author.role === 'officer' ? ' (placement cell)' : ''}
                </Text>
                <Text variant="body">{item.body}</Text>
                <Text variant="caption" color={colors.muted} tabular>{formatDateTimeIST(item.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {list}
      <View style={{ padding: 12, gap: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        {canPost ? (
          <>
            {err ? <Banner tone="error" message={err} /> : null}
            <TextField label="Message" value={text} onChangeText={(t) => { setText(t); setErr(null); }} multiline maxLength={2000} placeholder="Write to the drive team" />
            <Button label="Send" icon="send" full loading={post.isPending} disabled={!text.trim()} onPress={send} />
          </>
        ) : (
          <Banner tone="info" message="You do not have permission to post in this thread." />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
