import React from 'react';
import { View } from 'react-native';
import { Badge, Icon, Text } from '@/ui';
import { colors, radius, spacing, toneColors } from '@/theme';
import type { EligibilityReason, Verification } from '@/api/types';

type Reason = EligibilityReason & { message?: string; label?: string };

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'Not provided';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'Not provided';
  return String(v);
};
const verLabel = (v?: Verification) => (v === 'verified' ? 'Verified' : v === 'student_confirmed' ? 'Self-confirmed' : v === 'unverified' ? 'Unverified' : '');

/**
 * Eligibility reasons table: one block per criterion with a Required / Yours pair and a Met / Not met / Missing badge.
 * Stacked (not four narrow columns) so nothing clips at 360dp or 1.3x font scale.
 */
export function EligibilityTable({ reasons }: { reasons: EligibilityReason[] }) {
  if (reasons.length === 0) {
    return <Text variant="body" color={colors.muted}>No criteria listed for this drive.</Text>;
  }
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text variant="overline" color={colors.muted} style={{ flex: 1 }}>Criterion</Text>
        <Text variant="overline" color={colors.muted} style={{ flex: 1 }}>Required</Text>
        <Text variant="overline" color={colors.muted} style={{ flex: 1 }}>Yours</Text>
      </View>
      {reasons.map((r0, i) => {
        const r = r0 as Reason;
        const tone = r.met === true ? 'success' : r.met === false ? 'error' : 'warning';
        const fg = toneColors[tone].fg;
        const stateText = r.met === true ? 'Met' : r.met === false ? 'Not met' : 'Missing';
        const name = r.label ?? r.criterion;
        const ver = verLabel(r.verification);
        return (
          <View
            key={`${r.criterion}-${i}`}
            accessible
            accessibilityLabel={`${name}. Required ${show(r.required)}. Yours ${show(r.actual)}. ${stateText}.`}
            style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
          >
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <Text variant="body" style={{ flex: 1, minWidth: 0, fontWeight: '600' }}>{name}</Text>
              <Text variant="body" tabular style={{ flex: 1, minWidth: 0 }}>{show(r.required)}</Text>
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: 4, alignItems: 'flex-start' }}>
                <Icon name={r.met === true ? 'check-circle' : r.met === false ? 'cancel' : 'help-outline'} size={16} color={fg} />
                <Text variant="body" tabular color={fg} style={{ flex: 1, minWidth: 0, fontWeight: '600' }}>{show(r.actual)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
              <Badge label={stateText} tone={tone} />
              {r.source ? <Text variant="caption" color={colors.muted} style={{ flexShrink: 1 }}>{`Source: ${String(r.source)}`}</Text> : null}
              {ver ? <Badge label={ver} tone={r.verification === 'verified' ? 'success' : 'neutral'} /> : null}
            </View>
            {r.message ? <Text variant="caption" color={colors.muted}>{r.message}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
