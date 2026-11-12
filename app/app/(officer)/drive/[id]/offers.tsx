import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, KeyValueList, SegmentedTabs, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { flattenPages, pipeError, useOfferActions, useOffers } from '@/api/pipeline';
import type { Offer, OfferStatus } from '@/api/pipelineTypes';
import { getServerOffsetMs } from '@/api/client';
import { nowISTParts, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, useISTPicker } from '@/features/officer/components/pickers';
import { offerItems } from '@/features/pipeline/student/OfferCard';
import { Boundary, confirm, ExpiryText, formatIST, LoadMore, Page, ReasonSheet, sp, useOnce } from '@/features/pipeline/kit';
import { OfferForm } from '@/features/pipeline/officer/OfferForm';
import { PolicyBanner } from '@/features/pipeline/officer/PolicyBanner';

const TABS = [{ value: 'pending_approval', label: 'To approve' }, { value: 'issued', label: 'Issued' }, { value: 'accepted', label: 'Accepted' }, { value: 'joined', label: 'Joined' }, { value: 'all', label: 'All' }];
const TONE: Record<OfferStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  pending_approval: 'warning', rejected: 'neutral', issued: 'info', accepted: 'success', declined: 'neutral', expired: 'neutral', revoked: 'error', joined: 'success',
};
const LABEL: Record<OfferStatus, string> = {
  pending_approval: 'Awaiting approval', rejected: 'Rejected', issued: 'Issued', accepted: 'Accepted by student', declined: 'Declined by student', expired: 'Expired', revoked: 'Revoked', joined: 'Joined',
};
const pad = (n: number) => String(n).padStart(2, '0');

