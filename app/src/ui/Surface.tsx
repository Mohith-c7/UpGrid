import React, { useState } from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, logoTints, MIN_TOUCH, radius, shadow, toneColors, toneIcons, type Tone } from '@/theme';
import { initials } from '@/lib/format';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

/* ---------------- Card ---------------- */
/** White surface, 1px hairline, one very light shadow. `padding` defaults to 16; pass 0 for edge-to-edge content (lists). */
export function Card({
  children,
  onPress,
  style,
  accessibilityLabel,
  padding = 16,
  tinted,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  padding?: number;
  /** teal-50 background for a highlighted/summary card (no shadow) */
  tinted?: boolean;
}) {
  const base: ViewStyle = {
    backgroundColor: tinted ? colors.primaryTint : colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: tinted ? colors.primaryTint2 : colors.border,
    padding,
    ...(tinted ? null : shadow.card),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, { minHeight: MIN_TOUCH }, pressed ? { backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong } : null, style]}
    >
      {children}
    </Pressable>
  );
}

/* ---------------- Chip ---------------- */
/** Interactive: a filter chip (check icon when selected). Non-interactive (no onPress): a tinted tag, optionally with an icon. */
export function Chip({
  label,
  selected,
  onPress,
  tone,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: Tone;
  icon?: IconName;
}) {
  const t = tone ? toneColors[tone] : null;
  const interactive = !!onPress;
  let bg: string = colors.surface;
  let fg: string = colors.textSecondary;
  let border: string = colors.borderStrong;
  if (selected) {
    bg = colors.primaryTint;
    fg = colors.primaryDark;
    border = colors.primary;
  } else if (t) {
    bg = t.bg;
    fg = t.fg;
    border = t.border;
  } else if (!interactive) {
    bg = colors.neutralBg;
    fg = colors.textSecondary;
    border = colors.neutralBorder;
  }
  const leading: IconName | null = selected && interactive ? 'check' : (icon ?? null);
  const pill = (
    <View
      style={{
        minHeight: interactive ? 40 : 28,
        maxWidth: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: interactive ? 14 : 10,
        borderRadius: radius.chip,
        borderWidth: selected ? 1.5 : 1,
        borderColor: border,
        backgroundColor: bg,
      }}
    >
      {leading ? <Icon name={leading} size={interactive ? 18 : 16} color={fg} /> : null}
      <Text variant="caption" color={fg} numberOfLines={1} style={{ fontWeight: '600', flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
  if (!interactive) return <View style={{ maxWidth: '100%' }}>{pill}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      style={{ minHeight: MIN_TOUCH, justifyContent: 'center', maxWidth: '100%' }}
    >
      {pill}
    </Pressable>
  );
}

/* ---------------- Badge ---------------- */
/** Status pill: tinted background + icon + text, so meaning never depends on colour alone. `icon={false}` hides the icon. */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName | false }) {
  const t = toneColors[tone];
  const ic: IconName | null = icon === false ? null : (icon ?? (toneIcons[tone] as IconName));
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: t.bg,
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: t.border,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      {ic ? <Icon name={ic} size={16} color={t.fg} /> : null}
      <Text variant="overline" color={t.fg} numberOfLines={1} style={{ textTransform: 'none', letterSpacing: 0.1, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/* ---------------- Logo tile / Avatar ---------------- */
export function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return logoTints[h % logoTints.length];
}

/** Rounded-square company tile. Sizes 44 (lists) and 56 (detail headers); any size works. */
export function CompanyLogo({ name, logoUrl, size = 44 }: { name: string; logoUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const tint = tintFor(name || '?');
  const r = size <= 32 ? 8 : radius.logo;
  if (logoUrl && !failed) {
    const pad = Math.round(size * 0.14);
    return (
      <View
        accessible
        accessibilityLabel={`${name} logo`}
        style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
      >
        <Image source={{ uri: logoUrl }} style={{ width: size - 2 * pad, height: size - 2 * pad }} resizeMode="contain" onError={() => setFailed(true)} />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{ width: size, height: size, borderRadius: r, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text color={tint.fg} style={{ fontSize: Math.max(11, Math.round(size * 0.36)), lineHeight: Math.round(size * 0.46), fontWeight: '700' }} maxFontSizeMultiplier={1.2}>
        {initials(name)}
      </Text>
    </View>
  );
}

/** Person avatar: same family as CompanyLogo (rounded square, initials, deterministic muted tint) for a consistent flat look. */
export function Avatar({ name, logoUrl, size = 44 }: { name: string; logoUrl?: string | null; size?: number }) {
  return <CompanyLogo name={name} logoUrl={logoUrl} size={size} />;
}

/* ---------------- ListRow ---------------- */
export function ListRow({
  title,
  subtitle,
  right,
  left,
  icon,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
  icon?: IconName;
  onPress?: () => void;
  /** hide the bottom divider (last row of a group) */
  last?: boolean;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 }}>
      {left ??
        (icon ? (
          <View style={{ width: 40, height: 40, borderRadius: radius.chip + 4, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={22} color={colors.primary} />
          </View>
        ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={2} ellipsizeMode="tail" style={{ fontWeight: '500' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={colors.muted} numberOfLines={3} ellipsizeMode="tail">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={24} color={colors.subtle} /> : null)}
    </View>
  );
  const rowStyle: ViewStyle = { borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border };
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [rowStyle, { minHeight: MIN_TOUCH }, pressed ? { backgroundColor: colors.pressed } : null]}
    >
      {body}
    </Pressable>
  );
}

/* ---------------- SectionHeader ---------------- */
export function SectionHeader({
  title,
  action,
  subtitle,
}: {
  title: string;
  action?: { label: string; onPress: () => void } | React.ReactNode;
  subtitle?: string;
}) {
  const isAction = (a: unknown): a is { label: string; onPress: () => void } =>
    !!a && typeof a === 'object' && 'label' in (a as object) && 'onPress' in (a as object) && !React.isValidElement(a);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, marginTop: 8 }}>
      <View style={{ flex: 1 }}>
        <Text variant="heading" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={colors.muted} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {isAction(action) ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', alignItems: 'flex-end', paddingLeft: 12 }}
        >
          <Text variant="button" color={colors.primary}>
            {action.label}
          </Text>
        </Pressable>
      ) : (
        (action as React.ReactNode) ?? null
      )}
    </View>
  );
}
