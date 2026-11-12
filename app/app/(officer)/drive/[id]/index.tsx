import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Badge, Banner, Button, Card, CompanyLogo, EmptyState, ErrorState, Header, Icon, KeyValueList, ListRow, MetricRow, OfflineBanner, Screen, SectionHeader, SegmentedTabs, Sheet, Skeleton, Text, TextField, useIsOnline, useToast } from '@/ui';
import { colors, MIN_TOUCH, radius, shadow } from '@/theme';
import { apiGetText } from '@/api/client';
import { shareTextFile } from '@/lib/shareFile';
import {
  closeDrive, duplicateDrive, eligibleCount, errFields, errMessage, publishDrive, setApplicationStatus,
  useAllowedNext, useApplicants, useDrive, useInvalidateOfficer,
} from '@/features/officer/data';
import { AppStatusBadge, DriveStatusBadge, QueryBoundary, useOnce } from '@/features/officer/components/common';
import { ctcSummary, formatIST, NEXT_STATUS, STATUS_LABEL } from '@/features/officer/format';
import type { Applicant, EligibleCount } from '@/features/officer/types';
import { ApplicantResumeButton } from '@/features/studentExtras/resumeOpen';
import { ScheduleSheet, type ScheduleTarget } from '@/features/officer/ScheduleSheet';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';
import { useFeature } from '@/config/features';
import { confirm } from '@/features/pipeline/kit';

const SCHEDULABLE = ['submitted', 'screening', 'assessment', 'interview'];
const STATUS_TABS = [{ value: 'all', label: 'All' }, ...['submitted', 'screening', 'assessment', 'interview', 'selected', 'rejected'].map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))];

