import React, { useMemo } from 'react';
import { View } from 'react-native';
import { CompanyLogo, EmptyState, ErrorState, Panel, PanelRow, Skeleton, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import type { Application, AppStatus } from '@/api/types';
import { timeAgo } from '@/lib/format';
import { StatusBadge } from '@/features/student/me/kit';

const STAGES: { label: string; statuses: AppStatus[] }[] = [
  { label: 'Applied', statuses: ['submitted', 'screening'] },
  { label: 'Assessment', statuses: ['assessment'] },
  { label: 'Interview', statuses: ['interview'] },
  { label: 'Offer', statuses: ['selected', 'offer_issued', 'offer_accepted', 'joined'] },
];

function StageTrack({ applications }: { applications: Application[] }) {
  const counts = useMemo(() => STAGES.map((s) => applications.filter((a) => s.statuses.includes(a.status)).length), [applications]);
  return (
    <View
      accessible
      accessibilityLabel={`Application stages: ${STAGES.map((s, i) => `${s.label} ${counts[i]}`).join(', ')}`}
      style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      {STAGES.map((s, i) => {
        const active = counts[i] > 0;
        const isOffer = i === STAGES.length - 1;
        const bar = active ? (isOffer ? colors.successSolid : colors.primary) : colors.border;
        return (
          <View key={s.label} style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: bar }} />
            <View>
              <Text variant="heading" tabular color={active ? (isOffer ? colors.success : colors.ink) : colors.disabled}>
                {String(counts[i])}
              </Text>
              <Text variant="caption" color={colors.muted} numberOfLines={1}>{s.label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Where every application stands (stage track) and the three most recently updated ones. */
export function PipelinePanel({
  applications,
  loading,
  error,
  nowMs,
  onOpen,
  onSeeAll,
  onFind,
  onRetry,
}: {
  applications: Application[];
  loading: boolean;
  error?: string | null;
  nowMs: number;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
  onFind: () => void;
  onRetry: () => void;
}) {
  const recent = useMemo(
    () =>
      [...applications]
        .sort((a, b) => Date.parse(b.updatedAt ?? b.submittedAt) - Date.parse(a.updatedAt ?? a.submittedAt))
        .slice(0, 3),
    [applications],
  );

  let body: React.ReactNode;
  if (loading) {
    body = <View style={{ padding: spacing.lg, gap: spacing.md }}><Skeleton height={56} /><Skeleton height={48} /></View>;
  } else if (error) {
    body = <View style={{ padding: spacing.lg }}><ErrorState title="Could not load applications" message={error} onRetry={onRetry} /></View>;
  } else if (applications.length === 0) {
    body = (
      <View style={{ padding: spacing.lg }}>
        <EmptyState
          icon="description"
          title="No applications yet"
          message="Saving a drive is only a bookmark. Opt in to a drive to apply."
          actionLabel="Find a drive"
          onAction={onFind}
        />
      </View>
    );
  } else {
    body = (
      <>
        <StageTrack applications={applications} />
        {recent.map((a, i) => (
          <PanelRow
            key={a.id}
            last={i === recent.length - 1}
            left={<CompanyLogo name={a.drive.company.name} logoUrl={a.drive.company.logoUrl} size={40} />}
            title={a.drive.company.name}
            subtitle={a.drive.role}
            meta={
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
                <StatusBadge status={a.status} />
                <Text variant="caption" tabular color={colors.muted}>{`Updated ${timeAgo(a.updatedAt ?? a.submittedAt, nowMs)}`}</Text>
              </View>
            }
            onPress={() => onOpen(a.id)}
            accessibilityLabel={`${a.drive.company.name}, ${a.drive.role}, ${a.status}`}
          />
        ))}
      </>
    );
  }

  return (
    <Panel title="Application progress" action={applications.length ? { label: 'See all', onPress: onSeeAll } : undefined}>
      {body}
    </Panel>
  );
}
