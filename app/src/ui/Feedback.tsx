import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { colors, radius } from '@/theme';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import { useIsOnline } from './hooks';

/* Only the most recently mounted banner renders, so a screen's own banner and the root one never stack. */
const bannerStack: number[] = [];
const bannerSubs = new Set<() => void>();
let bannerNextId = 1;

function useIsTopBanner(root: boolean): boolean {
  const [id] = useState(() => bannerNextId++);
  const [top, setTop] = useState(false);
  useEffect(() => {
    const notify = () => setTop(bannerStack[bannerStack.length - 1] === id);
    bannerSubs.add(notify);
    if (root) bannerStack.unshift(id);
    else bannerStack.push(id);
    bannerSubs.forEach((f) => f());
    return () => {
      const i = bannerStack.indexOf(id);
      if (i >= 0) bannerStack.splice(i, 1);
      bannerSubs.delete(notify);
      bannerSubs.forEach((f) => f());
    };
  }, [id, root]);
  return top;
}

/** Static placeholder (no shimmer, no pulse). */
export function Skeleton({ height, width = '100%', radius: r = 8 }: { height: number; width?: number | `${number}%`; radius?: number }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ height, width, borderRadius: Math.min(r, radius.card), backgroundColor: colors.border }}
    />
  );
}

function StateTile({ icon, bg, fg }: { icon: IconName; bg: string; fg: string }) {
  return (
    <View style={{ width: 64, height: 64, borderRadius: radius.card, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={28} color={fg} />
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  icon = 'inbox',
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 8 }}>
      <StateTile icon={icon} bg={colors.primaryTint} fg={colors.primary} />
      <View style={{ height: 8 }} />
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" color={colors.muted} align="center">
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 8 }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry, title = 'Something went wrong' }: { message?: string; onRetry?: () => void; title?: string }) {
  return (
    <View accessibilityRole="alert" style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 8 }}>
      <StateTile icon="error-outline" bg={colors.errorBg} fg={colors.error} />
      <View style={{ height: 8 }} />
      <Text variant="heading" align="center">
        {title}
      </Text>
      <Text variant="body" color={colors.muted} align="center">
        {message ?? 'We could not load this. Please try again.'}
      </Text>
      {onRetry ? (
        <View style={{ marginTop: 8 }}>
          <Button label="Try again" icon="refresh" onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function OfflineBanner({ root = false }: { root?: boolean } = {}) {
  const online = useIsOnline();
  const top = useIsTopBanner(root);
  const insets = useSafeAreaInsets();
  if (online || !top) return null;
  const banner = (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder, borderRadius: radius.button, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 }}
    >
      <Icon name="cloud-off" size={20} color={colors.warning} />
      <Text variant="caption" color={colors.warning} style={{ flex: 1, fontWeight: '600' }}>
        You are offline. Some information may be out of date.
      </Text>
    </View>
  );
  // root: pad for the status bar only while this banner is actually the one on screen
  return root ? <View style={{ paddingTop: insets.top, paddingHorizontal: 12, backgroundColor: colors.canvas }}>{banner}</View> : banner;
}

/** Flat 6px bar with rounded ends. Always pair with a number or label nearby; colour is a supplement. */
export function ProgressBar({ value, label, tone }: { value: number; label?: string; tone?: 'brand' | 'success' | 'warning' | 'error' }) {
  const pct = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  const fill = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'error' ? colors.error : colors.primary;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Progress'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}
    >
      <View style={{ height: 6, width: `${pct}%`, backgroundColor: fill, borderRadius: 3 }} />
    </View>
  );
}
