import React from 'react';
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { colors, MIN_TOUCH, radius, SCREEN_PADDING } from '@/theme';
import { Text } from './Text';
import { Icon } from './Icon';

export interface ScreenProps {
  children?: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  keyboard?: boolean;
  footer?: React.ReactNode;
  edges?: ('top' | 'bottom')[];
  /** override the canvas background (rare) */
  background?: string;
}

export function Screen({ children, scroll, padded, onRefresh, refreshing, keyboard, footer, edges, background }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const pad = padded ? SCREEN_PADDING : 0;
  const useScroll = !!scroll || !!onRefresh;
  const body = useScroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: pad, paddingBottom: pad + 24, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: pad }}>{children}</View>
  );
  const e: Edge[] = edges ?? ['top', 'bottom'];
  const inner = (
    <>
      {body}
      {footer ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 12 + (e.includes('bottom') ? 0 : insets.bottom),
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            gap: 8,
          }}
        >
          {footer}
        </View>
      ) : null}
    </>
  );
  return (
    <SafeAreaView edges={e} style={{ flex: 1, backgroundColor: background ?? colors.canvas }}>
      {keyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

/** 48x48 icon button for Header `right` slots and toolbars. */
export function HeaderAction({
  icon,
  label,
  onPress,
  onDark,
  badge,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
  onDark?: boolean;
  /** small count shown as text in a coral dot-free pill (e.g. unread); 0/undefined hides it */
  badge?: number;
}) {
  const fg = onDark ? colors.onPrimary : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} new` : label}
      style={({ pressed }) => ({
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        borderRadius: radius.button,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? (onDark ? 'rgba(255,255,255,0.14)' : colors.pressed) : 'transparent',
      })}
    >
      <Icon name={icon} size={24} color={fg} />
      {badge ? (
        <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 4, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="overline" color={colors.ink} style={{ fontSize: 11, lineHeight: 14 }} maxFontSizeMultiplier={1.1} tabular>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export type HeaderVariant = 'plain' | 'bar' | 'teal';

/**
 * plain (default): inline title on the canvas, sits inside a padded Screen (legacy behaviour).
 * bar:  full-width white bar with hairline bottom border; handles the status-bar inset itself.
 * teal: full-width teal-800 large-title band (display type, white text); handles the status-bar inset itself.
 * For bar/teal use <Screen padded={false} edges={['bottom']}> and put your padding inside the body.
 */
export function Header({
  title,
  onBack,
  right,
  subtitle,
  variant = 'plain',
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  subtitle?: string;
  variant?: HeaderVariant;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const teal = variant === 'teal';
  const band = variant !== 'plain';
  const fg = teal ? colors.onPrimary : colors.ink;
  const sub = teal ? colors.onPrimaryMuted : colors.muted;
  return (
    <View
      style={
        band
          ? {
              paddingTop: insets.top,
              paddingHorizontal: SCREEN_PADDING,
              paddingBottom: teal ? 16 : 0,
              backgroundColor: teal ? colors.primaryDark : colors.surface,
              borderBottomWidth: teal ? 0 : 1,
              borderBottomColor: colors.border,
            }
          : undefined
      }
    >
      {teal && focused ? <StatusBar style="light" /> : null}
      <View style={{ flexDirection: 'row', alignItems: teal ? 'flex-start' : 'center', minHeight: 56, gap: 4, marginBottom: band ? 0 : 8 }}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={4}
            style={({ pressed }) => ({
              width: MIN_TOUCH,
              height: MIN_TOUCH,
              marginLeft: -12,
              borderRadius: radius.button,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? (teal ? 'rgba(255,255,255,0.14)' : colors.pressed) : 'transparent',
            })}
          >
            <Icon name="arrow-back" size={24} color={fg} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', alignSelf: 'center', paddingVertical: teal ? 6 : 0 }}>
          <Text variant={teal ? 'display' : 'title'} color={fg} numberOfLines={2} ellipsizeMode="tail">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color={sub} numberOfLines={2} ellipsizeMode="tail">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0, marginRight: band ? -12 : 0 }}>{right}</View> : null}
      </View>
    </View>
  );
}
