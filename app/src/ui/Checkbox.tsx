import React from 'react';
import { Pressable, View } from 'react-native';
import { colors, MIN_TOUCH, radius } from '@/theme';
import { Text } from './Text';
import { Icon } from './Icon';

/** Flat checkbox row. `children` is the label (may contain nested pressable text). Min 48dp touch target. */
export function Checkbox({
  checked, onChange, children, error, accessibilityLabel,
}: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; error?: string | null; accessibilityLabel?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH }}>
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={accessibilityLabel}
          hitSlop={4}
          style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -12 }}
        >
          <View
            style={{
              width: 24, height: 24, borderRadius: radius.chip - 4, borderWidth: 2,
              borderColor: error ? colors.error : checked ? colors.primary : colors.muted,
              backgroundColor: checked ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center',
            }}
          >
            {checked ? <Icon name="check" size={18} color={colors.onPrimary} /> : null}
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
      {error ? <Text variant="meta" color={colors.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
