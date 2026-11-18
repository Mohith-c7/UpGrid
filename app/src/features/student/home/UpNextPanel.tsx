import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Panel, PanelRow, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import type { Application } from '@/api/types';
import { formatIST } from '@/features/student/me/kit';
import { relativeFromNow } from '@/features/student/me/ScheduleCard';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

function DateTile({ iso, soon }: { iso: string; soon: boolean }) {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{ width: 44, height: 48, borderRadius: 8, borderWidth: 1, borderColor: soon ? colors.primaryBorder : colors.border, backgroundColor: soon ? colors.primaryTint : colors.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="overline" color={soon ? colors.primary : colors.muted} style={{ fontSize: 11, lineHeight: 14 }}>
        {MONTHS[d.getUTCMonth()]}
      </Text>
      <Text variant="heading" tabular color={soon ? colors.primaryDark : colors.ink} style={{ lineHeight: 22 }}>
        {String(d.getUTCDate())}
      </Text>
    </View>
  );
}

/** Interviews and assessments the placement cell has scheduled, soonest first. Renders nothing when none are upcoming. */
export function UpNextPanel({
  applications,
  nowMs,
  offsetMs,
  onOpen,
}: {
  applications: Application[];
  nowMs: number;
  offsetMs: number;
  onOpen: (id: string) => void;
}) {
  const upcoming = useMemo(
    () =>
      applications
        .filter((a) => a.schedule && Date.parse(a.schedule.scheduledAt) > nowMs)
        .sort((a, b) => Date.parse(a.schedule!.scheduledAt) - Date.parse(b.schedule!.scheduledAt))
        .slice(0, 3),
    [applications, nowMs],
  );
  if (upcoming.length === 0) return null;

  return (
    <Panel title="Up next" subtitle="Interviews and assessments scheduled by your placement cell">
      {upcoming.map((a, i) => {
        const s = a.schedule!;
        const kind = s.type === 'interview' ? 'Interview' : 'Assessment';
        const soon = Date.parse(s.scheduledAt) - nowMs < 48 * 3600 * 1000;
        const rel = relativeFromNow(s.scheduledAt, offsetMs);
        const mode = s.mode === 'online' ? 'Online' : 'In person';
        return (
          <PanelRow
            key={a.id}
            last={i === upcoming.length - 1}
            left={<DateTile iso={s.scheduledAt} soon={soon} />}
            title={`${kind} · ${a.drive.company.name}`}
            subtitle={a.drive.role}
            meta={
              <Text variant="caption" tabular color={soon ? colors.primary : colors.muted} style={{ fontWeight: soon ? '600' : '400' }} numberOfLines={1}>
                {`${formatIST(s.scheduledAt)} · ${rel} · ${mode}`}
              </Text>
            }
            onPress={() => onOpen(a.id)}
            accessibilityLabel={`${kind} with ${a.drive.company.name} for ${a.drive.role}, ${formatIST(s.scheduledAt)}, ${rel}, ${mode}`}
          />
        );
      })}
      <View style={{ height: spacing.xs }} />
    </Panel>
  );
}
