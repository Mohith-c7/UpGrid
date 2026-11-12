import React, { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Badge, CompanyLogo, EmptyState, ErrorState, Icon, Skeleton, Text, type IconName } from '@/ui';
import { colors, MIN_TOUCH, radius, shadow, urgentColors, type Tone } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { spacing } from '../layout';
import { ctcSummary, formatIST, STATUS_LABEL } from '../format';
import type { DriveItem, StudentRow } from '../types';

export const DRIVE_TONE: Record<string, Tone> = {
  draft: 'neutral', pending_approval: 'warning', open: 'success', closing: 'warning', closed: 'neutral',
};
export const DRIVE_LABEL: Record<string, string> = {
  draft: 'Draft', pending_approval: 'Awaiting approval', open: 'Open', closing: 'Closing soon', closed: 'Closed',
};
const DRIVE_ICON: Record<string, IconName> = {
  draft: 'edit', pending_approval: 'hourglass-empty', open: 'check-circle-outline', closing: 'timer', closed: 'lock',
};

export function DriveStatusBadge({ status }: { status: string }) {
  return <Badge label={DRIVE_LABEL[status] ?? status} tone={DRIVE_TONE[status] ?? 'neutral'} icon={DRIVE_ICON[status] ?? 'label-outline'} />;
}

const APP_ICON: Record<string, IconName> = {
  submitted: 'inbox', screening: 'search', assessment: 'quiz', interview: 'event', selected: 'check-circle-outline',
  offer_issued: 'mail-outline', offer_accepted: 'check-circle-outline', offer_declined: 'cancel', rejected: 'block',
  withdrawn: 'undo', joined: 'work-outline',
};
export function AppStatusBadge({ status }: { status: string }) {
  const tone: Tone = ['selected', 'offer_issued', 'offer_accepted', 'joined'].includes(status) ? 'success'
    : ['rejected', 'offer_declined'].includes(status) ? 'error' : status === 'withdrawn' ? 'neutral' : 'info';
  return <Badge label={STATUS_LABEL[status] ?? status} tone={tone} icon={APP_ICON[status] ?? 'label-outline'} />;
}

export function VERIF_BADGE(v?: string) {
  return v === 'verified' ? <Badge label="Verified" tone="success" icon="verified" />
    : v === 'pending' || v === 'partial' || v === 'student_confirmed' ? <Badge label="Pending review" tone="warning" icon="hourglass-empty" />
    : <Badge label="Unverified" tone="neutral" icon="help-outline" />;
}

/** Skeleton rows with the same geometry as the final cards (default 132 = officer DriveCard). */
export function SkeletonList({ rows = 4, height = 156 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: spacing[3] }} accessibilityLabel="Loading" accessibilityLiveRegion="polite">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} radius={14} />)}
    </View>
  );
}

interface BoundaryProps {
  isLoading: boolean; isError: boolean; error?: unknown; onRetry: () => void;
  isEmpty?: boolean; empty?: { title: string; message: string; actionLabel?: string; onAction?: () => void; icon?: IconName };
  skeletonRows?: number; skeletonHeight?: number; children: React.ReactNode;
}
/** Loading / error / empty states in one place. Offline banner is rendered by each Screen via <OfflineBanner />. */
export function QueryBoundary({ isLoading, isError, error, onRetry, isEmpty, empty, skeletonRows, skeletonHeight, children }: BoundaryProps) {
  if (isLoading) return <SkeletonList rows={skeletonRows} height={skeletonHeight} />;
  if (isError) return <ErrorState message={(error as any)?.message ?? 'Could not load. Check your connection and retry.'} onRetry={onRetry} />;
  if (isEmpty && empty) return <EmptyState {...empty} />;
  return <>{children}</>;
}

