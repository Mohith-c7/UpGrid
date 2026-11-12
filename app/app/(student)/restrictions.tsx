import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, EmptyState } from '@/ui';
import { Page, QueryBoundary, sp } from '@/features/student/me/kit';
import { RestrictionCard, useStudentRestrictions } from '@/features/studentExtras/restrictions';

/** Profile > Restrictions: active restrictions that apply to the student, with duration, appeal form and appeal status. */
export default function MyRestrictionsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/profile' as never)), [router]);
  const q = useStudentRestrictions();
  const list = useMemo(() => [...q.items].sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : 0)), [q.items, id]);

  return (
    <Page title="My restrictions" onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} gap={sp.lg}>
      {!q.enabled ? (
        <EmptyState icon="gpp-good" title="Nothing to show" message="Restrictions are not in use at your placement cell." />
      ) : (
        <QueryBoundary
          isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}
          isEmpty={list.length === 0}
          empty={{ title: 'No restrictions', message: 'You can apply to every drive you are eligible for.' }}
          skeletonRows={2} skeletonHeight={180}
        >
          <View style={{ gap: sp.lg }}>
            <Banner tone="info" message="These limit which drives you can apply to. They are decided by your placement cell. You can appeal once at a time." />
            {list.map((r) => <RestrictionCard key={r.id} r={r} highlight={r.id === id} />)}
          </View>
        </QueryBoundary>
      )}
    </Page>
  );
}