export default function DriveDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateOfficer();
  const drive = useDrive(id);
  const [filter, setFilter] = useState('all');
  const apps = useApplicants(id, filter === 'all' ? undefined : filter);
  const elig = useQuery({ queryKey: ['officer', 'eligible', id], enabled: !!id, queryFn: () => eligibleCount(id!) });
  const [target, setTarget] = useState<Applicant | null>(null);
  const allowedQ = useAllowedNext(target?.id);
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const online = useIsOnline();
  const testsOn = useFeature('assessments');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scheduleFor, setScheduleFor] = useState<ScheduleTarget[] | null>(null);
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const d = drive.data;
  const isLive = d?.status === 'open' || d?.status === 'closing';
  const canPublish = d?.status === 'draft';
  const goBack = () => (r.canGoBack() ? r.back() : r.replace('/(officer)/(tabs)/drives'));

  const [doClose, closing] = useOnce(async () => {
    try { await closeDrive(id!); setConfirmClose(false); void invalidate(); toast.show('Drive closed', 'success'); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doDup, dupBusy] = useOnce(async () => {
    try { const n = await duplicateDrive(id!); void invalidate(); toast.show('Duplicated as draft', 'success'); r.replace(`/(officer)/drive/new?draftId=${n.id}`); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doPublish, pubBusy] = useOnce(async () => {
    try { await publishDrive(id!); setMissing([]); void invalidate(); toast.show('Drive published', 'success'); }
    catch (e) {
      const f = errFields(e);
      setMissing(f && Object.keys(f).length ? Object.values(f) : [errMessage(e)]);
    }
  });
  const [doStatus] = useOnce(async (status: string) => {
    if (!target) return;
    setMovingTo(status);
    try { await setApplicationStatus(target.id, status, note.trim()); setTarget(null); setNote(''); void invalidate(); toast.show(`Moved to ${STATUS_LABEL[status] ?? status}`, 'success'); }
    catch (e) { toast.show(errMessage(e), 'error'); }
    finally { setMovingTo(null); }
  });
  const [doExport, exporting] = useOnce(async () => {
    if (!online) { toast.show('You are offline. Connect to export.', 'error'); return; }
    try {
      const csv = await apiGetText(`/drives/${id}/applicants/export`);
      if (!csv.trim()) { toast.show('There are no applicants to export yet.', 'info'); return; }
      const slug = (d?.companyName ?? 'drive').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'drive';
      await shareTextFile(`applicants-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv', 'Export applicants');
    } catch (e) { toast.show(errMessage(e), 'error'); }
  });

  const list: Applicant[] = useMemo(() => {
    const seen = new Set<string>();
    return (apps.data?.pages.flatMap((p) => p.items) ?? []).filter((a) => !seen.has(a.id) && (seen.add(a.id), true));
  }, [apps.data]);
  const schedulable = useMemo(() => list.filter((a) => SCHEDULABLE.includes(a.status)), [list]);
  const pickedValid = schedulable.filter((a) => picked.has(a.id));
  const togglePick = (aid: string) => setPicked((p) => { const n = new Set(p); if (n.has(aid)) n.delete(aid); else n.add(aid); return n; });
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const e: EligibleCount | undefined = elig.data;
  const refresh = () => { void drive.refetch(); void apps.refetch(); void elig.refetch(); };

  if (drive.isLoading || drive.isError || !d) {
    return (
      <Screen padded={false} edges={['bottom']}>
        <FocusedStatusBar />
        <Header variant="bar" title="Drive" onBack={goBack} />
        <View style={{ padding: 16, gap: 12 }}>
          <OfflineBanner />
          {drive.isLoading ? (
            <>
              <Skeleton height={168} radius={14} /><Skeleton height={96} radius={14} /><Skeleton height={140} radius={14} />
            </>
          ) : <ErrorState message={errMessage(drive.error)} onRetry={() => { void drive.refetch(); }} />}
        </View>
      </Screen>
    );
  }

  const footer = selecting ? (
    <>
      <Button label={pickedValid.length ? `Schedule ${pickedValid.length} selected` : 'Select applicants to schedule'} icon="event" full disabled={pickedValid.length === 0}
        onPress={() => setScheduleFor(pickedValid.map((a) => ({ id: a.id, name: a.student.name })))} />
      <Button label="Cancel selection" variant="ghost" full onPress={stopSelecting} />
    </>
  ) : canPublish ? (
    <Button label="Publish drive" icon="publish" full loading={pubBusy} onPress={() => confirm('Publish this drive?', 'It becomes visible and open for eligible students to apply.', 'Publish', () => void doPublish(), false)} />
  ) : undefined;

  const header = (
    <View style={{ gap: 16, paddingBottom: 12 }}>
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <CompanyLogo name={d.companyName || '?'} size={56} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" numberOfLines={2}>{d.companyName}</Text>
            <Text variant="body" color={colors.muted} numberOfLines={2}>{d.role}</Text>
          </View>
        </View>
        {d.status ? <View style={{ flexDirection: 'row' }}><DriveStatusBadge status={d.status} /></View> : null}
        <KeyValueList inline items={[
          { label: 'Package', value: ctcSummary(d.ctc) },
          { label: 'Deadline', value: formatIST(d.deadline) },
          { label: 'Work mode', value: d.workMode ? ({ onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' } as Record<string, string>)[d.workMode] ?? d.workMode : null },
          { label: 'Locations', value: (d.locations ?? []).join(', ') || 'Not set' },
        ]} />
      </Card>

      {missing.length > 0 ? <Banner tone="error" title="Cannot publish yet" message={missing.join('. ')} /> : null}

      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {canPublish ? <ListRow icon="edit" title="Edit draft" subtitle="Change details before publishing" onPress={() => r.push(`/(officer)/drive/new?draftId=${id}`)} /> : null}
        {!canPublish ? <ListRow icon="account-tree" title="Hiring pipeline" subtitle="Rounds, recruiters, slots, offers, funnel" onPress={() => r.push(`/(officer)/drive/${id}/pipeline` as never)} /> : null}
        {testsOn ? <ListRow icon="quiz" title="Online tests" subtitle="See tests attached to this drive or attach a new one" onPress={() => r.push(`/(officer)/assessments?driveId=${id}`)} /> : null}
        {testsOn ? <ListRow icon="post-add" title="Create test for this drive" subtitle="Targets its applicants; shortlist from the results" onPress={() => r.push(`/(officer)/assessments/builder/new?driveId=${id}`)} /> : null}
        <ListRow icon="content-copy" title="Duplicate drive" subtitle={dupBusy ? 'Duplicating…' : 'Start a new draft from this drive'} onPress={() => { if (!dupBusy) void doDup(); }} last={!isLive} />
        {isLive ? (
          <ListRow
            left={<View style={{ width: 40, height: 40, borderRadius: radius.chip + 4, backgroundColor: colors.errorBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={22} color={colors.error} /></View>}
            title="Close drive" subtitle="Stop accepting applications" onPress={() => setConfirmClose(true)} last
          />
        ) : null}
      </Card>

      <SectionHeader title="Eligibility" subtitle="Students who meet this drive's rules" />
      {elig.isLoading ? <Skeleton height={150} radius={14} /> : elig.isError ? (
        <Banner tone="warning" message="Could not calculate the eligible count." action={{ label: 'Retry', onPress: () => { void elig.refetch(); } }} />
      ) : e ? (
        <Card padding={0} style={{ paddingHorizontal: 16 }}>
          <MetricRow label="Eligible" value={e.eligible} tone="success" />
          <MetricRow label="Pending data" hint="Missing details" value={e.pending ?? 0} tone={(e.pending ?? 0) > 0 ? 'warning' : undefined} />
          <MetricRow label="Not eligible" value={e.notEligible ?? 0} last={!e.reasons?.length} />
          {e.reasons?.map((x, i, arr) => <MetricRow key={x.criterion} label={`Blocked by ${x.label ?? x.criterion}`} value={x.count} last={i === arr.length - 1} />)}
        </Card>
      ) : null}

      <SectionHeader title="Applicants" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label="Export CSV" icon="file-download" variant="secondary" size="sm" loading={exporting} disabled={!online || exporting} onPress={() => doExport()} />
        {!selecting ? <Button label="Select to schedule" icon="event" variant="secondary" size="sm" disabled={schedulable.length === 0} onPress={() => setSelecting(true)} /> : null}
      </View>
      {selecting ? (
        <Banner tone="info" message={`${pickedValid.length} of ${schedulable.length} selected. Only applicants who can be scheduled have a checkbox.`}
          action={{ label: pickedValid.length === schedulable.length ? 'Clear all' : 'Select all', onPress: () => setPicked(pickedValid.length === schedulable.length ? new Set() : new Set(schedulable.map((a) => a.id))) }} />
      ) : null}
      <SegmentedTabs value={filter} onChange={setFilter} options={STATUS_TABS} />
    </View>
  );

  const renderApplicant = ({ item: a }: { item: Applicant }) => {
    const next = a.allowedNext ?? NEXT_STATUS[a.status] ?? [];
    const can = SCHEDULABLE.includes(a.status);
    const checked = picked.has(a.id);
    const meta = [a.student.department, a.student.cgpa != null ? `CGPA ${Number(a.student.cgpa).toFixed(2)}` : null].filter(Boolean).join(' · ');
    const top = (
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {selecting && can ? <Icon name={checked ? 'check-box' : 'check-box-outline-blank'} size={26} color={checked ? colors.primary : colors.muted} /> : null}
        <Avatar name={a.student.name} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{a.student.name}</Text>
          {meta ? <Text variant="caption" color={colors.muted} tabular numberOfLines={1}>{meta}</Text> : null}
        </View>
      </View>
    );
    const card = { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: checked ? colors.primary : colors.border, ...shadow.card } as const;
    if (selecting) {
      return (
        <Pressable
          disabled={!can}
          onPress={() => togglePick(a.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: !can }}
          accessibilityLabel={`${a.student.name}, ${STATUS_LABEL[a.status] ?? a.status}${can ? '' : '. Cannot be scheduled'}`}
          style={[card, { padding: 14, gap: 10, minHeight: MIN_TOUCH, opacity: can ? 1 : 0.6 }]}
        >
          {top}
          <View style={{ flexDirection: 'row' }}><AppStatusBadge status={a.status} /></View>
        </Pressable>
      );
    }
    return (
      <View style={[card, { padding: 14, gap: 12 }]}>
        {top}
        <View style={{ flexDirection: 'row' }}><AppStatusBadge status={a.status} /></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {next.length > 0 ? <Button label="Update status" size="sm" variant="secondary" onPress={() => { setTarget(a); setNote(''); }} /> : null}
          {can ? <Button label="Schedule" icon="event" size="sm" variant="secondary" onPress={() => setScheduleFor([{ id: a.id, name: a.student.name }])} /> : null}
          <ApplicantResumeButton applicationId={a.id} />
          <Button label="View student" size="sm" variant="ghost" onPress={() => r.push(`/(officer)/student/${a.student.id}`)} />
        </View>
      </View>
    );
  };

  return (
    <Screen padded={false} edges={['bottom']} footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title="Drive" onBack={goBack} />
      <FlatList
        data={list}
        keyExtractor={(a) => a.id}
        extraData={`${selecting}-${picked.size}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={drive.isRefetching} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={<View><OfflineBanner />{header}</View>}
        renderItem={renderApplicant}
        onEndReached={() => { if (apps.hasNextPage && !apps.isFetchingNextPage) void apps.fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={apps.hasNextPage || apps.isFetchingNextPage
          ? <View style={{ paddingVertical: 12, alignItems: 'center' }}><Button label={apps.isFetchingNextPage ? 'Loading' : 'Load more applicants'} variant="ghost" loading={apps.isFetchingNextPage} onPress={() => void apps.fetchNextPage()} /></View>
          : apps.isError && list.length > 0 ? <View style={{ paddingVertical: 12, alignItems: 'center' }}><Button label="Could not load more. Retry" variant="ghost" onPress={() => void apps.fetchNextPage()} /></View> : <View />}
        ListEmptyComponent={
          <QueryBoundary isLoading={apps.isLoading} isError={apps.isError} error={apps.error} onRetry={() => { void apps.refetch(); }} skeletonRows={3} skeletonHeight={128}
            isEmpty empty={{ icon: 'groups', title: 'No applicants', message: filter !== 'all' ? 'No applications with this status.' : 'Applications will appear here once students apply.' }}>
            {null}
          </QueryBoundary>
        }
      />

      {scheduleFor && id ? (
        <ScheduleSheet
          visible driveId={id} targets={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onDone={(res) => {
            void invalidate();
            if (res.failed === 0) { toast.show(res.scheduled === 1 ? 'Scheduled. The student is notified.' : `${res.scheduled} scheduled. Students are notified.`, 'success'); stopSelecting(); }
            else toast.show(`${res.scheduled} scheduled, ${res.failed} failed`, 'error');
          }}
        />
      ) : null}
      <Sheet visible={!!target} onClose={() => setTarget(null)} title={target ? `Update ${target.student.name}` : ''}>
        {target ? (
          <View style={{ gap: 14, paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="caption" color={colors.muted}>Current status</Text>
              <AppStatusBadge status={target.status} />
            </View>
            <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
            {allowedQ.isLoading ? <Skeleton height={52} radius={12} /> : null}
            {allowedQ.isError ? <Banner tone="error" message={errMessage(allowedQ.error)} action={{ label: 'Retry', onPress: () => { void allowedQ.refetch(); } }} /> : null}
            {allowedQ.data && allowedQ.data.allowed.length === 0 ? <EmptyState icon="lock" title="No further steps" message="No further steps are allowed from this status." /> : null}
            {(allowedQ.data?.allowed ?? []).map((s) => (
              <Button key={s} label={`Move to ${STATUS_LABEL[s] ?? s}`} variant={s === 'rejected' || s === 'offer_declined' ? 'danger' : 'primary'} full
                loading={movingTo === s} disabled={movingTo !== null}
                onPress={() => (s === 'rejected' || s === 'offer_declined'
                  ? confirm(`Move ${target.student.name} to ${STATUS_LABEL[s] ?? s}?`, 'The student is notified and this is hard to undo.', 'Confirm', () => void doStatus(s))
                  : void doStatus(s))} />
            ))}
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={confirmClose} onClose={() => setConfirmClose(false)} title="Close this drive?">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text variant="body">Students will no longer be able to apply and pending reminders stop. This cannot be undone.</Text>
          <Button label="Close drive" variant="danger" full loading={closing} onPress={() => doClose()} />
          <Button label="Keep open" variant="secondary" full onPress={() => setConfirmClose(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
