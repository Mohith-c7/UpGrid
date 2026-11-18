import React from 'react';
import { View } from 'react-native';
import { ErrorState, Panel, PanelRow, Skeleton, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import { formatDateIST } from '@/lib/format';

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  driveId?: string | null;
}

/** Latest three placement-cell notices. Hidden entirely when there are none, rather than showing an empty card. */
export function AnnouncementsPanel({
  items,
  loading,
  error,
  onOpenDrive,
  onRetry,
}: {
  items: AnnouncementItem[];
  loading: boolean;
  error?: string | null;
  onOpenDrive: (driveId: string) => void;
  onRetry: () => void;
}) {
  if (!loading && !error && items.length === 0) return null;
  const list = items.slice(0, 3);
  return (
    <Panel title="Announcements" subtitle="From your placement cell">
      {loading ? (
        <View style={{ padding: spacing.lg }}><Skeleton height={56} /></View>
      ) : error ? (
        <View style={{ padding: spacing.lg }}><ErrorState title="Could not load announcements" message={error} onRetry={onRetry} /></View>
      ) : (
        list.map((n, i) => (
          <PanelRow
            key={n.id}
            last={i === list.length - 1}
            title={n.title}
            subtitle={n.body}
            meta={<Text variant="caption" tabular color={colors.subtle}>{formatDateIST(n.createdAt)}</Text>}
            onPress={n.driveId ? () => onOpenDrive(n.driveId as string) : undefined}
          />
        ))
      )}
    </Panel>
  );
}
