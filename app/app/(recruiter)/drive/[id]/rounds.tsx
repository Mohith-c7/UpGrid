import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Card, EmptyState, ErrorState, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useRounds } from '@/api/recruiter';
import { formatDateTimeIST } from '@/lib/format';
import { Page, ROUND_KIND_LABEL, SkeletonList, useBack } from '@/features/recruiter/kit';

export default function RoundsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const back = useBack(`/(recruiter)/drive/${id}`);
  const q = useRounds(id);

  return (
    <Page title="Rounds" subtitle="Attendance and results" onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isLoading ? <SkeletonList rows={3} height={110} /> : null}
      {q.isError ? <ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon="timeline" title="No rounds yet" message="The placement cell sets up the rounds for this drive." actionLabel="Refresh" onAction={() => void q.refetch()} /> : null}
      {q.data?.map((r) => (
        <Card key={r.id} onPress={() => router.push(`/(recruiter)/drive/${id}/round/${r.id}` as never)} accessibilityLabel={`Round ${r.seq}, ${r.name}`} style={{ gap: 8 }}>
          <Text variant="subhead">{r.seq}. {r.name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Badge label={ROUND_KIND_LABEL[r.kind] ?? r.kind} tone="neutral" />
            {r.mode ? <Badge label={r.mode === 'online' ? 'Online' : 'In person'} tone="neutral" /> : null}
            {r.resultsPublishedAt ? <Badge label="Results published" tone="success" icon="check" /> : null}
          </View>
          {r.scheduledAt ? <Text variant="caption" color={colors.muted} tabular>{formatDateTimeIST(r.scheduledAt)}</Text> : null}
          {r.counts ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
              {Object.entries(r.counts).filter(([, n]) => typeof n === 'number').map(([k, n]) => (
                <Text key={k} variant="caption" color={colors.muted} tabular><Text variant="caption" tabular style={{ fontWeight: '700' }}>{n}</Text> {k.replace(/_/g, ' ')}</Text>
              ))}
            </View>
          ) : null}
        </Card>
      ))}
    </Page>
  );
}
