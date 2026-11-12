import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Banner, Button, Card, KeyValueList, SectionHeader, Skeleton, Text, useToast, type KeyValueItem } from '@/ui';
import { colors, type Tone } from '@/theme';
import { useRespondToOffer } from '@/api/hooks';
import { isOfflineError, pipeCode, pipeError, useAppOffer } from '@/api/pipeline';
import type { Offer, OfferStatus } from '@/api/pipelineTypes';
import { formatDateIST, formatInr, formatLpa } from '@/lib/format';
import { confirm, ExpiryText, formatIST, sp, useOnce, useRemainingMs } from '../kit';

const STATUS: Record<OfferStatus, { label: string; tone: Tone }> = {
  pending_approval: { label: 'Awaiting approval', tone: 'warning' }, rejected: { label: 'Not issued', tone: 'neutral' }, issued: { label: 'Offer received', tone: 'success' },
  accepted: { label: 'You accepted', tone: 'success' }, declined: { label: 'You declined', tone: 'neutral' }, expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Withdrawn by placement cell', tone: 'error' }, joined: { label: 'Joined', tone: 'success' },
};

export function offerItems(o: Offer): KeyValueItem[] {
  const stipend = o.kind === 'stipend_monthly';
  const money = (n?: number | null) => (n == null ? null : stipend ? `${formatInr(n)} / month` : formatLpa(n));
  const c = o.ctc ?? ({} as Offer['ctc']);
  const total = c.totalLpa ?? ((c.fixedLpa ?? 0) + (c.variableLpa ?? 0) + (c.bonusLpa ?? 0));
  const items: KeyValueItem[] = [{ label: stipend ? 'Stipend' : 'Fixed pay', value: money(c.fixedLpa) }];
  if (c.variableLpa) items.push({ label: 'Variable pay', value: money(c.variableLpa) });
  if (c.bonusLpa) items.push({ label: 'Bonus', value: money(c.bonusLpa) });
  if (c.joiningBonusLpa) items.push({ label: 'Joining bonus', value: money(c.joiningBonusLpa) });
  if (c.esopNote) items.push({ label: 'ESOP', value: c.esopNote });
  for (const x of c.other ?? []) items.push({ label: x.label, value: money(x.amountLpa) });
  if (!stipend) items.push({ label: 'Total', value: money(total) });
  if (o.joiningDate) items.push({ label: 'Joining date', value: formatDateIST(o.joiningDate) });
  if (o.location) items.push({ label: 'Location', value: o.location });
  return items;
}

/** Offer details + accept/decline. Accept/decline go through POST /applications/:id/respond after a confirm dialog. Returns null when there is no issued offer. */
export function OfferCard({ appId, company }: { appId: string; company: string }) {
  const q = useAppOffer(appId);
  const respond = useRespondToOffer();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const o = q.data ?? null;
  const rem = useRemainingMs(o?.status === 'issued' ? o.expiresAt : null);
  const lapsed = rem !== null && rem <= 0;

  const [send, sending] = useOnce(async (decision: 'accept' | 'decline') => {
    setError(null);
    try {
      await respond.mutateAsync({ id: appId, decision });
      toast.show(decision === 'accept' ? 'Your acceptance has been recorded.' : 'Your decision to decline has been recorded.', 'success');
      void q.refetch();
    } catch (e) {
      const code = pipeCode(e);
      setError(pipeError(e));
      if (code === 'OFFER_EXPIRED' || code === 'OFFER_ALREADY_DECIDED' || code === 'NO_OFFER_TO_RESPOND_TO') void q.refetch();
    }
  });
  const ask = (decision: 'accept' | 'decline') =>
    confirm(
      decision === 'accept' ? 'Accept this offer?' : 'Decline this offer?',
      decision === 'accept'
        ? `You are accepting the offer from ${company}. The placement cell is told and will share joining steps. You cannot change this in the app afterwards.`
        : `You are declining the offer from ${company}. The placement cell is told. You cannot change this in the app afterwards.`,
      decision === 'accept' ? 'Accept offer' : 'Decline offer',
      () => { void send(decision); },
      decision === 'decline',
    );

  if (q.isLoading) return <Skeleton height={220} radius={14} />;
  if (q.isError) {
    return (
      <Banner tone="warning" title="Could not load offer details"
        message={isOfflineError(q.error) ? 'You appear to be offline. Reconnect and retry.' : pipeError(q.error)}
        action={{ label: 'Retry', onPress: () => { void q.refetch(); } }} />
    );
  }
  if (!o) return null;
  const st = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as Tone };
  const canAnswer = o.status === 'issued' && o.canRespond !== false && !lapsed;

  return (
    <View style={{ gap: sp.md }}>
      <SectionHeader title="Your offer" />
      <Card tinted={canAnswer}>
        <View style={{ gap: sp.md }}>
          <Badge label={st.label} tone={st.tone} />
          <KeyValueList inline items={offerItems(o)} />
          {o.status === 'issued' && o.expiresAt ? (
            <View style={{ gap: 2 }}>
              <Text variant="caption" color={colors.muted}>{`Respond before ${formatIST(o.expiresAt)}`}</Text>
              <ExpiryText iso={o.expiresAt} />
            </View>
          ) : null}
          {o.notes ? <Text variant="body" color={colors.textSecondary}>{o.notes}</Text> : null}
          {o.letter?.url ? (
            <Button label="Open offer letter" variant="secondary" icon="description" full
              onPress={() => { Linking.openURL(o.letter!.url!).catch(() => toast.show('Could not open the letter', 'error')); }} />
          ) : null}
          {o.status === 'issued' && lapsed ? <Banner tone="warning" message="The response window for this offer has closed. Contact the placement cell if you need help." /> : null}
          {o.status === 'revoked' && o.revokedReason ? <Banner tone="error" message={`Reason: ${o.revokedReason}`} /> : null}
          {o.respondedAt ? <Text variant="caption" color={colors.muted}>{`Responded ${formatIST(o.respondedAt)}`}</Text> : null}
          {error ? <Banner tone="error" message={error} /> : null}
          {canAnswer ? (
            <View style={{ gap: sp.sm }}>
              <Button label="Accept offer" icon="check" full loading={sending} onPress={() => ask('accept')} />
              <Button label="Decline offer" variant="secondary" full disabled={sending} onPress={() => ask('decline')} />
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  );
}
