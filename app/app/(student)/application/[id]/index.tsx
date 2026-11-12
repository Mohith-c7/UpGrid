import React, { useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, CodeBlock, CompanyLogo, EmptyState, ErrorState, KeyValueList, SectionHeader, Sheet, Skeleton, Text, TextField, TimelineList, useToast, type TimelineItem } from '@/ui';
import { colors } from '@/theme';
import { ScheduleCard } from '@/features/student/me/ScheduleCard';
import { useAppOffer } from '@/api/pipeline';
import { OfferCard } from '@/features/pipeline/student/OfferCard';
import { RoundTracker } from '@/features/pipeline/student/RoundTracker';
import { errCode, errMessage, isNetworkError, useApplication, useRespondToOffer, useWithdraw } from '@/features/student/me/data';
import {
  confirm, formatIST, isClosedStatus, NEXT_ACTION, OWNER_LABEL, Page, sp, STATUS_LABEL, STATUS_OWNER, StatusBadge, useOnce,
} from '@/features/student/me/kit';

export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useApplication(id);
  const withdraw = useWithdraw(String(id));
  const a = q.data;
  const notFound = q.isError && errCode(q.error) === 'APPLICATION_NOT_FOUND';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/applications' as never));

  const [doWithdraw, withdrawing] = useOnce(async () => {
    try {
      await withdraw.mutateAsync(undefined);
      toast.show('Application withdrawn', 'success');
      void q.refetch();
    } catch (e) {
      const code = errCode(e);
      toast.show(code === 'INVALID_TRANSITION' ? 'Screening has already started, so this can no longer be withdrawn.' : errMessage(e), 'error');
      void q.refetch();
    }
  });
  const respond = useRespondToOffer();
  const pipeOffer = useAppOffer(id);
  const hasPipeOffer = !!pipeOffer.data;
  const [decision, setDecision] = useState<'accept' | 'decline' | null>(null);
  const [note, setNote] = useState('');
  const [respondError, setRespondError] = useState<string | null>(null);
  const closeSheet = () => { setDecision(null); setNote(''); setRespondError(null); };
  const [doRespond, responding] = useOnce(async () => {
    if (!decision) return;
    setRespondError(null);
    try {
      await respond.mutateAsync({ id: String(id), decision, note: note.trim() || undefined });
      toast.show(decision === 'accept' ? 'Your acceptance has been recorded.' : 'Your decision to decline has been recorded.', 'success');
      closeSheet();
      void q.refetch();
    } catch (e) {
      const code = errCode(e);
      if (code === 'OFFER_ALREADY_DECIDED' || code === 'NO_OFFER_TO_RESPOND_TO') {
        closeSheet();
        void q.refetch();
        toast.show(errMessage(e), 'info');
      } else {
        setRespondError(errMessage(e));
      }
    }
  });
  const canWithdraw = !!a && (a.allowedNextStatuses ?? []).includes('withdrawn');

  const events = useMemo(
    () => (a ? [...(a.events ?? [])].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime()) : []),
    [a],
  );
  const latestInterview = [...events].reverse().find((e) => e.status === 'interview');
  const latestAssessment = [...events].reverse().find((e) => e.status === 'assessment');

  const timeline: TimelineItem[] = events.map((e, i) => {
    const last = i === events.length - 1;
    const owner = e.actorRole === 'student' ? 'you' : STATUS_OWNER[e.status];
    const who = e.actorRole === 'student' ? 'Recorded from your action' : `${OWNER_LABEL[owner] ?? 'Placement cell'}, recorded by the placement cell`;
    const failed = e.status === 'rejected';
    const finalGood = ['joined', 'offer_accepted'].includes(e.status);
    return {
      id: `${e.status}-${e.createdAt}-${i}`,
      title: STATUS_LABEL[e.status] ?? String(e.status),
      subtitle: [who, e.note].filter(Boolean).join('. '),
      time: formatIST(e.createdAt),
      state: failed ? 'error' : last && !finalGood && !isClosedStatus(e.status) ? 'current' : 'done',
    };
  });

  let content: React.ReactNode;
  if (q.isLoading) {
    content = (<><Skeleton height={150} radius={14} /><Skeleton height={96} radius={14} /><Skeleton height={180} radius={14} /></>);
  } else if (notFound || (!q.isError && !a)) {
    content = <EmptyState icon="search-off" title="Application not found" message="It may have been removed, or it belongs to a different account." actionLabel="Back to applications" onAction={() => router.replace('/(student)/(tabs)/applications' as never)} />;
  } else if (q.isError || !a) {
    content = <ErrorState message={isNetworkError(q.error) ? 'You appear to be offline or the server is unreachable. Check your connection and retry.' : errMessage(q.error)} onRetry={() => void q.refetch()} />;
  } else {
    const detailNote = (a.status === 'interview' ? latestInterview : latestAssessment)?.note;
    content = (
      <>
        <Card>
          <View style={{ gap: sp.md }}>
            <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
              <CompanyLogo name={a.drive.company.name} logoUrl={a.drive.company.logoUrl ?? undefined} size={56} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="heading" numberOfLines={2} ellipsizeMode="tail">{a.drive.company.name}</Text>
                <Text variant="body" color={colors.textSecondary} numberOfLines={3} ellipsizeMode="tail">{a.drive.role}</Text>
              </View>
            </View>
            <View style={{ gap: sp.xs }}>
              <StatusBadge status={a.status} />
              <Text variant="caption" color={colors.muted}>{OWNER_LABEL[STATUS_OWNER[a.status]] ?? ''}</Text>
            </View>
            <Button label="View drive" variant="secondary" icon="work-outline" full onPress={() => router.push(`/(student)/drive/${a.drive.id}` as never)} />
          </View>
        </Card>

        {a.canRespondToOffer && !hasPipeOffer ? (
          <Card tinted>
            <View style={{ gap: sp.md }}>
              <Text variant="subhead">Your response to the offer</Text>
              <Text variant="body" color={colors.textSecondary}>
                Take the time you need to read the offer. Your response is shared with the placement cell and recorded in the timeline. It cannot be changed here afterwards.
              </Text>
              <Button label="Accept offer" icon="check" full onPress={() => setDecision('accept')} />
              <Button label="Decline offer" variant="secondary" full onPress={() => setDecision('decline')} />
            </View>
          </Card>
        ) : (
          <Banner
            tone={a.status === 'rejected' ? 'error' : 'info'}
            title="What happens next"
            message={NEXT_ACTION[a.status] ?? ''}
          />
        )}

        {hasPipeOffer ? <OfferCard appId={a.id} company={a.drive.company.name} /> : null}

        <RoundTracker appId={a.id} closed={isClosedStatus(a.status)} rejectionNote={[...events].reverse().find((e) => e.status === 'rejected')?.note} />

        {a.schedule ? (
          <ScheduleCard schedule={a.schedule} company={a.drive.company.name} role={a.drive.role} />
        ) : (a.status === 'assessment' || a.status === 'interview') ? (
          <Card>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">{a.status === 'interview' ? 'Interview details' : 'Assessment details'}</Text>
              {detailNote ? (
                <Text variant="body">{detailNote}</Text>
              ) : (
                <Text variant="body" color={colors.muted}>
                  No schedule has been posted yet. When the placement cell adds the date, time and venue or link, it appears here and you get a notification.
                </Text>
              )}
            </View>
          </Card>
        ) : null}

        <View style={{ gap: sp.md }}>
          <SectionHeader title="Timeline" />
          <Card>
            {timeline.length === 0 ? <Text variant="body" color={colors.muted}>No updates yet.</Text> : <TimelineList items={timeline} />}
          </Card>
        </View>

        <View style={{ gap: sp.md }}>
          <SectionHeader title="Receipt" />
          <Card>
            <View style={{ gap: sp.md }}>
              <CodeBlock label="Reference" code={a.reference} />
              <KeyValueList
                inline
                items={[
                  { label: 'Submitted', value: formatIST(a.submittedAt) },
                  { label: 'Last updated', value: formatIST(a.updatedAt ?? a.submittedAt) },
                  ...(a.resume?.label ? [{ label: 'Resume sent', value: a.resume.label }] : []),
                ]}
              />
              <Button
                label="Share receipt" variant="secondary" icon="share" full
                onPress={async () => {
                  try {
                    await Share.share({ message: `Placement OS application receipt\n${a.drive.company.name} - ${a.drive.role}\nReference: ${a.reference}\nSubmitted: ${formatIST(a.submittedAt)}` });
                  } catch { toast.show('Could not open the share sheet', 'error'); }
                }}
              />
            </View>
          </Card>
        </View>

        {canWithdraw ? (
          <Card>
            <View style={{ gap: sp.md }}>
              <Text variant="subhead">Withdraw application</Text>
              <Text variant="caption" color={colors.muted}>You can withdraw only until the placement cell starts screening. Withdrawing is recorded in the timeline. You can apply again only while the drive is still open.</Text>
              <Button
                label="Withdraw application" variant="danger" icon="undo" full loading={withdrawing}
                onPress={() => confirm('Withdraw this application?', `${a.drive.company.name} - ${a.drive.role}. This cannot be undone.`, 'Withdraw', () => doWithdraw())}
              />
            </View>
          </Card>
        ) : !isClosedStatus(a.status) ? (
          <Text variant="caption" color={colors.muted}>Withdrawal is not available because screening has started. Contact the placement cell if you need to step back.</Text>
        ) : null}

        <Sheet visible={decision !== null} onClose={() => { if (!responding) closeSheet(); }} title={decision === 'accept' ? 'Accept this offer?' : 'Decline this offer?'}>
          <View style={{ gap: sp.md }}>
            <Text variant="body">
              {decision === 'accept'
                ? `You are accepting the offer from ${a.drive.company.name} for ${a.drive.role}. The placement cell will be told and will share joining instructions.`
                : `You are declining the offer from ${a.drive.company.name} for ${a.drive.role}. The placement cell will be told. You can still apply to other drives.`}
            </Text>
            <Text variant="caption" color={colors.muted}>This cannot be changed in the app after you confirm. Contact the placement cell if you need to discuss it first.</Text>
            <TextField
              label={decision === 'accept' ? 'Note for the placement cell (optional)' : 'Reason (optional)'}
              value={note} onChangeText={setNote} multiline maxLength={300}
            />
            {respondError ? <Banner tone="error" message={respondError} /> : null}
            <Button
              label={decision === 'accept' ? 'Yes, accept offer' : 'Yes, decline offer'}
              variant={decision === 'decline' ? 'danger' : 'primary'} full loading={responding} onPress={() => doRespond()}
            />
            <Button label="Go back" variant="ghost" full disabled={responding} onPress={closeSheet} />
          </View>
        </Sheet>
      </>
    );
  }

  return (
    <Page title="Application" onBack={back} onRefresh={() => { void q.refetch(); void pipeOffer.refetch(); }} refreshing={q.isRefetching}>
      {content}
    </Page>
  );
}
