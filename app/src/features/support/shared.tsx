import React from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { formatDateTimeIST } from '@/lib/format';
import { flatten, useTickets } from '@/api/hooks';
import type { Ticket, TicketCategory, TicketStatus } from '@/api/types';

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  profile: 'Profile', eligibility: 'Eligibility', application: 'Application', document: 'Document', other: 'Other',
};
export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((v) => ({ value: v, label: CATEGORY_LABEL[v] }));
export const isCategory = (v: unknown): v is TicketCategory => typeof v === 'string' && v in CATEGORY_LABEL;

export const SUBJECT_MIN = 3, SUBJECT_MAX = 120, MESSAGE_MIN = 5, MESSAGE_MAX = 2000;

/** Date and time in IST via the shared helper. */
export function whenIST(iso?: string | null): string {
  if (!iso) return '';
  const t = formatDateTimeIST(iso);
  return t === '—' ? '' : t;
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge label={status === 'open' ? 'Open' : 'Resolved'} tone={status === 'open' ? 'warning' : 'success'} icon={status === 'open' ? 'mark-chat-unread' : 'check-circle-outline'} />;
}

/** Paged ticket list with loading / error / empty / load-more states. */
export function TicketList({ status, onOpen, showStudent, emptyMessage, onEmptyAction, emptyActionLabel }: {
  status?: TicketStatus; onOpen: (id: string) => void; showStudent?: boolean; emptyMessage: string;
  onEmptyAction?: () => void; emptyActionLabel?: string;
}) {
  const q = useTickets(status);
  const items = flatten(q.data);
  if (q.isLoading) return <View style={{ gap: 12 }} accessibilityLabel="Loading">{[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={14} />)}</View>;
  if (q.isError && items.length === 0) return <ErrorState title="Could not load tickets" message={errMessage(q.error)} onRetry={() => q.refetch()} />;
  if (items.length === 0) return <EmptyState title={status === 'resolved' ? 'No resolved tickets' : 'No tickets'} message={emptyMessage} actionLabel={emptyActionLabel} onAction={onEmptyAction} icon="support-agent" />;
  return (
    <View style={{ gap: 12 }}>
      {items.map((t: Ticket) => (
        <Card key={t.id} onPress={() => onOpen(t.id)} accessibilityLabel={`${t.subject}, ${t.status === 'open' ? 'open' : 'resolved'}`}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <Text variant="subhead" numberOfLines={2}>{t.subject}</Text>
              <StatusBadge status={t.status} />
              <Text variant="caption" color={colors.muted} tabular>
                {[CATEGORY_LABEL[t.category] ?? t.category, showStudent && t.student?.name ? t.student.name : null, whenIST(t.lastMessageAt ?? t.updatedAt ?? t.createdAt)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Icon name="chevron-right" size={24} color={colors.subtle} />
          </View>
        </Card>
      ))}
      {q.isError ? <ErrorState title="Could not load more" message={errMessage(q.error)} onRetry={() => q.refetch()} /> : null}
      {q.hasNextPage ? <Button label="Load more" variant="secondary" full loading={q.isFetchingNextPage} onPress={async () => { await q.fetchNextPage(); }} /> : null}
    </View>
  );
}
