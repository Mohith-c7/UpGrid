/**
 * Shared building blocks for the Officer Operations screens (app/(officer)/ops/*).
 * Flat, no animation; every list/detail goes through <Async> so loading / empty / error states are never forgotten.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner, Button, EmptyState, ErrorState, Header, OfflineBanner, Screen, Sheet, Skeleton, Text, TextField, useIsOnline, useToast, type IconName,
} from '@/ui';
import { colors, MIN_TOUCH, radius, SCREEN_PADDING } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';
import { shareTextFile } from '@/lib/shareFile';

export const OPS_HOME = '/(officer)/ops' as const;

/** Double-submit lock. Returns [run, busy]. */
export function useOnce<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
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

/** Back to a known parent when there is no history (deep link / reload). */
export function useBack(fallback: string = OPS_HOME) {
  const r = useRouter();
  return useCallback(() => { if (r.canGoBack()) r.back(); else r.replace(fallback as never); }, [r, fallback]);
}
export function useGo() {
  const r = useRouter();
  return useCallback((path: string) => r.push(path as never), [r]);
}

export function fieldMap(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.fields ? e.fields : {};
}

/** Standard page chrome: status bar, back header, offline banner, scroll body with pull to refresh and an optional sticky footer. */
export function OpsPage({
  title, subtitle, onBack, right, footer, children, onRefresh, refreshing, keyboard, back,
}: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode;
  onRefresh?: () => void; refreshing?: boolean; keyboard?: boolean; back?: string;
}) {
  const defaultBack = useBack(back);
  return (
    <Screen padded={false} edges={['bottom']} keyboard={keyboard} footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title={title} subtitle={subtitle} onBack={onBack ?? defaultBack} right={right} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: SCREEN_PADDING + 24, gap: 16, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined}
      >
        <OfflineBanner />
        {children}
      </ScrollView>
    </Screen>
  );
}

interface AsyncProps {
  isLoading: boolean; isError: boolean; error?: unknown; onRetry: () => void;
  isEmpty?: boolean; empty?: { title: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: IconName };
  rows?: number; rowHeight?: number; children: React.ReactNode;
}
/** loading skeleton, error + retry, empty state, then children. */
export function Async({ isLoading, isError, error, onRetry, isEmpty, empty, rows = 3, rowHeight = 88, children }: AsyncProps) {
  if (isLoading) {
    return (
      <View style={{ gap: 12 }} accessibilityLabel="Loading" accessibilityLiveRegion="polite">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={rowHeight} radius={14} />)}
      </View>
    );
  }
  if (isError) return <ErrorState message={errMessage(error)} onRetry={onRetry} />;
  if (isEmpty && empty) return <EmptyState {...empty} />;
  return <>{children}</>;
}

export function LoadMore({ hasNext, loading, onPress }: { hasNext?: boolean; loading?: boolean; onPress: () => void }) {
  if (!hasNext) return null;
  return <Button label="Load more" variant="secondary" full loading={loading} onPress={onPress} />;
}

/** Confirm sheet with an optional required reason field. */
export function ConfirmSheet({
  visible, onClose, title, message, confirmLabel, danger, reasonLabel, reasonRequired, minReason = 3, maxReason = 500, onConfirm, error,
}: {
  visible: boolean; onClose: () => void; title: string; message?: string; confirmLabel: string; danger?: boolean;
  reasonLabel?: string; reasonRequired?: boolean; minReason?: number; maxReason?: number; error?: string | null;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [run, busy] = useOnce(async () => {
    const r = reason.trim();
    if (reasonLabel && (reasonRequired ? r.length < minReason : r.length > 0 && r.length < minReason)) {
      setLocalErr(`Enter at least ${minReason} characters`); return;
    }
    setLocalErr(null);
    await onConfirm(r);
  });
  const close = () => { setReason(''); setLocalErr(null); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title={title}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        {message ? <Text variant="body" color={colors.textSecondary}>{message}</Text> : null}
        {reasonLabel ? <TextField label={reasonLabel} value={reason} onChangeText={setReason} multiline maxLength={maxReason} error={localErr} /> : null}
        {error ? <Banner tone="error" message={error} /> : null}
        <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} full loading={busy} onPress={() => run()} />
        <Button label="Cancel" variant="secondary" full onPress={close} />
      </View>
    </Sheet>
  );
}

/** Horizontal row of filter chips (wraps instead of scrolling so nothing hides at 1.3x). */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/** Section card with a title (no nested cards). */
export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 }}>
      {title ? <Text variant="subhead">{title}</Text> : null}
      {children}
    </View>
  );
}

