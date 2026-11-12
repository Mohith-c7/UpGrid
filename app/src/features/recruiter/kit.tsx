import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useRouter } from 'expo-router';
import { Badge, Header, OfflineBanner, Screen, Skeleton, Text } from '@/ui';
import { colors, SCREEN_PADDING, type Tone } from '@/theme';
import type { RecruiterPermissionKey, RecruiterPermissions } from '@/api/recruiterTypes';

export const RECRUITER_HOME = '/(recruiter)/(tabs)';

/** Back that also works when a screen was opened from a push notification (no history). */
export function useBack(fallback: string = RECRUITER_HOME) {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  }, [router, fallback]);
}

/**
 * Standard recruiter screen: bar header, optional pull-to-refresh scroll body, offline banner, sticky footer.
 * `scroll={false}` for screens that render their own FlatList.
 */
export function Page({
  title, subtitle, onBack, right, children, footer, onRefresh, refreshing, keyboard, scroll = true, gap = 16, hideHeader,
}: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode;
  onRefresh?: () => void; refreshing?: boolean; keyboard?: boolean; scroll?: boolean; gap?: number; hideHeader?: boolean;
}) {
  const focused = useIsFocused();
  return (
    <Screen scroll={false} padded={false} edges={hideHeader ? ['top', 'bottom'] : ['bottom']} footer={footer} keyboard={keyboard}>
      {focused ? <StatusBar style="dark" /> : null}
      {hideHeader ? null : <Header variant="bar" title={title} subtitle={subtitle} onBack={onBack} right={right} />}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: 32, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined}
        >
          <OfflineBanner />
          <View style={{ gap }}>{children}</View>
        </ScrollView>
      ) : (
        <>
          <View style={{ paddingHorizontal: SCREEN_PADDING, paddingTop: 8 }}><OfflineBanner /></View>
          {children}
        </>
      )}
    </Screen>
  );
}

export function SkeletonList({ rows = 3, height = 88 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} radius={14} />)}
    </View>
  );
}

/** Small caption + value pair used inside cards. */
export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="overline" color={colors.muted}>{label}</Text>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------- labels */
export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  screening: { label: 'Screening', tone: 'info' },
  assessment: { label: 'Assessment', tone: 'info' },
  interview: { label: 'Interview', tone: 'info' },
  selected: { label: 'Selected', tone: 'success' },
  offer_issued: { label: 'Offer issued', tone: 'success' },
  offer_accepted: { label: 'Offer accepted', tone: 'success' },
  offer_declined: { label: 'Offer declined', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'error' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  joined: { label: 'Joined', tone: 'success' },
};
export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s.replace(/_/g, ' '), tone: 'neutral' as Tone };

export const DECISION_META: Record<string, { label: string; tone: Tone; icon: string }> = {
  shortlisted: { label: 'Shortlisted', tone: 'success', icon: 'check-circle' },
  rejected: { label: 'Rejected', tone: 'error', icon: 'cancel' },
  on_hold: { label: 'On hold', tone: 'warning', icon: 'pause-circle-outline' },
};

export const ROUND_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  invited: { label: 'Invited', tone: 'info' },
  attended: { label: 'Present', tone: 'success' },
  absent: { label: 'Absent', tone: 'error' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  on_hold: { label: 'On hold', tone: 'warning' },
};

export const OFFER_META: Record<string, { label: string; tone: Tone }> = {
  pending_approval: { label: 'Awaiting officer approval', tone: 'warning' },
  rejected: { label: 'Rejected by officer', tone: 'error' },
  issued: { label: 'Issued', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'error' },
  joined: { label: 'Joined', tone: 'success' },
};

export const ROUND_KIND_LABEL: Record<string, string> = {
  aptitude: 'Aptitude', assessment: 'Assessment', coding: 'Coding', technical: 'Technical interview', hr: 'HR discussion', gd: 'Group discussion', custom: 'Custom',
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: 'Strong hire', hire: 'Hire', no_hire: 'No hire', strong_no_hire: 'Strong no hire',
};

export const PERMISSION_LABEL: Record<RecruiterPermissionKey, string> = {
  viewCandidates: 'View candidates', shortlist: 'Shortlist and reject', notes: 'Write notes', scorecards: 'Submit scorecards', proposeSlots: 'Propose interview slots',
  proposeOutcomes: 'Propose selection outcomes', proposeOffers: 'Propose offers', uploadResults: 'Record round results', markAttendance: 'Mark attendance', message: 'Drive messages',
};

/** Permissions default to true on the server; only an explicit false hides an action. */
export const can = (p: RecruiterPermissions | undefined, k: RecruiterPermissionKey) => p?.[k] !== false;

export function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return <Badge label={m.label} tone={m.tone} />;
}

export const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? '-' : n.toFixed(digits));