export default function OffersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState('pending_approval');
  const q = useOffers(driveId, tab === 'all' ? undefined : tab);
  const act = useOfferActions(driveId);
  const items = flattenPages(q.data?.pages);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<Offer | null>(null);
  const [override, setOverride] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Offer | null>(null);
  const [revoking, setRevoking] = useState<Offer | null>(null);
  const [joining, setJoining] = useState<Offer | null>(null);
  const [joinDate, setJoinDate] = useState<ISTParts>(() => nowISTParts(getServerOffsetMs()));
  const [joinError, setJoinError] = useState<string | null>(null);
  const picker = useISTPicker(joinDate, setJoinDate, { allowPast: true });
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));

  const openApprove = (o: Offer) => { setApproving(o); setOverride(''); setApproveError(null); };
  const [doApprove, approveBusy] = useOnce(async () => {
    if (!approving) return;
    const needs = approving.policy?.result === 'needs_override';
    const r = override.trim();
    if (needs && (r.length < 10 || r.length > 300)) { setApproveError('Enter an override reason of 10 to 300 characters.'); return; }
    setApproveError(null);
    try { await act.approve.mutateAsync({ id: approving.id, overrideReason: needs ? r : undefined }); toast.show('Offer approved and issued to the student', 'success'); setApproving(null); }
    catch (e) { setApproveError(pipeError(e)); }
  });
  const [doJoined, joinBusy] = useOnce(async () => {
    if (!joining) return;
    setJoinError(null);
    try { await act.joined.mutateAsync({ id: joining.id, joinedOn: `${joinDate.y}-${pad(joinDate.m)}-${pad(joinDate.d)}` }); toast.show('Marked as joined', 'success'); setJoining(null); }
    catch (e) { setJoinError(pipeError(e)); }
  });

  return (
    <Page title="Offers" onBack={back} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={<Button label="New offer" icon="add" full onPress={() => setCreating(true)} />}>
      <SegmentedTabs value={tab} onChange={setTab} options={TABS} />
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={170}
        isEmpty={items.length === 0} empty={{ icon: 'local-offer', title: tab === 'pending_approval' ? 'No offers to approve' : 'No offers here', message: tab === 'pending_approval' ? 'Offers proposed by recruiters wait here for your approval.' : 'Offers in this state show up here.' }}>
        {items.map((o) => (
          <Card key={o.id}>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">{o.candidate?.name ?? 'Candidate'}</Text>
              {o.candidate?.applicationReference ? <Text variant="caption" color={colors.muted} tabular>{o.candidate.applicationReference}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Badge label={LABEL[o.status] ?? o.status} tone={TONE[o.status] ?? 'neutral'} />
                {o.tier ? <Badge label={o.tier === 'super_dream' ? 'Super dream' : o.tier === 'dream' ? 'Dream' : 'Regular'} tone="info" icon="workspace-premium" /> : null}
              </View>
              <KeyValueList inline items={offerItems(o)} />
              {o.proposedBy ? <Text variant="caption" color={colors.muted}>{`Proposed by ${o.proposedBy.name}`}</Text> : null}
              {o.status === 'issued' && o.expiresAt ? (<View><Text variant="caption" color={colors.muted}>{`Valid until ${formatIST(o.expiresAt)}`}</Text><ExpiryText iso={o.expiresAt} /></View>) : null}
              {o.revokedReason ? <Text variant="caption" color={colors.textSecondary}>{`Revoked: ${o.revokedReason}`}</Text> : null}
              {o.rejectedReason ? <Text variant="caption" color={colors.textSecondary}>{`Rejected: ${o.rejectedReason}`}</Text> : null}
              {o.status === 'pending_approval' && o.policy ? <PolicyBanner policy={o.policy} tier={o.tier} /> : null}
              {o.status === 'pending_approval' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  <Button label="Approve" icon="check" size="sm" disabled={o.policy?.result === 'blocked'} onPress={() => openApprove(o)} />
                  <Button label="Reject" icon="close" size="sm" variant="secondary" onPress={() => setRejecting(o)} />
                </View>
              ) : null}
              {o.status === 'issued' ? <Button label="Revoke offer" icon="block" size="sm" variant="danger" onPress={() => setRevoking(o)} /> : null}
              {o.status === 'accepted' ? <Button label="Mark joined" icon="work-outline" size="sm" onPress={() => { setJoining(o); setJoinDate(nowISTParts(getServerOffsetMs())); setJoinError(null); }} /> : null}
            </View>
          </Card>
        ))}
        <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} failed={q.isFetchNextPageError} onMore={() => { void q.fetchNextPage(); }} />
      </Boundary>

      <OfferForm driveId={driveId} visible={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setTab('issued'); toast.show('Offer issued to the student', 'success'); }} />

      <Sheet visible={!!approving} onClose={() => { if (!approveBusy) setApproving(null); }} title="Approve this offer?">
        {approving ? (
          <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
            <Text variant="body" color={colors.textSecondary}>{`${approving.candidate?.name ?? 'The candidate'} sees the offer as soon as you approve. Policy is checked again at approval.`}</Text>
            {approving.policy ? <PolicyBanner policy={approving.policy} tier={approving.tier} /> : null}
            {approving.policy?.result === 'needs_override' ? (
              <TextField label="Override reason" value={override} onChangeText={(t) => { setOverride(t); setApproveError(null); }} multiline maxLength={300} helper="10 to 300 characters. Recorded in the audit log." />
            ) : null}
            {approveError ? <Banner tone="error" message={approveError} /> : null}
            <Button label="Approve and issue" full loading={approveBusy} onPress={() => confirm('Issue this offer?', 'The student is notified and the response clock starts.', 'Issue offer', () => { void doApprove(); }, false)} />
            <Button label="Go back" variant="ghost" full disabled={approveBusy} onPress={() => setApproving(null)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!joining} onClose={() => { if (!joinBusy) setJoining(null); }} title="Mark as joined">
        <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
          <Text variant="body" color={colors.textSecondary}>{`Confirm that ${joining?.candidate?.name ?? 'the candidate'} has joined. Their application moves to Joined.`}</Text>
          <PickerRow label="Joined on (IST)" icon="event" value={dateLabel(joinDate)} onPress={() => picker.open('date')} />
          {picker.iosPicker}
          {joinError ? <Banner tone="error" message={joinError} /> : null}
          <Button label="Mark joined" full loading={joinBusy} onPress={() => doJoined()} />
          <Button label="Go back" variant="ghost" full disabled={joinBusy} onPress={() => setJoining(null)} />
        </View>
      </Sheet>

      <ReasonSheet visible={!!rejecting} onClose={() => setRejecting(null)} title="Reject this proposal?" description="The recruiter who proposed it is told why. The student never sees it." label="Reason" confirmLabel="Reject offer" maxLength={300}
        onSubmit={async (reason) => { await act.reject.mutateAsync({ id: rejecting!.id, reason }); toast.show('Offer rejected', 'success'); setRejecting(null); }} />
      <ReasonSheet visible={!!revoking} onClose={() => setRevoking(null)} title="Revoke this offer?"
        description="The student is told. Their application moves to Offer declined, because there is no other exit from an issued offer. This cannot be undone." label="Reason" confirmLabel="Revoke offer" maxLength={300}
        onSubmit={async (reason) => { await act.revoke.mutateAsync({ id: revoking!.id, reason }); toast.show('Offer revoked', 'success'); setRevoking(null); }} />
    </Page>
  );
}
