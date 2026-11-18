import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamilyFor } from '@/theme';

/**
 * Shared bottom-tab styling: white bar, hairline top border, 24px icons (pass size 24 via Icon), indigo active tint, no animation.
 * Usage: <Tabs screenOptions={useTabScreenOptions()}> and render icons with <Icon name=".." size={24} color={color} />.
 */
type TabsOptions = Exclude<ComponentProps<typeof Tabs>['screenOptions'], Function | undefined>;

export function useTabScreenOptions(): TabsOptions {
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarAllowFontScaling: false,
    tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilyFor('500'), fontWeight: '500' },
    tabBarStyle: {
      height: 60 + insets.bottom,
      paddingTop: 6,
      paddingBottom: insets.bottom + 6,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      elevation: 0,
      shadowOpacity: 0,
    },
    tabBarItemStyle: { minHeight: 48 },
    tabBarBadgeStyle: { backgroundColor: colors.errorSolid, color: colors.onPrimary, fontSize: 11, fontWeight: '600' },
    animation: 'none',
  } as TabsOptions;
}
