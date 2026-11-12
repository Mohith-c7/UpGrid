import React, { useState } from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, Card, Text, TextField, useIsOnline, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useReplyTicket, useSetTicketStatus, useTicket, useAuth } from '@/api/hooks';
import { Page, QueryBoundary } from '../student/me/kit';
import { CATEGORY_LABEL, MESSAGE_MAX, MESSAGE_MIN, StatusBadge, whenIST } from './shared';

export default function ThreadView({ id, onBack, officer }: { id: string; onBack: () => void; officer?: boolean }) {
  const toast = useToast();
  const online = useIsOnline();
  const { user } = useAuth();
  const q = useTicket(id);
  const reply = useReplyTicket(id);
  const setStatus = useSetTicketStatus(id);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const t = q.data?.ticket;
  const msgs = q.data?.messages ?? [];
  const open = t?.status === 'open';

  const send = async () => {
    const m = text.trim();
    if (m.length < MESSAGE_MIN) { setErr(`Write at least ${MESSAGE_MIN} characters`); return; }
    if (m.length > MESSAGE_MAX) { setErr(`Keep it within ${MESSAGE_MAX} characters`); return; }
    setErr(null);
    try { await reply.mutateAsync(m); setText(''); await q.refetch(); }
    catch (e) { setErr(errMessage(e)); }
  };
  const change = async (s: 'open' | 'resolved') => {
    try { await setStatus.mutateAsync(s); await q.refetch(); toast.show(s === 'resolved' ? (officer ? 'Marked as resolved' : 'Ticket closed') : 'Ticket reopened', 'success'); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  };

  return (
    <Page title="Ticket" onBack={onBack} keyboard onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} isEmpty={!t}
        empty={{ title: 'Ticket not found', message: 'It may have been removed.', actionLabel: 'Go back', onAction: onBack }} skeletonRows={3} skeletonHeight={110}>
        {t ? (
          <View style={{ gap: 16 }}>
            <Card>
              <View style={{ gap: 8 }}>
                <Text variant="heading">{t.subject}</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusBadge status={t.status} />
                  <Badge label={CATEGORY_LABEL[t.category] ?? t.category} />
                </View>
                {officer && t.student?.name ? <Text variant="caption" color={colors.muted}>{`From ${t.student.name}`}</Text> : null}
                <Text variant="caption" color={colors.muted} tabular>{`Opened ${whenIST(t.createdAt)}`}</Text>
              </View>
            </Card>

            <View style={{ gap: 12 }}>
              {msgs.length === 0 ? <Text variant="body" color={colors.muted}>No messages yet.</Text> : null}
              {msgs.map((m) => {
                const mine = !!m.author && m.author.id === user?.id;
                return (
                  <View
                    key={m.id}
                    style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '92%',
                      backgroundColor: mine ? colors.primaryTint : colors.surface, borderWidth: 1, borderColor: mine ? colors.primaryTint2 : colors.border,
                      borderRadius: 12, padding: 12, gap: 4,
                    }}
                  >
                    <Text variant="caption" color={colors.muted} tabular>
                      {`${mine ? 'You' : (m.author?.name ?? 'Placement cell')}${m.author?.role === 'officer' ? ' (placement cell)' : ''} · ${whenIST(m.createdAt)}`}
                    </Text>
                    <Text variant="body" selectable>{m.message}</Text>
                  </View>
                );
              })}
            </View>

            {open ? (
              <Card>
                <View style={{ gap: 12 }}>
                  <TextField label="Reply" value={text} onChangeText={(v) => { setText(v); setErr(null); }} multiline maxLength={MESSAGE_MAX} error={err} />
                  <Button label="Send reply" icon="send" full onPress={send} loading={reply.isPending} disabled={!online || !text.trim() || reply.isPending} />
                  <Button label={officer ? 'Mark resolved' : 'Close ticket'} variant="secondary" full onPress={() => change('resolved')} loading={setStatus.isPending} disabled={!online} />
                  {!online ? <Text variant="caption" color={colors.muted}>You are offline. Reconnect to reply.</Text> : null}
                </View>
              </Card>
            ) : (
              <Banner
                tone="success"
                title="This ticket is resolved"
                message="Reopen it to add a reply."
                action={online ? { label: 'Reopen ticket', onPress: () => { void change('open'); } } : undefined}
              />
            )}
          </View>
        ) : null}
      </QueryBoundary>
    </Page>
  );
}
