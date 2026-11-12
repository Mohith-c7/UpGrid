import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Card, CompanyLogo, ErrorState, KeyValueList, ListRow, MetricRow, SectionHeader, Skeleton, StatTile, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useRecruiterDrive } from '@/api/recruiter';
import { formatCtc, formatDateTimeIST } from '@/lib/format';
import { driveSelection } from '@/features/recruiter/selection';
import { can, Page, ROUND_KIND_LABEL, SkeletonList, statusMeta } from '@/features/recruiter/kit';
import { useBack } from '@/features/recruiter/kit';

export default function RecruiterDriveDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const back = useBack();
  const q = useRecruiterDrive(id);
  const go = (path: string) => router.push(`/(recruiter)/drive/${id}/${path}` as never);

  if (q.isLoading) return <Page title="Drive" onBack={back}><SkeletonList rows={1} height={90} /><Skeleton height={80} radius={14} /><SkeletonList rows={3} height={64} /></Page>;
  if (q.isError || !q.data) return <Page title="Drive" onBack={back}><ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /></Page>;

  const { drive, permissions, funnel, rounds, settings } = q.data;
  const decisions = funnel.decisions;
  const offersTotal = Object.entries(funnel.offers ?? {}).reduce((n, [k, v]) => (k === 'rejected' || k === 'revoked' ? n : n + (v ?? 0)), 0);
  const inRounds = funnel.rounds.reduce((n, r) => n + r.total, 0);

  return (
    <Page title={drive.company.name} subtitle={drive.role} onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <CompanyLogo name={drive.company.name} logoUrl={drive.company.logoUrl} size={56} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="title">{drive.role}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Badge label={drive.status === 'closed' ? 'Closed' : 'Open'} tone={drive.status === 'closed' ? 'neutral' : 'success'} />
            {drive.company.verified ? <Badge label="Verified company" tone="info" icon="verified" /> : null}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><StatTile label="Candidates" value={funnel.applications.total} icon="people-outline" /></View>
        <View style={{ flex: 1 }}><StatTile label="Shortlisted" value={decisions.shortlisted} icon="check-circle" /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><StatTile label="In rounds" value={inRounds} icon="timeline" /></View>
        <View style={{ flex: 1 }}><StatTile label="Offers" value={offersTotal} icon="request-quote" /></View>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Funnel" subtitle="Counts of candidates you can see" />
        <Card padding={0}>
          <View style={{ paddingHorizontal: 16 }}>
            <MetricRow label="Shortlisted" value={decisions.shortlisted} />
            <MetricRow label="On hold" value={decisions.on_hold} />
            <MetricRow label="Rejected" value={decisions.rejected} />
            {Object.entries(funnel.applications.byStatus).filter(([, n]) => n > 0).map(([s, n]) => (
              <MetricRow key={s} label={`Status: ${statusMeta(s).label}`} value={n} />
            ))}
            <MetricRow label="Offers issued or accepted" value={(funnel.offers?.issued ?? 0) + (funnel.offers?.accepted ?? 0)} last />
          </View>
        </Card>
        {funnel.rounds.map((r) => (
          <Card key={r.roundId} style={{ gap: 8 }}>
            <Text variant="subhead">{r.seq}. {r.name}</Text>
            <Text variant="caption" color={colors.muted}>{ROUND_KIND_LABEL[r.kind] ?? r.kind}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
              {([['Invited', r.invited], ['Present', r.attended], ['Absent', r.absent], ['Passed', r.passed], ['Failed', r.failed], ['On hold', r.onHold], ['Waitlisted', r.waitlisted]] as const).map(([l, n]) => (
                <Text key={l} variant="caption" color={colors.muted} tabular><Text variant="caption" tabular style={{ fontWeight: '700' }}>{n}</Text> {l}</Text>
              ))}
            </View>
          </Card>
        ))}
        {!funnel.rounds.length ? <Text variant="caption" color={colors.muted}>No rounds have been set up yet.</Text> : null}
      </View>

      <Card padding={0}>
        <View style={{ paddingHorizontal: 16 }}>
          {can(permissions, 'viewCandidates') ? (
            <ListRow title="Candidates" subtitle="Search, shortlist, score" icon="people-outline" onPress={() => { driveSelection.set(drive.id); router.navigate('/(recruiter)/(tabs)/candidates' as never); }} />
          ) : null}
          <ListRow title="Rounds and attendance" subtitle={`${rounds.length} round${rounds.length === 1 ? '' : 's'}`} icon="fact-check" onPress={() => go('rounds')} />
          <ListRow title="Interview slots" icon="event-available" onPress={() => go('slots')} />
          <ListRow title="Offers" icon="request-quote" onPress={() => go('offers')} />
          <ListRow title="Drive messages" icon="chat-bubble-outline" onPress={() => { driveSelection.set(drive.id); router.navigate('/(recruiter)/(tabs)/messages' as never); }} last />
        </View>
      </Card>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Drive details" />
        <Card>
          <KeyValueList
            items={[
              ...(drive.ctc ? [{ label: 'Package', value: formatCtc(drive.ctc) }] : []),
              ...(drive.locations?.length ? [{ label: 'Locations', value: drive.locations.join(', ') }] : []),
              ...(drive.workMode ? [{ label: 'Work mode', value: String(drive.workMode) }] : []),
              ...(drive.deadline ? [{ label: 'Deadline', value: formatDateTimeIST(drive.deadline) }] : []),
              { label: 'Scorecards', value: settings.blindScorecards ? 'Blind until you submit' : 'Visible to all recruiters' },
            ]}
          />
        </Card>
        {drive.jd ? <Card><Text variant="body" selectable>{drive.jd}</Text></Card> : null}
      </View>
    </Page>
  );
}
