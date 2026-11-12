import React from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '@/theme';

/** One icon family app-wide: MaterialIcons, outline variants where they exist ("-outline", "-border"), sizes 20 or 24. */
export type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export function Icon({ name, size = 24, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <MaterialIcons name={name} size={size} color={color} accessible={false} importantForAccessibility="no" />;
}
