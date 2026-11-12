import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Card, ListRow, SectionHeader, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { isOfflineError, pipeError, useAppRounds } from '@/api/pipeline';
import { KIND_LABEL, sp, StudentRoundBadge } from '../kit';

/** Per-application round tracker: status of every round, rejection reason, and the next actions (book slot, mark attendance). */
export function RoundTracker({ appId, rejectionNote, closed }: { appId: string; rejectionNote?: string | null; closed: boolean }) {
  const router = useRouter();
  const q = useAppRounds(appId);
  const rounds = [...(q.data ?? [])].sort((a, b) => a.seq - b.seq);
  const canBook = !closed && rounds.some((r) => !r.waitlisted && ['pending', 'invited', 'attended', 'passed'].includes(r.status));
  const canScan = !closed && rounds.some((r) => !r.waitlisted && (r.status === 'invited' || r.status === 'attended'));

  let body: React.ReactNode;
  if (q.isLoading) body = <Skeleton height={120} radius={14} />;
  else if (q.isError) {
    body = (
      <Banner tone="warning" title="Could not load your rounds"
        message={isOfflineError(q.error) ? 'You appear to be offline. Reconnect and retry.' : pipeError(q.error)}
        action={{ label: 'Retry', onPress: () => { void q.refetch(); } }} />
    );
  } else if (rounds.length === 0) {
    body = <Text variant="body" color={colors.muted}>Rounds are not set up for this drive yet. When the placement cell adds them, your progress shows here.</Text>;
  } else {
    body = (
      <Card padding={0}>
        {rounds.map((r, i) => (
          <View key={r.roundId} style={{ padding: sp.lg, gap: sp.sm, borderBottomWidth: i === rounds.length - 1 && !(canBook || canScan) ? 0 : 1, borderBottomColor: colors.border }}>
            <Text variant="overline" color={colors.muted}>{`Round ${r.seq}`}</Text>
            <Text variant="subhead">{r.name}</Text>
            <Text variant="caption" color={colors.muted}>{KIND_LABEL[r.kind] ?? r.kind}</Text>
            <StudentRoundBadge status={r.status} />
            {r.waitlisted ? (
              <Text variant="caption" color={colors.textSecondary}>You are on the waitlist for this round. The placement cell will tell you if a place opens up.</Text>
            ) : null}
            {r.status === 'pending_results' ? (
              <Text variant="caption" color={colors.textSecondary}>Your result for this round has not been published yet. You will get a notification when it is.</Text>
            ) : null}
            {r.status === 'failed' && rejectionNote ? (
              <Text variant="caption" color={colors.textSecondary}>{`Note from the placement cell: ${rejectionNote}`}</Text>
            ) : null}
          </View>
        ))}
        {canBook ? (
          <View style={{ paddingHorizontal: sp.lg }}>
            <ListRow icon="event-available" title="Interview slots" subtitle="Book, change or cancel your slot" last={!canScan}
              onPress={() => router.push(`/(student)/application/${appId}/slots` as never)} />
          </View>
        ) : null}
        {canScan ? (
          <View style={{ paddingHorizontal: sp.lg }}>
            <ListRow icon="qr-code-scanner" title="Mark attendance" subtitle="Scan the QR shown at the venue" last
              onPress={() => router.push(`/(student)/attendance?applicationId=${appId}` as never)} />
          </View>
        ) : null}
      </Card>
    );
  }
  return (
    <View style={{ gap: sp.md }}>
      <SectionHeader title="Hiring rounds" />
      {body}
    </View>
  );
}
