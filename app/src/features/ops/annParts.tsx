import React from 'react';
import { View } from 'react-native';
import { Badge, Card, Text } from '@/ui';
import { colors } from '@/theme';
import type { Audience, AnnouncementV2 } from '@/api/opsTypes';
import { formatDateTimeIST } from '@/lib/format';
import { STATUS_TONE } from './kit';

export const AUDIENCE_LABEL: Record<Audience['type'], string> = {
  all: 'All students', cohort: 'A cohort', drive_participants: 'Applicants of a drive', eligible_not_applied: 'Eligible but not applied',
};
export const SSTATUS_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', sent: 'Sent' };

export function AnnouncementCard({ a, onPress }: { a: AnnouncementV2; onPress: () => void }) {
  const when = a.status === 'sent' ? `Sent ${formatDateTimeIST(a.sentAt)}` : a.status === 'scheduled' ? `Sends ${formatDateTimeIST(a.sendAt)}` : 'Not sent';
  return (
    <Card onPress={onPress} accessibilityLabel={`${a.title}, ${SSTATUS_LABEL[a.status]}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="subhead" style={{ flexShrink: 1 }}>{a.title}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {a.pinned ? <Badge label="Pinned" tone="info" icon="push-pin" /> : null}
          <Badge label={SSTATUS_LABEL[a.status] ?? a.status} tone={STATUS_TONE[a.status] ?? 'neutral'} />
        </View>
      </View>
      <Text variant="body" color={colors.textSecondary} numberOfLines={2}>{a.body}</Text>
      <Text variant="caption" color={colors.muted}>{AUDIENCE_LABEL[a.audience?.type] ?? 'Students'} · {when}</Text>
      {a.status === 'sent' ? <Text variant="caption" tabular color={colors.muted}>{a.delivered} delivered · {a.read} read of {a.recipients}</Text> : null}
    </Card>
  );
}
