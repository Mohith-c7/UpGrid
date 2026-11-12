import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { EmptyState, ErrorState, Screen, Skeleton } from '@/ui';
import { useFeatures } from '@/config/features';

/** Everything under /assessments is gated on the server feature flag `assessments` (GET /config). */
export default function AssessmentsLayout() {
  const { flags, status, refetch } = useFeatures();
  const isLoading = status === 'loading';
  const isError = status === 'fallback';
  if (isLoading) {
    return (
      <Screen padded><View style={{ gap: 12 }}><Skeleton height={56} /><Skeleton height={120} radius={14} /><Skeleton height={120} radius={14} /></View></Screen>
    );
  }
  if (isError) return <Screen padded><ErrorState message="Could not check whether tests are available. Check your connection and retry." onRetry={() => void refetch()} /></Screen>;
  if (flags.assessments !== true) {
    return <Screen padded><EmptyState icon="quiz" title="Tests are not enabled" message="Online tests are switched off for this server. Ask your administrator to enable the assessments module." /></Screen>;
  }
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150 }} />;
}
