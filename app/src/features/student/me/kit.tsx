/** Shared helpers for the student "me" screens (applications, profile, settings, notifications, eligibility). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Controller, type Control, type FieldValues, type Path, type Resolver } from 'react-hook-form';
import { Badge, Card, EmptyState, ErrorState, Header, ListRow, OfflineBanner, Screen, Skeleton, TextField, type IconName } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { formatDateIST, formatDateTimeIST, timeAgo as sharedTimeAgo } from '@/lib/format';
import type { AppStatus } from '@/api/types';
import { errMessage, isNetworkError } from './data';

export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/* ---------------------------------------------------------------- locks */
/** Double-submit lock: returns [run, busy]. A second call while the first is running is ignored. */
export function useOnce<A extends unknown[]>(fn: (...a: A) => Promise<unknown> | unknown): [(...a: A) => Promise<void>, boolean] {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...a: A) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await fnRef.current(...a); } finally { lock.current = false; setBusy(false); }
  }, []);
  return [run, busy];
}

/* ------------------------------------------------------- unsaved changes */
/** Warns before leaving (header back, gesture, Android back) while `dirty`. Call `allowLeave()` right before a deliberate router.back(). */
export function useUnsavedGuard(dirty: boolean) {
  const nav = useNavigation<any>();
  const dirtyRef = useRef(dirty);
  const bypass = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e: any) => {
      if (bypass.current || !dirtyRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'You have unsaved changes. If you leave now they will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { bypass.current = true; nav.dispatch(e.data.action); } },
      ]);
    });
    return unsub;
  }, [nav]);
  return { allowLeave: () => { bypass.current = true; } };
}

export function confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = true) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/* ----------------------------------------------------------------- Page */
/**
 * Standard student screen shell: white `bar` header (handles the status-bar inset), optional sticky footer,
 * scroll body with pull-to-refresh, offline banner, keyboard avoidance. Set `scroll={false}` to render your own list.
 * The dark status-bar icons are only claimed while the screen is focused, so hero screens (teal) keep light icons.
 */
export function Page({
  title, subtitle, onBack, right, children, footer, onRefresh, refreshing, keyboard, scroll = true, gap = sp.lg, bottomPad = true,
}: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode;
  onRefresh?: () => void; refreshing?: boolean; keyboard?: boolean; scroll?: boolean; gap?: number; bottomPad?: boolean;
}) {
  const focused = useIsFocused();
  return (
    <Screen scroll={false} padded={false} edges={['bottom']} footer={footer} keyboard={keyboard}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title={title} subtitle={subtitle} onBack={onBack} right={right} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: bottomPad ? sp.xxxl : SCREEN_PADDING, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined}
        >
          <OfflineBanner />
          <View style={{ gap }}>{children}</View>
        </ScrollView>
      ) : (
        <>
          <View style={{ paddingHorizontal: SCREEN_PADDING, paddingTop: sp.sm }}><OfflineBanner /></View>
          {children}
        </>
      )}
    </Screen>
  );
}

export interface RowDef { title: string; subtitle?: string; icon?: IconName; right?: React.ReactNode; onPress?: () => void }
/** A white card holding divider-separated ListRows (Profile shortcuts, settings, legal links). */
export function RowGroup({ rows }: { rows: RowDef[] }) {
  return (
    <Card padding={0}>
      {rows.map((r, i) => (
        <View key={`${r.title}-${i}`} style={{ paddingHorizontal: SCREEN_PADDING }}>
          <ListRow {...r} last={i === rows.length - 1} />
        </View>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------- boundaries */
export function SkeletonList({ rows = 3, height = 88 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: sp.md }} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} radius={14} />)}
    </View>
  );
}

interface BoundaryProps {
  isLoading: boolean; isError: boolean; error?: unknown; onRetry: () => void;
  isEmpty?: boolean; empty?: { title: string; message: string; actionLabel?: string; onAction?: () => void };
  skeletonRows?: number; skeletonHeight?: number; children: React.ReactNode;
}
/** Loading / error (network-aware) / empty in one place. */
export function QueryBoundary({ isLoading, isError, error, onRetry, isEmpty, empty, skeletonRows, skeletonHeight, children }: BoundaryProps) {
  if (isLoading) return <SkeletonList rows={skeletonRows} height={skeletonHeight} />;
  if (isError) {
    const msg = isNetworkError(error) ? 'You appear to be offline or the server is unreachable. Check your connection and retry.' : errMessage(error);
    return <ErrorState message={msg} onRetry={onRetry} />;
  }
  if (isEmpty && empty) return <EmptyState {...empty} />;
  return <>{children}</>;
}

/* --------------------------------------------------------------- formats */
/** IST only, via the shared helpers (never the device zone). */
export function formatIST(iso?: string | null, withTime = true): string {
  return withTime ? formatDateTimeIST(iso) : formatDateIST(iso);
}
export function timeAgo(iso: string): string {
  return sharedTimeAgo(iso);
}