/** Flat horizontal bar: label, value text and a proportional bar built from Views. */
export function BarRow({ label, value, max, text, tone = 'primary' }: { label: string; value: number; max: number; text?: string; tone?: 'primary' | 'info' | 'warning' | 'success' }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = tone === 'primary' ? colors.primary : colors[tone];
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`${label}: ${text ?? value}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', columnGap: 12 }}>
        <Text variant="caption" color={colors.textSecondary} style={{ flexShrink: 1 }}>{label}</Text>
        <Text variant="caption" tabular style={{ fontWeight: '600' }}>{text ?? String(value)}</Text>
      </View>
      <View style={{ height: 10, borderRadius: 4, backgroundColor: colors.neutralBg, overflow: 'hidden' }}>
        <View style={{ height: 10, width: `${pct * 100}%`, backgroundColor: fill }} />
      </View>
    </View>
  );
}

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
export const num = (n: number | null | undefined) => (n == null ? '—' : String(n));
export const lpa = (n: number | null | undefined) => (n == null ? '—' : `₹${n} LPA`);

/** Pressable row for selecting one of a few things inside a sheet / list (min 48dp). */
export function PickRow({ label, sub, selected, onPress }: { label: string; sub?: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({ minHeight: MIN_TOUCH, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
    >
      <Text variant="body" style={{ fontWeight: selected ? '700' : '400' }}>{selected ? '✓ ' : ''}{label}</Text>
      {sub ? <Text variant="caption" color={colors.muted}>{sub}</Text> : null}
    </Pressable>
  );
}

/* ---------- IST date/time helpers (no date picker dependency: typed YYYY-MM-DD and HH:mm in IST) ---------- */
const IST_MS = 330 * 60_000;
export function istToIso(date: string, time = '00:00'): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, da, h, mi) - IST_MS;
  const back = new Date(ms + IST_MS);
  if (back.getUTCDate() !== da) return null; // e.g. 31 Feb
  return new Date(ms).toISOString();
}
export function isoToIst(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const x = new Date(ms + IST_MS).toISOString();
  return { date: x.slice(0, 10), time: x.slice(11, 16) };
}
export const todayIst = () => isoToIst(new Date().toISOString()).date;
export function addDaysIst(date: string, days: number): string {
  const iso = istToIso(date, '12:00');
  if (!iso) return date;
  return isoToIst(new Date(Date.parse(iso) + days * 86_400_000).toISOString()).date;
}
export const isDate = (s: string) => istToIso(s, '00:00') !== null;

/** Two text fields: date (YYYY-MM-DD) and time (HH:mm), both IST. */
export function DateTimeFields({ label, date, time, onDate, onTime, error, withTime = true, helper }: {
  label: string; date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void; error?: string | null; withTime?: boolean; helper?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="caption" color={colors.muted}>{label}{withTime ? ' (IST)' : ''}</Text>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 2, minWidth: 150 }}>
          <TextField label="Date" value={date} onChangeText={onDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={error} helper={helper} />
        </View>
        {withTime ? (
          <View style={{ flex: 1, minWidth: 110 }}>
            <TextField label="Time" value={time} onChangeText={onTime} placeholder="HH:mm" keyboardType="numbers-and-punctuation" maxLength={5} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Write text to cache and open the share sheet; toast on failure. */
export function useShareFile() {
  const toast = useToast();
  const online = useIsOnline();
  return useCallback(async (producer: () => Promise<string>, fileName: string, mime: string, title: string) => {
    if (!online) { toast.show('You are offline. Connect to export.', 'error'); return; }
    try {
      const text = await producer();
      if (!text || !text.trim()) { toast.show('Nothing to export for these filters.', 'info'); return; }
      await shareTextFile(fileName, text, mime, title);
    } catch (e) { toast.show(errMessage(e), 'error'); }
  }, [online, toast]);
}
export const stamp = () => new Date().toISOString().slice(0, 10);

export const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', approved: 'info', pending_approval: 'warning', pending: 'warning', draft: 'neutral', scheduled: 'info', sent: 'success',
  rejected: 'error', lifted: 'neutral', expired: 'neutral', verified: 'success', superseded: 'neutral', rolled_back: 'neutral',
};

export const versionLabel = (s: string) =>
  ({ draft: 'Draft', approved: 'Approved', active: 'Active', scheduled: 'Scheduled', superseded: 'Replaced', rolled_back: 'Rolled back' } as Record<string, string>)[s] ?? s;
