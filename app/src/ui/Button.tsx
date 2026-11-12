import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { colors, CONTROL_HEIGHT, MIN_TOUCH, radius } from '@/theme';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  full?: boolean;
  accessibilityLabel?: string;
  /** 'md' = 52dp (default), 'sm' = 48dp for dense rows / inline actions. Both meet the 48dp touch target. */
  size?: 'md' | 'sm';
}

const palette: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string; pressedBorder: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary, pressed: colors.primaryDark, pressedBorder: colors.primaryDark },
  secondary: { bg: colors.surface, fg: colors.primary, border: colors.primary, pressed: colors.primaryTint, pressedBorder: colors.primaryDark },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent', pressed: colors.primaryTint, pressedBorder: 'transparent' },
  danger: { bg: colors.error, fg: colors.onPrimary, border: colors.error, pressed: '#8E1B12', pressedBorder: '#8E1B12' },
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, icon, full, accessibilityLabel, size = 'md' }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const p = palette[variant];
  const inactive = !!disabled || !!loading || busy;

  const handlePress = () => {
    if (lock.current || disabled || loading) return;
    lock.current = true;
    let result: void | Promise<void>;
    try {
      result = onPress();
    } catch (e) {
      lock.current = false;
      throw e;
    }
    if (result && typeof (result as Promise<void>).then === 'function') {
      if (mounted.current) setBusy(true);
      (result as Promise<void>)
        .catch(() => undefined)
        .finally(() => {
          lock.current = false;
          if (mounted.current) setBusy(false);
        });
    } else {
      // brief lock stops accidental double taps on sync handlers
      setTimeout(() => {
        lock.current = false;
      }, 400);
    }
  };

  const fg = disabled ? colors.subtle : p.fg;
  const working = !!loading || busy;
  const height = size === 'sm' ? MIN_TOUCH : CONTROL_HEIGHT;
  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: working }}
      style={({ pressed }) => ({
        minHeight: height,
        minWidth: MIN_TOUCH,
        paddingHorizontal: variant === 'ghost' ? 12 : 20,
        paddingVertical: 8,
        borderRadius: radius.button,
        borderWidth: 1.5,
        borderColor: disabled ? (variant === 'ghost' ? 'transparent' : colors.border) : pressed ? p.pressedBorder : p.border,
        backgroundColor: disabled ? (variant === 'ghost' ? 'transparent' : colors.neutralBg) : pressed ? p.pressed : p.bg,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: full ? 'stretch' : 'flex-start',
      })}
    >
      {/* the label always stays laid out (invisible while loading) so the button keeps its width */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: working ? 0 : 1 }}>
        {icon ? <Icon name={icon} size={20} color={fg} /> : null}
        <Text variant="button" color={fg} align="center" numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </Text>
      </View>
      {working ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={fg} />
        </View>
      ) : null}
    </Pressable>
  );
}