/** Officer drive list item: logo + company/role, package, tinted status badge, deadline and applicant count. */
export function DriveCard({ d, onPress, footer }: { d: DriveItem; onPress: () => void; footer?: React.ReactNode }) {
  const live = d.status === 'open' || d.status === 'closing';
  const diff = d.deadline ? Date.parse(d.deadline) - (Date.now() + getServerOffsetMs()) : NaN;
  const soon = live && diff > 0 && diff < 24 * 3600 * 1000;
  const dColor = soon ? urgentColors.fg : colors.muted;
  const pkg = ctcSummary(d.ctc as any);
  const deadlineText = d.deadline ? formatIST(d.deadline) : 'No deadline set';
  const label = `${d.company.name}, ${d.role}. ${DRIVE_LABEL[d.status] ?? d.status}. ${pkg}. Deadline ${deadlineText}.${d.applicantCount != null ? ` ${d.applicantCount} applicants.` : ''}`;
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, ...shadow.card }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({ borderRadius: radius.card, padding: 16, gap: 12, minHeight: MIN_TOUCH, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <CompanyLogo name={d.company.name || '?'} logoUrl={d.company.logoUrl ?? undefined} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{d.company.name || 'Company'}</Text>
            <Text variant="caption" color={colors.muted} numberOfLines={2} ellipsizeMode="tail">{d.role}</Text>
          </View>
          <Icon name="chevron-right" size={24} color={colors.subtle} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 8 }}>
          <Text variant="heading" tabular numberOfLines={1} style={{ flexShrink: 1 }}>{pkg}</Text>
          <DriveStatusBadge status={d.status} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Icon name={soon ? 'timer' : 'schedule'} size={18} color={dColor} />
            <Text variant="caption" tabular color={dColor} style={{ fontWeight: soon ? '600' : '500', flexShrink: 1 }}>{deadlineText}</Text>
          </View>
          {d.applicantCount != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="groups" size={18} color={colors.muted} />
              <Text variant="caption" tabular color={colors.muted} style={{ fontWeight: '500' }}>{d.applicantCount} {d.applicantCount === 1 ? 'applicant' : 'applicants'}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {footer ? <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>{footer}</View> : null}
    </View>
  );
}

/** Student list item: avatar, name, department / batch / CGPA, verification badge. */
export function StudentCard({ s, onPress }: { s: StudentRow; onPress: () => void }) {
  const meta = [s.department, s.batchYear ? `Batch ${s.batchYear}` : null, s.cgpa != null ? `CGPA ${Number(s.cgpa).toFixed(2)}` : null].filter(Boolean).join(' · ');
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, ...shadow.card }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${s.name}. ${meta}. ${s.verification === 'verified' ? 'Verified' : s.verification === 'pending' ? 'Pending review' : 'Unverified'}`}
        style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.card, minHeight: MIN_TOUCH, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
      >
        <Avatar name={s.name || '?'} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{s.name}</Text>
          {meta ? <Text variant="caption" color={colors.muted} tabular numberOfLines={2}>{meta}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{VERIF_BADGE(s.verification)}</View>
        </View>
        <Icon name="chevron-right" size={24} color={colors.subtle} />
      </Pressable>
    </View>
  );
}

/** Double-tap protection: ignores re-entry while an async action is running. */
export function useOnce<A extends any[]>(fn: (...a: A) => Promise<unknown>) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...a: A) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fnRef.current(...a); } finally { busyRef.current = false; setBusy(false); }
  }, []);
  return [run, busy] as const;
}

export function Row({ children, gap = spacing[2], wrap }: { children: React.ReactNode; gap?: number; wrap?: boolean }) {
  return <View style={{ flexDirection: 'row', gap, flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: 'center' }}>{children}</View>;
}
export function Stack({ children, gap = spacing[3] }: { children: React.ReactNode; gap?: number }) {
  return <View style={{ gap }}>{children}</View>;
}

/** Text with a leading error/warning icon, for inline messages that must not rely on colour. */
export function InlineNote({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  const fg = tone === 'error' ? colors.error : tone === 'warning' ? colors.warning : colors.muted;
  const icon: IconName = tone === 'error' ? 'error-outline' : tone === 'warning' ? 'warning-amber' : 'info-outline';
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={18} color={fg} />
      <Text variant="caption" color={fg} style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

/** Time-of-day greeting in IST. */
export function greetingIST(offsetMs = 0): string {
  const h = new Date(Date.now() + offsetMs + 330 * 60000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
