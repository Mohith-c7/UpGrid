import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Card, Chip, ListRow, MetricRow, ProgressBar, SectionHeader, Text } from '@/ui';
import { colors } from '@/theme';
import { useFunnel, useRounds } from '@/api/pipeline';
import { STATUS_LABEL } from '@/features/officer/format';
import { Boundary, KIND_LABEL, Page, sp } from '@/features/pipeline/kit';

const OFFER_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval', issued: 'Issued', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', revoked: 'Revoked', rejected: 'Not issued', joined: 'Joined',
};

export default function PipelineHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const funnel = useFunnel(driveId);
  const rounds = useRounds(driveId);
  const go = (p: string) => router.push(`/(officer)/drive/${driveId}/${p}` as never);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}` as never));
  const f = funnel.data;
  const pendingOffers = f?.offers?.pending_approval ?? 0;

  return (
    <Page title="Hiring pipeline" onBack={back} onRefresh={() => { void funnel.refetch(); void rounds.refetch(); }} refreshing={funnel.isRefetching}>
      <Card padding={0}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <ListRow icon="format-list-numbered" title="Rounds" subtitle={rounds.data ? `${rounds.data.length} round${rounds.data.length === 1 ? '' : 's'}. Add, order, publish results` : 'Add, order, publish results'} onPress={() => go('rounds')} />
          <ListRow icon="groups" title="Recruiters" subtitle="Invite, set permissions, revoke" onPress={() => go('recruiters')} />
          <ListRow icon="event" title="Interview slots" subtitle="Create slots, approve proposals" onPress={() => go('slots')} />
          <ListRow icon="local-offer" title="Offers" subtitle="Approve, policy check, revoke, mark joined"
            right={pendingOffers > 0 ? <Badge label={`${pendingOffers} to approve`} tone="warning" icon="hourglass-empty" /> : undefined} onPress={() => go('offers')} />
          <ListRow icon="fact-check" title="Outcome proposals" subtitle="Select or reject proposals from recruiters" onPress={() => go('outcomes')} />
          <ListRow icon="rule" title="Scoring rubric" subtitle="What interviewers rate, 1 to 5" last onPress={() => go('rubric')} />
        </View>
      </Card>

      <SectionHeader title="Funnel" subtitle="Live counts for this drive" />
      <Boundary isLoading={funnel.isLoading} isError={funnel.isError} error={funnel.error} onRetry={() => { void funnel.refetch(); }} rows={3} height={110}
        isEmpty={!f || f.applications.total === 0} empty={{ icon: 'filter-alt', title: 'No candidates yet', message: 'The funnel fills in once students apply and rounds start.' }}>
        {f ? (
          <>
            <Card padding={0} style={{ paddingHorizontal: sp.lg }}>
              <MetricRow label="Applications" value={f.applications.total} last={Object.values(f.applications.byStatus ?? {}).every((n) => !n)} />
              {Object.entries(f.applications.byStatus ?? {}).filter(([, n]) => n > 0).map(([s, n], i, arr) => (
                <MetricRow key={s} label={STATUS_LABEL[s] ?? s} value={n} last={i === arr.length - 1} />
              ))}
            </Card>

            {f.rounds.map((r) => (
              <Card key={r.roundId}>
                <View style={{ gap: sp.sm }}>
                  <Text variant="overline" color={colors.muted}>{`Round ${r.seq}`}</Text>
                  <Text variant="subhead">{r.name}</Text>
                  <Text variant="caption" color={colors.muted}>{KIND_LABEL[r.kind] ?? r.kind}</Text>
                  <ProgressBar value={r.total ? r.passed / r.total : 0} label={`${r.passed} of ${r.total} passed`} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    <Chip label={`Pending ${r.pending}`} />
                    <Chip label={`Invited ${r.invited}`} />
                    <Chip label={`Attended ${r.attended}`} />
                    <Chip label={`Absent ${r.absent}`} />
                    <Chip label={`Passed ${r.passed}`} />
                    <Chip label={`Not passed ${r.failed}`} />
                    <Chip label={`On hold ${r.onHold}`} />
                    <Chip label={`Waitlisted ${r.waitlisted}`} />
                  </View>
                </View>
              </Card>
            ))}

            <Card padding={0} style={{ paddingHorizontal: sp.lg }}>
              <MetricRow label="Shortlisted by recruiters" value={f.decisions?.shortlisted ?? 0} />
              <MetricRow label="Rejected by recruiters" value={f.decisions?.rejected ?? 0} />
              <MetricRow label="Held by recruiters" value={f.decisions?.on_hold ?? 0} last />
            </Card>
            <Card padding={0} style={{ paddingHorizontal: sp.lg }}>
              {Object.entries(f.offers ?? {}).map(([k, n], i, arr) => (
                <MetricRow key={k} label={`Offers: ${OFFER_LABEL[k] ?? k}`} value={n} tone={k === 'pending_approval' && n > 0 ? 'warning' : undefined} last={i === arr.length - 1} />
              ))}
            </Card>
          </>
        ) : null}
      </Boundary>
    </Page>
  );
}
