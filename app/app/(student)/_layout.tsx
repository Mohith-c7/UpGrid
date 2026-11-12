import React from 'react';
import { Stack } from 'expo-router';
import { useSession } from '@/state/session';

export default function StudentLayout() {
  const s = useSession();
  // Defence in depth next to the root Gate: never mount student screens (and their queries) for another role or a signed-out user.
  if (s.status !== 'signedIn' || s.role !== 'student') return null;
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="apply/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
