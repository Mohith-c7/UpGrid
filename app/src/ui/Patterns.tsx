import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, CONTROL_HEIGHT, fontFamilyFor, MIN_TOUCH, monoFamily, radius, shadow, SCREEN_PADDING, toneColors, toneIcons, urgentColors, type Tone } from '@/theme';
import type { DriveSummary } from '@/api/types';
import { formatCtc, relativeDeadline } from '@/lib/format';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Badge, Card, Chip, CompanyLogo } from './Surface';

/* ======================= BrandLogo ======================= */
/** Flat rounded-square product mark. onDark: white tile with teal check (for teal bands); otherwise teal tile. */
export function BrandLogo({ size = 56, onDark }: { size?: number; onDark?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel="Placement OS logo"
      style={{ width: size, height: size, borderRadius: radius.logo, backgroundColor: onDark ? colors.onPrimary : colors.primary, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="check" size={Math.round(size * 0.58)} color={onDark ? colors.primary : colors.onPrimary} />
    </View>
  );
}

/* ======================= ScreenHero ======================= */
/**
 * Teal-800 header band (flat). Handles the status-bar inset itself: use inside <Screen padded={false} edges={['bottom']}>.
 * `children` = optional summary card that overlaps the band's bottom edge by 24px. Put your own padded content after it.
 */
export function ScreenHero({
  title,
  eyebrow,
  subtitle,
  onBack,
  right,
  brand,
  children,
}: {
  title: string;
  /** small line above the title, e.g. "Good morning" */
  eyebrow?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** show the Placement OS logo mark above the title */
  brand?: boolean;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  return (
    <View>
      {focused ? <StatusBar style="light" /> : null}
      <View
        style={{
          backgroundColor: colors.primaryDark,
          paddingTop: insets.top + 8,
          paddingHorizontal: SCREEN_PADDING,
          paddingBottom: children ? 48 : 24,
        }}
      >
        {onBack || right ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, marginHorizontal: -12 }}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={({ pressed }) => ({ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent' })}
              >
                <Icon name="arrow-back" size={24} color={colors.onPrimary} />
              </Pressable>
            ) : (
              <View />
            )}
            {right ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View> : null}
          </View>
        ) : null}
        <View style={{ gap: 4, paddingTop: onBack || right ? 4 : 8 }}>
          {brand ? (
            <View style={{ marginBottom: 12 }}>
              <BrandLogo onDark />
            </View>
          ) : null}
          {eyebrow ? (
            <Text variant="caption" color={colors.onPrimaryMuted}>
              {eyebrow}
            </Text>
          ) : null}
          <Text variant="display" color={colors.onPrimary}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" color={colors.onPrimaryMuted}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {children ? <View style={{ marginTop: -24, paddingHorizontal: SCREEN_PADDING }}>{children}</View> : null}
    </View>
  );
}

/* ======================= Banner ======================= */
export function Banner({
  tone = 'info',
  title,
  message,
  action,
  icon,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
  icon?: IconName;
}) {
  const t = toneColors[tone];
  return (
    <View
      accessibilityRole={tone === 'error' || tone === 'warning' ? 'alert' : undefined}
      style={{ flexDirection: 'row', gap: 10, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.card, padding: 12 }}
    >
      <Icon name={icon ?? (toneIcons[tone] as IconName)} size={22} color={t.fg} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {title ? (
          <Text variant="subhead" color={t.fg}>
            {title}
          </Text>
        ) : null}
        <Text variant="caption" color={t.fg} style={{ fontSize: 14, lineHeight: 20 }}>
          {message}
        </Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} style={{ minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text variant="button" color={t.fg} style={{ textDecorationLine: 'underline' }}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* ======================= StatTile ======================= */
/** Number-first summary tile for dashboards. Lay out two per row with `flex: 1` wrappers. */
export function StatTile({
  label,
  value,
  icon,
  tone = 'neutral',
  hint,
  onPress,
}: {
  label: string;
  value: string | number;
  icon?: IconName;
  tone?: Tone;
  hint?: string;
  onPress?: () => void;
}) {
  const t = toneColors[tone];
  const iconBg = tone === 'neutral' ? colors.primaryTint : t.bg;
  const iconFg = tone === 'neutral' ? colors.primary : t.fg;
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value}`} padding={14} style={{ flex: 1, gap: 8 }}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radius.chip + 2, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={iconFg} />
        </View>
      ) : null}
      <Text variant="display" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <View>
        <Text variant="caption" color={colors.muted} numberOfLines={2}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color={iconFg} numberOfLines={1} style={{ fontWeight: '600' }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/* ======================= MetricRow ======================= */
/** Label on the left, bold tabular value on the right; wraps cleanly at large font scale. */
export function MetricRow({ label, value, hint, tone, last }: { label: string; value: string | number; hint?: string; tone?: Tone; last?: boolean }) {
  const fg = tone ? toneColors[tone].fg : colors.ink;
  return (
    <View style={{ minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant="body" color={colors.textSecondary}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color={colors.muted}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant="subhead" tabular color={fg}>
        {value}
      </Text>
    </View>
  );
}

/* ======================= KeyValueList ======================= */
export interface KeyValueItem {
  label: string;
  value: string | number | null | undefined;
  icon?: IconName;
  /** replace the text value with custom content (badge, link...) */
  node?: React.ReactNode;
}
/** Detail-screen facts. Label (muted caption) above value; set `inline` for label-left / value-right rows. */
export function KeyValueList({ items, inline }: { items: KeyValueItem[]; inline?: boolean }) {
  return (
    <View>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const val = it.node ?? (
          <Text variant="body" tabular={typeof it.value === 'number'} style={{ fontWeight: '500', textAlign: inline ? 'right' : 'left' }}>
            {it.value === null || it.value === undefined || it.value === '' ? '—' : String(it.value)}
          </Text>
        );
        return (
          <View
            key={`${it.label}-${i}`}
            style={{
              flexDirection: inline ? 'row' : 'column',
              gap: inline ? 16 : 2,
              alignItems: inline ? 'flex-start' : 'stretch',
              justifyContent: 'space-between',
              paddingVertical: 10,
              borderBottomWidth: last ? 0 : 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: inline ? 0 : 1, maxWidth: inline ? '45%' : '100%' }}>
              {it.icon ? <Icon name={it.icon} size={16} color={colors.subtle} /> : null}
              <Text variant="caption" color={colors.muted}>
                {it.label}
              </Text>
            </View>
            <View style={{ flex: inline ? 1 : undefined, minWidth: 0 }}>{val}</View>
          </View>
        );
      })}
    </View>
  );
}

/* ======================= StepIndicator ======================= */
/** Flat segmented bar. `current` is 0-based. Always shows "Step n of N" text. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  const n = steps.length;
  const idx = Math.max(0, Math.min(n - 1, current));
  return (
    <View accessible accessibilityLabel={`Step ${idx + 1} of ${n}: ${steps[idx]}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {steps.map((s, i) => (
          <View key={`${s}-${i}`} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= idx ? colors.primary : colors.border }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="caption" color={colors.muted} tabular>
          Step {idx + 1} of {n}
        </Text>
        <Text variant="caption" style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
          {steps[idx]}
        </Text>
      </View>
    </View>
  );
}

/* ======================= TimelineList ======================= */
export interface TimelineItem {
  id?: string;
  title: string;
  subtitle?: string;
  /** right-aligned or trailing time text, e.g. "12 Nov, 4:00 PM" */
  time?: string;
  state?: 'done' | 'current' | 'upcoming' | 'error';
}
/** Vertical timeline with square markers (done = filled check, current = filled teal, upcoming = outline, error = red). */
export function TimelineList({ items }: { items: TimelineItem[] }) {
  return (
    <View>
      {items.map((it, i) => {
        const state = it.state ?? 'upcoming';
        const last = i === items.length - 1;
        const filled = state === 'done' || state === 'current' || state === 'error';
        const c = state === 'error' ? colors.error : colors.primary;
        const icon: IconName | null = state === 'done' ? 'check' : state === 'error' ? 'close' : null;
        return (
          <View key={it.id ?? `${it.title}-${i}`} style={{ flexDirection: 'row', gap: 12 }} accessible accessibilityLabel={`${it.title}${it.subtitle ? `. ${it.subtitle}` : ''}${it.time ? `. ${it.time}` : ''}. ${state}`}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  borderWidth: 2,
                  borderColor: filled ? c : colors.borderStrong,
                  backgroundColor: filled && state !== 'current' ? c : colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {icon ? <Icon name={icon} size={14} color={colors.onPrimary} /> : null}
                {state === 'current' ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c }} /> : null}
              </View>
              {!last ? <View style={{ flex: 1, width: 2, minHeight: 16, backgroundColor: state === 'done' ? colors.primary : colors.border }} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}>
              <Text variant="subhead" color={state === 'upcoming' ? colors.textSecondary : colors.ink}>
                {it.title}
              </Text>
              {it.subtitle ? (
                <Text variant="caption" color={colors.muted}>
                  {it.subtitle}
                </Text>
              ) : null}
              {it.time ? (
                <Text variant="caption" color={colors.muted} tabular>
                  {it.time}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ======================= SearchBar ======================= */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  accessibilityLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const bw = focused ? 2 : 1;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: CONTROL_HEIGHT,
        borderRadius: radius.input,
        borderWidth: bw,
        borderColor: focused ? colors.primary : colors.borderStrong,
        backgroundColor: colors.surface,
        paddingLeft: 16 - bw + 1,
      }}
    >
      <Icon name="search" size={22} color={colors.subtle} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.primary}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        maxFontSizeMultiplier={1.6}
        autoCorrect={false}
        style={{ flex: 1, fontSize: 15, lineHeight: 20, fontFamily: fontFamilyFor('400'), color: colors.ink, paddingHorizontal: 10, paddingVertical: 8, minHeight: CONTROL_HEIGHT - 2 * bw }}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ======================= SegmentedTabs ======================= */
/** Underline tabs for switching views on one screen (e.g. Open / Closing / Closed). Scrolls horizontally if crowded. */
export function SegmentedTabs({
  value,
  onChange,
  options,
}: {
  value?: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string; count?: number }[];
}) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={{ gap: 4 }}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
              style={{ minHeight: MIN_TOUCH, minWidth: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 3, borderBottomColor: sel ? colors.primary : 'transparent', marginBottom: -1 }}
            >
              <Text variant="subhead" color={sel ? colors.primary : colors.muted} numberOfLines={1}>
                {o.label}
              </Text>
              {o.count !== undefined ? (
                <View style={{ minWidth: 22, paddingHorizontal: 6, borderRadius: 6, backgroundColor: sel ? colors.primaryTint2 : colors.neutralBg, alignItems: 'center' }}>
                  <Text variant="caption" tabular color={sel ? colors.primaryDark : colors.muted} style={{ fontWeight: '600', fontSize: 12, lineHeight: 18 }}>
                    {o.count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ======================= CodeBlock ======================= */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>
          {label}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.pressed, borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, padding: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text selectable maxFontSizeMultiplier={1.4} style={{ fontFamily: monoFamily, fontSize: 13, lineHeight: 20, color: colors.ink, fontWeight: '400' }}>
            {code}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

/* ======================= TestTimerBar ======================= */
/** Flat timer strip for test-taking screens. Pass remaining/total ms; shows mm:ss and turns coral (with text) in the last 10%/5 min. */
export function TestTimerBar({ remainingMs, totalMs, label = 'Time left' }: { remainingMs: number; totalMs: number; label?: string }) {
  const rem = Math.max(0, remainingMs);
  const frac = totalMs > 0 ? Math.min(1, rem / totalMs) : 0;
  const low = rem > 0 && (frac <= 0.1 || rem <= 5 * 60 * 1000);
  const s = Math.floor(rem / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const clock = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  const fg = low ? urgentColors.fg : colors.ink;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${label}: ${Math.floor(s / 60)} minutes ${s % 60} seconds${low ? '. Running low' : ''}`}
      style={{ backgroundColor: low ? urgentColors.bg : colors.surface, borderBottomWidth: 1, borderBottomColor: low ? urgentColors.border : colors.border, paddingHorizontal: SCREEN_PADDING, paddingTop: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={low ? 'timer' : 'schedule'} size={20} color={fg} />
          <Text variant="caption" color={fg} style={{ fontWeight: '600' }}>
            {low ? `${label} - running low` : label}
          </Text>
        </View>
        <Text variant="heading" tabular color={fg}>
          {clock}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.border, marginTop: 4 }}>
        <View style={{ height: 6, width: `${frac * 100}%`, backgroundColor: low ? urgentColors.fillStrong : colors.primary }} />
      </View>
    </View>
  );
}

/* ======================= DriveCard ======================= */
export interface DriveCardProps {
  drive: DriveSummary;
  onPress?: () => void;
  /** omit to hide the bookmark button */
  onToggleSave?: () => void;
  variant?: 'full' | 'compact';
  /** serverNow - deviceNow in ms, for accurate "Closes in" text */
  serverOffsetMs?: number;
  style?: StyleProp<ViewStyle>;
}

function eligibilityBadge(d: DriveSummary) {
  if (d.applied) return <Badge label="Applied" tone="success" icon="check-circle-outline" />;
  const s = d.eligibility?.status;
  if (s === 'eligible') return <Badge label="Eligible" tone="success" icon="check-circle-outline" />;
  if (s === 'not_eligible') return <Badge label="Not eligible" tone="error" icon="block" />;
  if (s === 'restricted') return <Badge label="Restricted" tone="warning" icon="gpp-maybe" />;
  return <Badge label="Eligibility pending" tone="warning" icon="hourglass-empty" />;
}

/**
 * Standard drive list item. Truncation: role max 2 lines, company 1 line, locations show first 2 + "+N", package 1 line.
 * Deadline text turns coral-dark with a timer icon when closing within 24h; "Closed" is muted.
 */
export function DriveCard({ drive, onPress, onToggleSave, variant = 'full', serverOffsetMs = 0, style }: DriveCardProps) {
  const closed = drive.status === 'closed';
  const diff = Date.parse(drive.deadline) - (Date.now() + serverOffsetMs);
  const soon = !closed && diff > 0 && diff < 24 * 3600 * 1000;
  const deadlineText = closed || diff <= 0 ? 'Closed' : relativeDeadline(drive.deadline, serverOffsetMs);
  const dColor = closed || diff <= 0 ? colors.muted : soon ? urgentColors.fg : colors.textSecondary;
  const compact = variant === 'compact';
  const locs = drive.locations ?? [];
  const locText = locs.length === 0 ? null : locs.length <= 2 ? locs.join(', ') : `${locs.slice(0, 2).join(', ')} +${locs.length - 2}`;
  const pkg = formatCtc(drive.ctc);
  const saved = !!drive.saved;
  const label = `${drive.role} at ${drive.company.name}. ${pkg}. ${deadlineText}.`;

  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, ...shadow.card }, style]}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
        style={({ pressed }) => ({ borderRadius: radius.card, padding: compact ? 12 : 16, gap: compact ? 8 : 12, minHeight: MIN_TOUCH, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
      >
        <View style={{ flexDirection: 'row', gap: 12, paddingRight: onToggleSave ? 40 : 0 }}>
          <CompanyLogo name={drive.company.name} logoUrl={drive.company.logoUrl} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subhead" numberOfLines={2} ellipsizeMode="tail">
              {drive.role}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="caption" color={colors.muted} numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1 }}>
                {compact && locText ? `${drive.company.name} · ${locText}` : drive.company.name}
              </Text>
              {drive.company.verified ? <Icon name="verified" size={16} color={colors.primary} /> : null}
            </View>
          </View>
        </View>

        {!compact && (locText || drive.workMode) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {locText ? <Chip label={locText} icon="place" /> : null}
            {drive.workMode ? <Chip label={drive.workMode} icon="work-outline" /> : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 }}>
          <Text variant={compact ? 'subhead' : 'heading'} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
            {pkg}
          </Text>
          {compact ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={soon ? 'timer' : 'schedule'} size={16} color={dColor} />
              <Text variant="caption" tabular color={dColor} style={{ fontWeight: soon ? '600' : '400' }}>
                {deadlineText}
              </Text>
            </View>
          ) : null}
        </View>

        {!compact ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              <Icon name={soon ? 'timer' : 'schedule'} size={18} color={dColor} />
              <Text variant="caption" tabular color={dColor} style={{ fontWeight: soon ? '600' : '500', flexShrink: 1 }}>
                {deadlineText}
              </Text>
            </View>
            {eligibilityBadge(drive)}
          </View>
        ) : (
          eligibilityBadge(drive)
        )}
      </Pressable>
      {onToggleSave ? (
        <Pressable
          onPress={onToggleSave}
          accessibilityRole="button"
          accessibilityLabel={saved ? `Remove ${drive.role} from saved` : `Save ${drive.role}`}
          accessibilityState={{ selected: saved }}
          style={({ pressed }) => ({ position: 'absolute', top: compact ? 4 : 8, right: compact ? 4 : 8, width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.pressed : 'transparent' })}
        >
          <Icon name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={saved ? colors.primary : colors.subtle} />
        </Pressable>
      ) : null}
    </View>
  );
}
