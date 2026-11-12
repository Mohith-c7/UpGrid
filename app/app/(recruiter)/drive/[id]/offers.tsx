import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, SectionHeader, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { flatten } from '@/api/hooks';
import { useCandidates, useOffers, useRecruiterDrive } from '@/api/recruiter';
import { formatDateIST, formatDateTimeIST, groupIndian } from '@/lib/format';
import { can, OFFER_META, Page, SkeletonList, useBack } from '@/features/recruiter/kit';
import { offerTotal, PolicyBadge, PolicyReasons } from '@/features/recruiter/OfferParts';

export default function OffersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const back = useBack(`/(recruiter)/drive/${id}`);
  const drive = useRecruiterDrive(id);
  const offers = useOffers(id);
  const selected = useCandidates(id, { status: 'selected' });
  const canPropose = can(drive.data?.permissions, 'proposeOffers');
  const ready = useMemo(() => flatten(selected.data).filter((c) => !c.hasOffer), [selected.data]);

  return (
    <Page title="Offers" onBack={back} onRefresh={() => { void offers.refetch(); void selected.refetch(); }} refreshing={offers.isRefetching}>
      <Banner tone="info" message="Offers you propose are reviewed by the placement cell against the placement policy. The student sees an offer only after it is issued." />

      {canPropose && ready.length ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Ready for an offer" subtitle="Selected candidates without an offer" />
          {ready.map((c) => (
            <Card key={c.applicationId} style={{ gap: 8 }}>
              <Text variant="subhead">{c.candidate.name ?? c.reference}</Text>
              <Text variant="caption" color={colors.muted}>{c.reference}</Text>
              <View style={{ flexDirection: 'row' }}>
                <Button size="sm" label="Propose offer" icon="request-quote" onPress={() => router.push(`/(recruiter)/drive/${id}/offer-new?applicationId=${c.applicationId}` as never)} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Proposed and issued" />
        {offers.isLoading ? <SkeletonList rows={2} height={140} /> : null}
        {offers.isError ? <ErrorState message={errMessage(offers.error)} onRetry={() => void offers.refetch()} /> : null}
        {offers.data && !offers.data.length ? <EmptyState icon="request-quote" title="No offers yet" message={canPropose ? 'Once a candidate is selected you can propose an offer from here or from their page.' : 'No offers have been proposed for this drive.'} /> : null}
        {offers.data?.map((o) => {
          const m = OFFER_META[o.status] ?? { label: o.status, tone: 'neutral' as const };
          return (
            <Card key={o.id} onPress={() => router.push(`/(recruiter)/drive/${id}/candidate/${o.applicationId}` as never)} accessibilityLabel={`Offer for ${o.candidate?.name ?? 'candidate'}, ${m.label}`} style={{ gap: 8 }}>
              <Text variant="subhead">{o.candidate?.name ?? 'Candidate'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Badge label={m.label} tone={m.tone} />
                {o.policy ? <PolicyBadge result={o.policy.result} /> : null}
                {o.tier && o.tier !== 'regular' ? <Badge label={o.tier === 'super_dream' ? 'Super dream' : 'Dream'} tone="info" /> : null}
              </View>
              <Text variant="body" tabular style={{ fontWeight: '600' }}>{o.kind === 'stipend_monthly' ? `${groupIndian(Math.round(offerTotal(o)))} per month` : `${offerTotal(o).toFixed(2)} LPA`}</Text>
              <Text variant="caption" color={colors.muted} tabular>
                {[o.location, o.joiningDate ? `Joining ${formatDateIST(o.joiningDate)}` : null, o.expiresAt ? `Expires ${formatDateTimeIST(o.expiresAt)}` : null].filter(Boolean).join('  |  ')}
              </Text>
              {o.policy && o.policy.result !== 'allowed' ? <PolicyReasons policy={o.policy} /> : null}
              {o.rejectedReason ? <Text variant="caption" color={colors.error}>Rejected: {o.rejectedReason}</Text> : null}
              {o.revokedReason ? <Text variant="caption" color={colors.error}>Revoked: {o.revokedReason}</Text> : null}
            </Card>
          );
        })}
      </View>
    </Page>
  );
}
