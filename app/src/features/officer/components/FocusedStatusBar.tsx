import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';

/**
 * Status bar for the screen that is on top. Tab screens stay mounted when blurred, and a teal hero (light icons)
 * elsewhere would otherwise leave white icons on a white header. Only the focused screen renders it, so it always wins.
 */
export function FocusedStatusBar({ style = 'dark' }: { style?: 'dark' | 'light' }) {
  const focused = useIsFocused();
  return focused ? <StatusBar style={style} /> : null;
}
