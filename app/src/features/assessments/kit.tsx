import React from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Header, Icon, OfflineBanner, Screen, Sheet, Text, TextField, useIsOnline, type IconName } from '@/ui';
import { colors, MIN_TOUCH, type Tone } from '@/theme';
import { ApiError } from '@/api/client';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';
import type { AssessmentStatus, Difficulty, QuestionType } from '@/api/assessments';

export const ROOT = '/(officer)/assessments';

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq_single: 'MCQ single', mcq_multi: 'MCQ multi', numeric: 'Numeric', short_text: 'Short text', coding: 'Coding',
};
export const TYPE_ICON: Record<QuestionType, IconName> = {
  mcq_single: 'radio-button-checked', mcq_multi: 'check-box', numeric: 'pin', short_text: 'short-text', coding: 'code',
};
export const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
export const DIFF_TONE: Record<Difficulty, Tone> = { easy: 'success', medium: 'warning', hard: 'error' };
export const LANG_LABEL: Record<string, string> = { python3: 'Python 3', java: 'Java', cpp: 'C++', c: 'C', javascript: 'JavaScript' };

export const STATUS_TONE: Record<AssessmentStatus, Tone> = { draft: 'neutral', published: 'success', archived: 'neutral' };
export const STATUS_LABEL: Record<AssessmentStatus, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
const STATUS_ICON: Record<AssessmentStatus, IconName> = { draft: 'edit', published: 'check-circle-outline', archived: 'inventory-2' };

export const AssessmentStatusBadge = ({ status }: { status: AssessmentStatus }) =>
  <Badge label={STATUS_LABEL[status] ?? status} tone={STATUS_TONE[status] ?? 'neutral'} icon={STATUS_ICON[status]} />;
export const DifficultyBadge = ({ d }: { d: Difficulty }) => <Badge label={DIFF_LABEL[d] ?? d} tone={DIFF_TONE[d] ?? 'neutral'} />;

/* ---------------- number helpers ---------------- */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}
/** Parse a user typed decimal. Returns null for empty/invalid. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '-';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Flat list of readable server field errors, or the message when there are none. */
export function errorLines(e: unknown): string[] {
  if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) {
    return Object.entries(e.fields).map(([k, v]) => `${prettyPath(k)}: ${v}`);
  }
  return e instanceof Error ? [e.message] : ['Something went wrong. Please try again.'];
}
export function prettyPath(p: string): string {
  return p
    .replace(/\.(\d+)\./g, (_m, n) => ` ${Number(n) + 1} `)
    .replace(/\.(\d+)$/, (_m, n) => ` ${Number(n) + 1}`)
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
export const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

/* ---------------- screen frame ---------------- */
/** The banner has its own border and radius, so inside an unpadded screen it needs side margins. */
function PaddedOffline() {
  const online = useIsOnline();
  if (online) return null;
  return <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><OfflineBanner /></View>;
}

export function Frame({
  title, subtitle, right, footer, children, onRefresh, refreshing, keyboard, onBack,
}: {
  title: string; subtitle?: string; right?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode;
  onRefresh?: () => void; refreshing?: boolean; keyboard?: boolean; onBack?: () => void;
}) {
  const r = useRouter();
  const back = onBack ?? (() => (r.canGoBack() ? r.back() : r.replace(ROOT as any)));
  return (
    <Screen padded={false} edges={['bottom']} footer={footer} keyboard={keyboard}>
      <FocusedStatusBar />
      <Header variant="bar" title={title} subtitle={subtitle} onBack={back} right={right} />
      <PaddedOffline />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined}
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

/** Header for list screens that own a FlatList. */
export function ListFrame({ title, subtitle, right, footer, children, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; onBack?: () => void }) {
  const r = useRouter();
  const back = onBack ?? (() => (r.canGoBack() ? r.back() : r.replace('/(officer)/(tabs)/more' as any)));
  return (
    <Screen padded={false} edges={['bottom']} footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title={title} subtitle={subtitle} onBack={back} right={right} />
      <PaddedOffline />
      {children}
    </Screen>
  );
}

/* ---------------- controls ---------------- */
export function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ checked: value, disabled }}
      style={{ minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" style={{ fontWeight: '500' }}>{label}</Text>
        {hint ? <Text variant="caption" color={colors.muted}>{hint}</Text> : null}
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} disabled={disabled} trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} />
      </View>
    </Pressable>
  );
}

/** Decimal / integer entry that keeps the raw text so "1." and "" are possible while typing. */
export function NumberField({ label, value, onChange, error, helper, integer, placeholder }: { label: string; value: string; onChange: (s: string) => void; error?: string | null; helper?: string; integer?: boolean; placeholder?: string }) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={(t) => onChange(integer ? t.replace(/[^0-9]/g, '') : t.replace(/[^0-9.,]/g, ''))}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      error={error}
      helper={helper}
      placeholder={placeholder}
    />
  );
}

export function ErrorList({ title, lines, onJump }: { title: string; lines: string[]; onJump?: () => void }) {
  if (!lines.length) return null;
  return (
    <Banner
      tone="error"
      title={title}
      message={lines.slice(0, 12).join('\n') + (lines.length > 12 ? `\n+${lines.length - 12} more` : '')}
      action={onJump ? { label: 'Go to first problem', onPress: onJump } : undefined}
    />
  );
}

export function ConfirmSheet({
  visible, onClose, title, message, confirmLabel, tone = 'primary', onConfirm, children, disabled,
}: {
  visible: boolean; onClose: () => void; title: string; message?: string; confirmLabel: string; tone?: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>; children?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        {message ? <Text variant="body">{message}</Text> : null}
        {children}
        <Button label={confirmLabel} variant={tone === 'danger' ? 'danger' : 'primary'} full disabled={disabled} onPress={onConfirm} />
        <Button label="Cancel" variant="secondary" full onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function MoreFooter({ hasMore, loading, error, onMore, onRetry }: { hasMore?: boolean; loading?: boolean; error?: boolean; onMore: () => void; onRetry: () => void }) {
  if (error) return <View style={{ paddingVertical: 12 }}><Banner tone="warning" message="Could not load more." action={{ label: 'Retry', onPress: onRetry }} /></View>;
  if (loading) return <View style={{ paddingVertical: 16, alignItems: 'center' }}><Text variant="caption" color={colors.muted}>Loading more...</Text></View>;
  if (hasMore) return <View style={{ paddingVertical: 8 }}><Button label="Load more" variant="secondary" full onPress={onMore} /></View>;
  return <View style={{ height: 16 }} />;
}

/** Flat horizontal bar: label above, value text right, bar below. Never colour-only: value is written out. */
export function FlatBar({ label, value, max, text, tone = 'brand' }: { label: string; value: number; max: number; text: string; tone?: 'brand' | 'warning' | 'error' | 'success' }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = tone === 'brand' ? colors.primary : tone === 'warning' ? colors.amber : tone === 'error' ? colors.error : colors.success;
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`${label}: ${text}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="caption" style={{ flexShrink: 1, fontWeight: '500' }}>{label}</Text>
        <Text variant="caption" tabular color={colors.muted}>{text}</Text>
      </View>
      <View style={{ height: 10, borderRadius: 3, backgroundColor: colors.neutralBg, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 10, backgroundColor: fill }} />
      </View>
    </View>
  );
}

export function Pill({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text variant="caption" color={colors.muted} tabular>{text}</Text>
    </View>
  );
}
