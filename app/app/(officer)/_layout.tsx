import { Stack } from 'expo-router';
import { useSession } from '@/state/session';

export default function OfficerLayout() {
  const s = useSession();
  // Defence in depth next to the root Gate: never mount officer screens (and their queries) for another role or a signed-out user.
  if (s.status !== 'signedIn' || s.role !== 'officer') return null;
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150 }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="drive/new" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
