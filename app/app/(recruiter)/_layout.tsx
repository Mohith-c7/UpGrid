import React from 'react';
import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { Banner, Button, EmptyState, ErrorState, Screen, Skeleton } from '@/ui';
import { useSession } from '@/state/session';
import { useAuth } from '@/api/hooks';
import { useFeatures } from '@/config/features';

/**
 * Recruiter area. Guards (in addition to the root route guard):
 *  - only role 'recruiter' may render anything here;
 *  - the whole area is behind the server feature flag `recruiter` (GET /config).
 */
export default function RecruiterLayout() {
  const s = useSession();
  const { logout } = useAuth();
  const { flags, status, refetch } = useFeatures();

  if (s.status === 'loading') return null;
  if (s.status === 'signedOut') return <Redirect href="/(auth)/welcome" />;
  if (s.role !== 'recruiter') return <Redirect href="/" />;

  if (status === 'loading')
    return (
      <Screen padded>
        <View style={{ gap: 12 }}><Skeleton height={56} radius={12} /><Skeleton height={120} radius={14} /><Skeleton height={120} radius={14} /></View>
      </Screen>
    );
  if (status === 'fallback' && flags.recruiter !== true)
    return (
      <Screen padded>
        <ErrorState title="Could not check app settings" message="Connect to the internet to open recruiter tools." onRetry={() => void refetch()} />
        <Button label="Sign out" variant="ghost" full onPress={logout} />
      </Screen>
    );
  if (flags.recruiter !== true)
    return (
      <Screen padded>
        <EmptyState icon="lock-outline" title="Recruiter tools are not enabled" message="Your placement office has not turned on recruiter access for this app yet." />
        <View style={{ gap: 12 }}>
          <Banner tone="info" message="Ask the placement cell to enable it, then open the app again." />
          <Button label="Sign out" variant="secondary" full onPress={logout} />
        </View>
      </Screen>
    );

  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150 }} />;
}
