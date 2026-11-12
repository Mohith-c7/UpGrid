/** Presentational blocks used only by the student discover/apply screens. Drive lists use `DriveCard` and alerts use `Banner` from `@/ui`. */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon, Text } from '@/ui';
import { colors, MIN_TOUCH, spacing } from '@/theme';

/* ------------------------------------------------------------ layout */
export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading" accessibilityRole="header">{title}</Text>
        {hint ? <Text variant="caption" color={colors.muted}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((t, i) => (
        <View key={`${i}-${t}`} style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: colors.primary, marginTop: 8 }} />
          <Text variant="body" style={{ flex: 1, minWidth: 0 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** Label left, value right; wraps instead of clipping at large font sizes. */
export function KeyValue({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <Text variant="caption" color={colors.muted} style={{ flexShrink: 1 }}>{label}</Text>
      <Text variant="body" tabular={tabular} style={{ flexShrink: 1, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

/* ----------------------------------------------------- check / radio */
export function CheckRow({
  checked, label, onToggle, radio, error, disabled, helper,
}: { checked: boolean; label: string; onToggle: () => void; radio?: boolean; error?: string | null; disabled?: boolean; helper?: string }) {
  const icon = radio
    ? (checked ? 'radio-button-checked' : 'radio-button-unchecked')
    : (checked ? 'check-box' : 'check-box-outline-blank');
  return (
    <View>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole={radio ? 'radio' : 'checkbox'}
        accessibilityState={{ checked, disabled: !!disabled }}
        accessibilityLabel={helper ? `${label}. ${helper}` : label}
        style={({ pressed }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? colors.pressed : 'transparent' })}
      >
        <Icon name={icon} size={24} color={checked ? colors.primary : error ? colors.error : colors.muted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body">{label}</Text>
          {helper ? <Text variant="caption" color={colors.muted}>{helper}</Text> : null}
        </View>
      </Pressable>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityRole="alert">
          <Icon name="error-outline" size={16} color={colors.error} />
          <Text variant="caption" color={colors.error} style={{ flex: 1 }}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
