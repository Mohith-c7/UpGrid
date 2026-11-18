import React from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Icon, ProgressBar, Skeleton, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import type { Completion } from '@/api/types';
import { nextStepOf } from '@/features/student/discover/helpers';

/**
 * Profile readiness: the one number that gates eligibility. Shows a single next step; collapses to a slim confirmation
 * row once the profile is complete so it stops competing with time-sensitive content.
 */
export function ReadinessPanel({
  completion,
  loading,
  error,
  onRetry,
  onContinue,
}: {
  completion?: Completion | null;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  onContinue: (key: string | null) => void;
}) {
  if (loading) return <Skeleton height={112} radius={12} />;
  if (error) {
    return (
      <Card>
        <ErrorState title="Profile unavailable" message={error} onRetry={onRetry} />
      </Card>
    );
  }
  if (!completion) return null;

  const percent = Math.max(0, Math.min(100, Math.round(completion.percent ?? 0)));
  const step = nextStepOf(completion);
  const done = percent >= 100 || !step;
  const remaining = (completion.items ?? []).filter((i) => !i.done).length;

  if (done) {
    return (
      <View
        accessible
        accessibilityLabel="Profile complete. Keep academics current before each season."
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 12, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder }}
      >
        <Icon name="verified" size={20} color={colors.success} />
        <Text variant="caption" color={colors.success} style={{ flex: 1, fontWeight: '500' }}>
          Profile complete. Keep academics current before each season.
        </Text>
      </View>
    );
  }

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="overline" color={colors.muted}>Placement readiness</Text>
            <Text variant="subhead">{remaining === 1 ? '1 profile item left' : `${remaining} profile items left`}</Text>
          </View>
          <Text variant="title" tabular color={colors.primary}>{`${percent}%`}</Text>
        </View>
        <ProgressBar value={percent / 100} label={`Profile ${percent} percent complete`} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="body" numberOfLines={2} style={{ fontWeight: '500' }}>{`Next: ${step.label}`}</Text>
            {step.why ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{step.why}</Text> : null}
          </View>
          <Button label="Continue" size="sm" onPress={() => onContinue(step.key)} />
        </View>
      </View>
    </Card>
  );
}