/* ------------------------------------------------------- application status */
export const STATUS_LABEL: Record<AppStatus, string> = {
  submitted: 'Submitted', screening: 'Screening', assessment: 'Assessment', interview: 'Interview', selected: 'Selected',
  offer_issued: 'Offer issued', offer_accepted: 'Offer accepted', offer_declined: 'Offer declined', rejected: 'Not selected',
  withdrawn: 'Withdrawn', joined: 'Joined',
};
export const STATUS_TONE: Record<AppStatus, Tone> = {
  submitted: 'info', screening: 'info', assessment: 'info', interview: 'info', selected: 'success', offer_issued: 'success',
  offer_accepted: 'success', offer_declined: 'neutral', rejected: 'error', withdrawn: 'neutral', joined: 'success',
};
/** Who decides each step. The app only records what the placement cell enters; it never talks to companies directly. */
export const STATUS_OWNER: Record<AppStatus, 'cell' | 'company' | 'you'> = {
  submitted: 'cell', screening: 'cell', assessment: 'company', interview: 'company', selected: 'company', offer_issued: 'company',
  offer_accepted: 'you', offer_declined: 'you', rejected: 'company', withdrawn: 'you', joined: 'you',
};
export const OWNER_LABEL = { cell: 'Placement cell', company: 'Company decision', you: 'Your action' } as const;
export const NEXT_ACTION: Record<AppStatus, string> = {
  submitted: 'Wait for screening. You can withdraw until the placement cell starts screening.',
  screening: 'Nothing to do now. The placement cell will post the next step here and in notifications.',
  assessment: 'Prepare for the assessment. Watch notifications and the note below for timing.',
  interview: 'Prepare for the interview. Watch notifications and the details below for timing.',
  selected: 'Wait for the placement cell to share offer details.',
  offer_issued: 'Your offer is ready. Review the details with the placement cell, then accept or decline below.',
  offer_accepted: 'Wait for joining instructions from the placement cell.',
  offer_declined: 'No further action. You can keep applying to other drives.',
  rejected: 'This application is closed. Check Eligibility for other drives you can apply to.',
  withdrawn: 'This application is closed. You can re-apply only if the drive is still open.',
  joined: 'Congratulations. No further action is needed.',
};
export const STATUS_ICON: Record<AppStatus, IconName> = {
  submitted: 'send', screening: 'search', assessment: 'quiz', interview: 'groups', selected: 'emoji-events', offer_issued: 'local-offer',
  offer_accepted: 'check-circle', offer_declined: 'do-not-disturb-on', rejected: 'block', withdrawn: 'undo', joined: 'task-alt',
};
export function StatusBadge({ status }: { status: AppStatus }) {
  return <Badge label={STATUS_LABEL[status] ?? String(status)} tone={STATUS_TONE[status] ?? 'neutral'} icon={STATUS_ICON[status] ?? 'info-outline'} />;
}
export const isClosedStatus = (s: AppStatus) => ['rejected', 'withdrawn', 'offer_declined', 'joined'].includes(s);

/* ------------------------------------------------------------ verification */
export function VerificationBadge({ v }: { v?: string }) {
  if (v === 'verified') return <Badge label="Verified by placement cell" tone="success" icon="verified" />;
  if (v === 'student_confirmed') return <Badge label="Self-reported" tone="info" icon="person" />;
  return <Badge label="Not verified yet" tone="warning" icon="hourglass-empty" />;
}

/* ------------------------------------------------------------- RHF helpers */
/** Resolver built from validation.ts-style validators: each returns an error string or null. Avoids an extra resolver dependency. */
export function makeResolver<T extends FieldValues>(rules: { [K in keyof T]?: (value: T[K], all: T) => string | null }): Resolver<T> {
  return async (values) => {
    const errors: Record<string, { type: string; message: string }> = {};
    for (const k of Object.keys(rules) as (keyof T)[]) {
      const msg = rules[k]!(values[k], values);
      if (msg) errors[k as string] = { type: 'validate', message: msg };
    }
    return Object.keys(errors).length ? { values: {} as never, errors: errors as never } : { values, errors: {} };
  };
}

interface RHFTextProps<T extends FieldValues> {
  control: Control<T>; name: Path<T>; label: string; helper?: string; keyboardType?: any; secure?: boolean;
  multiline?: boolean; maxLength?: number; prefix?: string; serverError?: string;
}
export function RHFText<T extends FieldValues>({ control, name, serverError, ...rest }: RHFTextProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...rest}
          value={(field.value as string) ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message ?? serverError}
        />
      )}
    />
  );
}

/** Map server `fields` ({ 'academics.cgpa': msg }) onto form field names via a lookup. */
export function mapServerFields(fields: Record<string, string> | undefined, map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) out[map[k] ?? k] = v;
  return out;
}

export const numStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Back handler that works even when the screen was opened from a notification/deep link (no history). */
export function useBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as any);
  }, [router, fallback]);
}
