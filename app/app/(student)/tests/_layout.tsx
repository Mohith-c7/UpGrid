import React from 'react';
import { Stack } from 'expo-router';

/** Student tests stack. The runner disables swipe-back so a stray gesture cannot leave the test; no slide animations. */
export default function TestsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="attempt/[attemptId]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
