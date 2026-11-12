import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, SegmentedTabs, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { flattenPages, pipeError, useDecideOutcome, useOutcomes } from '@/api/pipeline';
import type { Outcome } from '@/api/pipelineTypes';
import { Boundary, confirm, formatIST, LoadMore, Page, ReasonSheet, sp, useOnce } from '@/features/pipeline/kit';

const TABS = [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'declined', label: 'Declined' }];

export default function OutcomesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const q = useOutcomes(driveId, tab);
  const decide = useDecideOutcome();
  const items = flattenPages(q.data?.pages);
  const [declining, setDeclining] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));
  const nameOf = (o: Outcome) => o.candidate?.name ?? 'Candidate';

  const [approve] = useOnce(async (o: Outcome) => {
    setError(null);
    try {
      const r = await decide.mutateAsync({ id: o.id, decision: 'approve' });
      toast.show(r.replayed ? 'Already approved' : o.kind === 'select' ? 'Approved. The candidate is now selected.' : 'Approved. The application is closed.', 'success');
    } catch (e) { setError(pipeError(e)); void q.refetch(); }
  });
  const ask = (o: Outcome) =>
    confirm(
      o.kind === 'select' ? 'Approve selection?' : 'Approve rejection?',
      o.kind === 'select'
        ? `${nameOf(o)} moves to Selected and is notified.`
        : `${nameOf(o)}'s application is marked as Not selected and they are notified. This cannot be undone.`,
      'Approve', () => { void approve(o); }, o.kind === 'reject',
    );

  return (
    <Page title="Outcome proposals" onBack={back} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
      <SegmentedTabs value={tab} onChange={setTab} options={TABS} />
      {error ? <Banner tone="error" title="Could not complete that" message={error} /> : null}
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={140}
        isEmpty={items.length === 0} empty={{ icon: 'fact-check', title: tab === 'pending' ? 'Nothing waiting' : 'Nothing here', message: tab === 'pending' ? 'Select and reject proposals from recruiters appear here for your decision.' : 'Decided proposals show up here.' }}>
        {items.map((o) => (
          <Card key={o.id}>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">{nameOf(o)}</Text>
              {o.candidate?.applicationReference || o.candidate?.reference ? <Text variant="caption" color={colors.muted} tabular>{o.candidate?.applicationReference ?? o.candidate?.reference}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Badge label={o.kind === 'select' ? 'Proposed: select' : 'Proposed: reject'} tone={o.kind === 'select' ? 'success' : 'error'} icon={o.kind === 'select' ? 'emoji-events' : 'block'} />
                {o.status !== 'pending' ? <Badge label={o.status === 'approved' ? 'Approved' : 'Declined'} tone={o.status === 'approved' ? 'success' : 'neutral'} icon={o.status === 'approved' ? 'check-circle-outline' : 'cancel'} /> : null}
              </View>
              {o.reason ? <Text variant="body" color={colors.textSecondary}>{o.reason}</Text> : null}
              <Text variant="caption" color={colors.muted}>{`${o.proposedBy ? `By ${o.proposedBy.name}. ` : ''}${formatIST(o.createdAt)}`}</Text>
              {o.status !== 'pending' && o.decidedBy ? <Text variant="caption" color={colors.muted}>{`Decided by ${o.decidedBy.name}${o.decidedAt ? `, ${formatIST(o.decidedAt)}` : ''}${o.decisionNote ? `. ${o.decisionNote}` : ''}`}</Text> : null}
              {o.status === 'pending' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  <Button label="Approve" icon="check" size="sm" onPress={() => ask(o)} />
                  <Button label="Decline" icon="close" size="sm" variant="secondary" onPress={() => setDeclining(o)} />
                </View>
              ) : null}
            </View>
          </Card>
        ))}
        <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} failed={q.isFetchNextPageError} onMore={() => { void q.fetchNextPage(); }} />
      </Boundary>
      <ReasonSheet visible={!!declining} onClose={() => setDeclining(null)} title="Decline this proposal?" description="The application stays as it is. The recruiter sees your note." required={false} label="Note" confirmLabel="Decline proposal" danger={false}
        onSubmit={async (note) => { await decide.mutateAsync({ id: declining!.id, decision: 'decline', note: note || undefined }); toast.show('Proposal declined', 'success'); setDeclining(null); }} />
    </Page>
  );
}
