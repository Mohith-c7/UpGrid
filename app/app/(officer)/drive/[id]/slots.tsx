import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, SegmentedTabs, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { formatTimeIST } from '@/lib/format';
import { flattenPages, pipeError, useRounds, useSlotActions, useSlots } from '@/api/pipeline';
import type { Slot } from '@/api/pipelineTypes';
import { Boundary, formatIST, LoadMore, Page, ReasonSheet, sp, useOnce } from '@/features/pipeline/kit';
import { SlotForm } from '@/features/pipeline/officer/SlotForm';

const TABS = [{ value: 'proposed', label: 'To approve' }, { value: 'open', label: 'Open' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'declined', label: 'Declined' }];

export default function SlotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState('proposed');
  const q = useSlots(driveId, tab);
  const rounds = useRounds(driveId);
  const act = useSlotActions(driveId);
  const [creating, setCreating] = useState(false);
  const [declining, setDeclining] = useState<Slot | null>(null);
  const [cancelling, setCancelling] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = flattenPages(q.data?.pages);
  const roundName = (rid: string) => { const r = rounds.data?.find((x) => x.id === rid); return r ? `Round ${r.seq}: ${r.name}` : 'Round'; };
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));

  const [approve, approving] = useOnce(async (s: Slot) => {
    setError(null);
    try { await act.approve.mutateAsync(s.id); toast.show('Slot approved. It is now open for booking.', 'success'); }
    catch (e) { setError(pipeError(e)); }
  });
  const proposer = (s: Slot) => (typeof s.proposedBy === 'string' ? s.proposedBy : s.proposedBy?.name);

  return (
    <Page title="Interview slots" onBack={back} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={<Button label="Create a slot" icon="add" full disabled={(rounds.data ?? []).length === 0} onPress={() => setCreating(true)} />}>
      <SegmentedTabs value={tab} onChange={setTab} options={TABS} />
      {error ? <Banner tone="error" title="Could not complete that" message={error} /> : null}
      {(rounds.data ?? []).length === 0 && !rounds.isLoading ? <Banner tone="info" message="Add a round first. Slots belong to a round." /> : null}
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={150}
        isEmpty={items.length === 0} empty={{ icon: 'event-busy', title: tab === 'proposed' ? 'Nothing to approve' : 'No slots here', message: tab === 'proposed' ? 'Slots proposed by recruiters appear here for approval.' : 'Slots in this state will show up here.' }}>
        {items.map((s) => (
          <Card key={s.id}>
            <View style={{ gap: sp.sm }}>
              <Text variant="overline" color={colors.muted}>{roundName(s.roundId)}</Text>
              <Text variant="subhead" tabular>{formatIST(s.startsAt)}</Text>
              <Text variant="caption" color={colors.muted} tabular>{`Ends ${formatTimeIST(s.endsAt)} IST`}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Badge label={s.mode === 'online' ? 'Online' : 'In person'} tone="info" icon={s.mode === 'online' ? 'videocam' : 'place'} />
                <Badge label={`${s.booked} of ${s.capacity} booked`} tone={s.booked >= s.capacity ? 'warning' : 'neutral'} icon="event-seat" />
              </View>
              {s.venueOrLink ? <Text variant="body" color={colors.textSecondary}>{s.venueOrLink}</Text> : null}
              {s.panel?.length ? <Text variant="caption" color={colors.muted}>{`Panel: ${s.panel.map((p) => p.name).join(', ')}`}</Text> : null}
              {proposer(s) ? <Text variant="caption" color={colors.muted}>{`Proposed by ${proposer(s)}`}</Text> : null}
              {s.status === 'proposed' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  <Button label="Approve" icon="check" size="sm" loading={approving} onPress={() => approve(s)} />
                  <Button label="Decline" icon="close" size="sm" variant="danger" disabled={approving} onPress={() => setDeclining(s)} />
                </View>
              ) : null}
              {s.status === 'open' ? (
                <Button label="Cancel slot" icon="event-busy" size="sm" variant="danger" onPress={() => setCancelling(s)} />
              ) : null}
            </View>
          </Card>
        ))}
        <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} failed={q.isFetchNextPageError} onMore={() => { void q.fetchNextPage(); }} />
      </Boundary>

      <SlotForm driveId={driveId} rounds={[...(rounds.data ?? [])].sort((a, b) => a.seq - b.seq)} visible={creating} onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); setTab('open'); toast.show('Slot created and open for booking', 'success'); }} />
      <ReasonSheet visible={!!declining} onClose={() => setDeclining(null)} title="Decline this slot?" description="The person who proposed it is told why." label="Reason" confirmLabel="Decline slot"
        onSubmit={async (reason) => { await act.decline.mutateAsync({ id: declining!.id, reason }); toast.show('Slot declined', 'success'); setDeclining(null); }} />
      <ReasonSheet visible={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this slot?"
        description={cancelling && cancelling.booked > 0 ? `${cancelling.booked} student${cancelling.booked === 1 ? ' has' : 's have'} booked it. Their bookings are cancelled and they are notified.` : 'No students have booked it yet.'}
        label="Reason" confirmLabel="Cancel slot"
        onSubmit={async (reason) => { const r = await act.cancel.mutateAsync({ id: cancelling!.id, reason }); toast.show(`Slot cancelled. ${r.cancelledBookings} booking${r.cancelledBookings === 1 ? '' : 's'} cancelled.`, 'success'); setCancelling(null); }} />
    </Page>
  );
}
