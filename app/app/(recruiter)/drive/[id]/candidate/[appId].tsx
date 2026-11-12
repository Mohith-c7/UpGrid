import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, SectionHeader, SegmentedTabs, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { formatDateIST } from '@/lib/format';
import { useFeature } from '@/config/features';
import { useCandidate, useRecruiterDrive } from '@/api/recruiter';
import { CandidateSummaryCard, QuestionSetEditor } from '@/features/ai';
import { can, DECISION_META, Page, ROUND_KIND_LABEL, StatusBadge, useBack } from '@/features/recruiter/kit';
import { AnswersCard, DecisionCard, HistoryCard, NotesCard, OfferStatusLine, OutcomeCard, ResumeButton, RoundsCard, ScorecardSection, SnapshotCard } from '@/features/recruiter/panels';

type Tab = 'profile' | 'evaluate' | 'notes' | 'progress';

export default function CandidateDetail() {
  const { id, appId } = useLocalSearchParams<{ id: string; appId: string }>();
  const router = useRouter();
  const back = useBack(`/(recruiter)/drive/${id}`);
  const [tab, setTab] = useState<Tab>('profile');
  const drive = useRecruiterDrive(id);
  const q = useCandidate(id, appId);
  const aiOn = useFeature('ai');
  const perms = drive.data?.permissions;

  if (q.isLoading) return <Page title="Candidate" onBack={back}><Skeleton height={90} radius={14} /><Skeleton height={48} radius={12} /><Skeleton height={260} radius={14} /></Page>;
  if (q.isError || !q.data) {
    const gone = (q.error as { status?: number } | null)?.status === 404;
    return (
      <Page title="Candidate" onBack={back}>
        {gone
          ? <EmptyState icon="person-off" title="Candidate not available" message="They may have withdrawn, or you no longer have access to this candidate." actionLabel="Go back" onAction={back} />
          : <ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} />}
      </Page>
    );
  }
  const d = q.data;
  const dm = d.decision ? DECISION_META[d.decision] : null;
  const currentRound = [...d.rounds].reverse().find((r) => !r.waitlisted);
  const blind = drive.data?.settings.blindScorecards ?? true;

  return (
    <Page title={d.fields.name ?? 'Candidate'} subtitle={d.reference} onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <StatusBadge status={d.status} />
        {dm ? <Badge label={dm.label} tone={dm.tone} icon={dm.icon as never} /> : null}
        {d.scoreSummary?.count ? <Badge label={`${d.scoreSummary.count} scorecard${d.scoreSummary.count === 1 ? '' : 's'}${!blind && d.scoreSummary.avg != null ? `, avg ${d.scoreSummary.avg.toFixed(2)}` : ''}`} tone="neutral" /> : null}
      </View>
      <SegmentedTabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[{ value: 'profile', label: 'Profile' }, { value: 'evaluate', label: 'Evaluate' }, { value: 'notes', label: 'Notes', count: d.notes.length }, { value: 'progress', label: 'Progress' }]}
      />

      {tab === 'profile' ? (
        <>
          <ResumeButton driveId={id!} appId={d.applicationId} label={d.resume.label} />
          <SnapshotCard d={d} />
          {d.answers.length ? <SectionHeader title="Application answers" /> : null}
          <AnswersCard d={d} />
          {aiOn ? (
            <View style={{ gap: 8 }}>
              <SectionHeader title="AI summary" subtitle="Draft from the shared details. Not a hiring recommendation." />
              <CandidateSummaryCard applicationId={d.applicationId} />
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'evaluate' ? (
        <>
          <DecisionCard driveId={id!} d={d} perms={perms} />
          <View style={{ gap: 8 }}>
            <SectionHeader title="Scorecard" subtitle={blind ? 'Blind: others are revealed after you submit' : undefined} />
            {can(perms, 'scorecards') || (d.scorecards ?? []).length ? <ScorecardSection driveId={id!} d={d} perms={perms} blind={blind} /> : <Banner tone="info" message="You do not have permission to submit scorecards on this drive." />}
          </View>
          {aiOn ? (
            <View style={{ gap: 8 }}>
              <SectionHeader title="Interview questions" subtitle="AI drafts. Edit and approve before use." />
              <QuestionSetEditor applicationId={d.applicationId} defaultRoundType={currentRound ? (ROUND_KIND_LABEL[currentRound.kind] ?? currentRound.kind).toLowerCase() : 'technical'} />
            </View>
          ) : null}
          <OutcomeCard driveId={id!} d={d} perms={perms} />
          {d.status === 'selected' || d.offer ? (
            <Card style={{ gap: 8 }}>
              <Text variant="subhead">Offer</Text>
              <OfferStatusLine d={d} />
              {!d.offer && can(perms, 'proposeOffers') ? <Button label="Propose offer" icon="request-quote" full onPress={() => router.push(`/(recruiter)/drive/${id}/offer-new?applicationId=${d.applicationId}` as never)} /> : null}
              {d.offer ? <Button label="See all offers" variant="secondary" full onPress={() => router.push(`/(recruiter)/drive/${id}/offers` as never)} /> : null}
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'notes' ? <NotesCard driveId={id!} d={d} perms={perms} /> : null}

      {tab === 'progress' ? (
        <>
          <SectionHeader title="Rounds" />
          <RoundsCard d={d} />
          <SectionHeader title="Status history" />
          <HistoryCard d={d} />
          <Text variant="caption" color={colors.muted}>Applied {formatDateIST(d.submittedAt)}</Text>
        </>
      ) : null}
    </Page>
  );
}
