import React from 'react';
import { Pressable, View } from 'react-native';
import { CompanyLogo, EmptyState, ErrorState, Icon, Panel, PanelRow, Skeleton, Text } from '@/ui';
import { colors, MIN_TOUCH, radius, spacing, toneColors, urgentColors } from '@/theme';
import type { DriveSummary } from '@/api/types';
import { formatCtc, relativeDeadline } from '@/lib/format';
import { eligibilityMeta } from '@/features/student/discover/helpers';

function DeadlineMeta({ drive, nowMs, offsetMs }: { drive: DriveSummary; nowMs: number; offsetMs: number }) {
  const diff = Date.parse(drive.deadline) - nowMs;
  const soon = diff > 0 && diff < 24 * 3600 * 1000;
  const elig = drive.eligibility?.status ? eligibilityMeta(drive.eligibility.status) : null;
  const dColor = soon ? urgentColors.fg : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={soon ? 'timer' : 'schedule'} size={14} color={dColor} />
        <Text variant="caption" tabular color={dColor} style={{ fontWeight: soon ? '600' : '500' }}>
          {relativeDeadline(drive.deadline, offsetMs)}
        </Text>
      </View>
      {elig ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: toneColors[elig.tone].fg }} />
          <Text variant="caption" color={toneColors[elig.tone].fg}>{elig.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Open drives the student has not applied to, soonest deadline first. Keeps the bookmark action from the old card rail. */
export function DeadlinesPanel({
  drives,
  loading,
  error,
  nowMs,
  offsetMs,
  isSaved,
  onToggleSave,
  onOpen,
  onSeeAll,
  onRetry,
}: {
  drives: DriveSummary[];
  loading: boolean;
  error?: string | null;
  nowMs: number;
  offsetMs: number;
  isSaved: (d: DriveSummary) => boolean;
  onToggleSave: (d: DriveSummary, saved: boolean) => void;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
  onRetry: () => void;
}) {
  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}
      </View>
    );
  } else if (error && drives.length === 0) {
    body = <View style={{ padding: spacing.lg }}><ErrorState title="Could not load drives" message={error} onRetry={onRetry} /></View>;
  } else if (drives.length === 0) {
    body = (
      <View style={{ padding: spacing.lg }}>
        <EmptyState
          icon="work-outline"
          title="No open drives right now"
          message="New drives from your placement cell appear here as soon as they are published."
          actionLabel="Browse opportunities"
          onAction={onSeeAll}
        />
      </View>
    );
  } else {
    body = drives.map((d, i) => {
      const saved = isSaved(d);
      const pkg = formatCtc(d.ctc);
      return (
        <PanelRow
          key={d.id}
          last={i === drives.length - 1}
          left={<CompanyLogo name={d.company.name} logoUrl={d.company.logoUrl} size={40} />}
          title={d.role}
          subtitle={`${d.company.name} · ${pkg}`}
          meta={<DeadlineMeta drive={d} nowMs={nowMs} offsetMs={offsetMs} />}
          onPress={() => onOpen(d.id)}
          accessibilityLabel={`${d.role} at ${d.company.name}. ${pkg}. ${relativeDeadline(d.deadline, offsetMs)}.`}
          right={
            <Pressable
              onPress={() => onToggleSave(d, saved)}
              accessibilityRole="button"
              accessibilityLabel={saved ? `Remove ${d.role} from saved` : `Save ${d.role}`}
              accessibilityState={{ selected: saved }}
              hitSlop={4}
              style={({ pressed }) => ({ width: MIN_TOUCH - 8, height: MIN_TOUCH - 8, marginRight: -8, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.pressed : 'transparent' })}
            >
              <Icon name={saved ? 'bookmark' : 'bookmark-border'} size={22} color={saved ? colors.primary : colors.subtle} />
            </Pressable>
          }
        />
      );
    });
  }

  return (
    <Panel title="Closing soon" subtitle="Open drives you have not applied to yet" action={{ label: 'See all', onPress: onSeeAll }}>
      {body}
    </Panel>
  );
}
