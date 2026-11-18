import React from 'react';
import { Pressable, View } from 'react-native';
import { CompanyLogo, Icon, Text } from '@/ui';
import { colors, MIN_TOUCH, radius, shadow } from '@/theme';
import type { AppStatus } from '@/api/types';
import { formatIST, isClosedStatus, NEXT_ACTION, OWNER_LABEL, sp, STATUS_LABEL, STATUS_OWNER, StatusBadge } from './kit';

const STEPS = ['Applied', 'Assessment', 'Interview', 'Offer'] as const;

function stepIndex(s: AppStatus): number {
  if (s === 'submitted' || s === 'screening') return 0;
  if (s === 'assessment') return 1;
  if (s === 'interview') return 2;
  return 3;
}

/** Four-segment progress track. Not rendered for closed applications, where progress no longer applies. */
function StageTrack({ status }: { status: AppStatus }) {
  const idx = stepIndex(status);
  const offer = idx === 3;
  return (
    <View accessible accessibilityLabel={`Stage ${idx + 1} of 4: ${STEPS[idx]}`} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= idx ? (offer ? colors.successSolid : colors.primary) : colors.border }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {STEPS.map((s, i) => (
          <Text
            key={s}
            variant="caption"
            numberOfLines={1}
            color={i === idx ? (offer ? colors.success : colors.primary) : colors.subtle}
            style={{ flex: 1, fontSize: 12, fontWeight: i === idx ? '600' : '400' }}
          >
            {s}
          </Text>
        ))}
      </View>
    </View>
  );
}

export interface ApplicationCardData {
  id: string;
  status: AppStatus;
  submittedAt: string;
  drive: { role: string; company: { name: string; logoUrl?: string | null } };
}

export function ApplicationCard({ app, onPress }: { app: ApplicationCardData; onPress: () => void }) {
  const closed = isClosedStatus(app.status);
  const owner = OWNER_LABEL[STATUS_OWNER[app.status]] ?? '';
  const yourTurn = STATUS_OWNER[app.status] === 'you' && !closed;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${app.drive.company.name}, ${app.drive.role}, ${STATUS_LABEL[app.status] ?? app.status}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: pressed ? colors.borderStrong : colors.border,
        padding: sp.lg,
        gap: sp.md,
        minHeight: MIN_TOUCH,
        ...shadow.card,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md }}>
        <CompanyLogo name={app.drive.company.name} logoUrl={app.drive.company.logoUrl ?? undefined} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{app.drive.role}</Text>
          <Text variant="caption" color={colors.muted} numberOfLines={1} ellipsizeMode="tail">
            {`${app.drive.company.name} · Applied ${formatIST(app.submittedAt, false)}`}
          </Text>
        </View>
        <StatusBadge status={app.status} />
      </View>

      {!closed ? <StageTrack status={app.status} /> : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm, paddingTop: sp.md, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Icon name={closed ? 'info-outline' : yourTurn ? 'priority-high' : 'arrow-forward'} size={16} color={yourTurn ? colors.primary : colors.subtle} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {!closed ? (
            <Text variant="caption" color={yourTurn ? colors.primary : colors.muted} style={{ fontWeight: '600' }}>{owner}</Text>
          ) : null}
          <Text variant="caption" color={colors.textSecondary} numberOfLines={2} ellipsizeMode="tail">{NEXT_ACTION[app.status]}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.subtle} />
      </View>
    </Pressable>
  );
}
