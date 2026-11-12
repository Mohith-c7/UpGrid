import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, ErrorState, KeyValueList, ListRow, SectionHeader, Sheet, Skeleton, Text, TextField, SegmentedControl, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError, errMessage, getServerOffsetMs } from '@/api/client';
import { useArchiveAssessment, useAssessment, useCloneAssessment, useRefreshAudience, useSaveAssessment, type Assessment } from '@/api/assessments';
import { formatDateTimeIST } from '@/lib/format';
import { dateLabel, PickerRow, timeLabel, useISTPicker } from '@/features/officer/components/pickers';
import { isoToISTParts, istPartsToISO, nowISTParts } from '@/features/officer/format';
import { AssessmentStatusBadge, ConfirmSheet, DIFF_LABEL, DifficultyBadge, Frame, NumberField, Pill, ROOT, TYPE_LABEL, ToggleRow, errorLines, ErrorList, fmtNum, parseNum } from '@/features/assessments/kit';
import { KeyFixSheet, RegradeSheet } from '@/features/assessments/sheets';
import { useOnce } from '@/features/officer/components/common';

export default function AssessmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useRouter();
  const toast = useToast();
  const q = useAssessment(id);
  const archive = useArchiveAssessment();
  const clone = useCloneAssessment();
  const refreshAud = useRefreshAudience();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [regradeOpen, setRegradeOpen] = useState(false);
  const [regradeReason, setRegradeReason] = useState('');

  const [doArchive] = useOnce(async () => {
    try { await archive.mutateAsync(id!); setConfirmArchive(false); toast.show('Test archived', 'success'); }
    catch (e) { toast.show(errMessage(e), 'error'); setConfirmArchive(false); }
  });
  const [doClone, cloning] = useOnce(async () => {
    try { const c = await clone.mutateAsync(id!); toast.show('Cloned as a draft', 'success'); r.push(`${ROOT}/builder/${c.id}` as any); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doRefresh, refreshing] = useOnce(async () => {
    try { const x = await refreshAud.mutateAsync(id!); toast.show(x.added ? `${x.added} new student${x.added === 1 ? '' : 's'} added. Audience is ${x.audienceCount}.` : `No new students. Audience is ${x.audienceCount}.`, 'success'); }
    catch (e) { toast.show(errMessage(e), 'error'); }
  });

  if (q.isLoading || q.isError || !q.data) {
    return (
      <Frame title="Test">
        {q.isError ? <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} />
          : <><Skeleton height={140} radius={14} /><Skeleton height={200} radius={14} /><Skeleton height={120} radius={14} /></>}
      </Frame>
    );
  }
  const a: Assessment = q.data;
  const draft = a.status === 'draft'; const live = a.status === 'published'; const archived = a.status === 'archived';
  const hasCoding = a.sections.some((s) => s.questions.some((x) => x.type === 'coding'));
  const nowMs = Date.now() + getServerOffsetMs();
  const opens = a.opensAt ? Date.parse(a.opensAt) : null; const closes = a.closesAt ? Date.parse(a.closesAt) : null;
  const phase = a.practice ? 'Practice, always open' : !live ? null : opens && nowMs < opens ? 'Not open yet' : closes && nowMs > closes ? 'Window closed' : 'Open now';

  return (
    <Frame title={a.title} subtitle={a.drive ? `${a.drive.company} · ${a.drive.role}` : undefined} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={draft ? <Button label="Continue editing" icon="edit" full onPress={() => r.push(`${ROOT}/builder/${a.id}` as any)} />
        : (live || archived) ? <Button label="View results" icon="leaderboard" full onPress={() => r.push(`${ROOT}/${a.id}/results` as any)} /> : undefined}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <AssessmentStatusBadge status={a.status} />
          {a.practice ? <Badge label="Practice set" tone="info" icon="fitness-center" /> : null}
          {phase ? <Badge label={phase} tone={phase === 'Open now' ? 'success' : 'neutral'} icon="schedule" /> : null}
          {live ? <Badge label={a.resultsPublishedAt ? 'Results released' : 'Results not released'} tone={a.resultsPublishedAt ? 'success' : 'warning'} /> : null}
        </View>
        <KeyValueList items={[
          { label: 'Opens', value: a.practice ? 'Always open' : a.opensAt ? formatDateTimeIST(a.opensAt) : 'Not set' },
          { label: 'Closes', value: a.practice ? 'Never' : a.closesAt ? formatDateTimeIST(a.closesAt) : 'Not set' },
          { label: 'Duration', value: `${a.durationMinutes} min` },
          { label: 'Questions', value: String(a.questionCount) },
          { label: 'Total marks', value: fmtNum(a.totalMarks) },
          ...(live || archived ? [{ label: 'Audience', value: a.audienceCount != null ? String(a.audienceCount) : '-' }, { label: 'Attempts', value: a.counts ? `${a.counts.submitted} submitted, ${a.counts.inProgress} in progress` : '-' }] : []),
        ]} />
      </Card>

      <SectionHeader title="Actions" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {draft ? <ListRow icon="edit" title="Edit draft" subtitle="Details, questions, rules, audience, schedule" onPress={() => r.push(`${ROOT}/builder/${a.id}` as any)} /> : null}
        <ListRow icon="visibility" title="Preview as a student" subtitle="See every question without starting an attempt" onPress={() => r.push(`${ROOT}/${a.id}/preview` as any)} />
        {live || archived ? <ListRow icon="leaderboard" title="Results and leaderboard" onPress={() => r.push(`${ROOT}/${a.id}/results` as any)} /> : null}
        {live || archived ? <ListRow icon="insights" title="Analytics" subtitle="Score distribution and question difficulty" onPress={() => r.push(`${ROOT}/${a.id}/analytics` as any)} /> : null}
        {live || archived ? <ListRow icon="how-to-reg" title="Shortlist into a drive" subtitle="Move top scorers to the next stage" onPress={() => r.push(`${ROOT}/${a.id}/shortlist` as any)} /> : null}
        {live ? <ListRow icon="tune" title="Edit live settings" subtitle="Instructions, close time, result visibility, review, warnings" onPress={() => setLiveOpen(true)} /> : null}
        {live && !a.practice ? <ListRow icon="group-add" title="Refresh audience" subtitle={refreshing ? 'Checking for new students...' : 'Add students who now qualify'} onPress={() => { if (!refreshing) void doRefresh(); }} /> : null}
        <ListRow icon="content-copy" title="Clone as new draft" subtitle={cloning ? 'Cloning...' : 'Same questions and settings, no schedule'} onPress={() => { if (!cloning) void doClone(); }} last={archived} />
        {!archived ? <ListRow icon="inventory-2" title="Archive" subtitle="Hides it from students. Running attempts can still be submitted." onPress={() => setConfirmArchive(true)} last /> : null}
      </Card>

      <SectionHeader title="Questions" subtitle={live || archived ? 'Tap a question to correct its answer key' : undefined} />
      {a.sections.length === 0 || a.questionCount === 0 ? <Banner tone="warning" message="No questions yet. Continue editing to add some." /> : null}
      {a.sections.map((s, si) => (
        <Card key={s.id ?? si} padding={0} style={{ paddingHorizontal: 16 }}>
          <View style={{ paddingTop: 12 }}>
            <Text variant="subhead">{s.title}</Text>
            <Text variant="caption" color={colors.muted} tabular>{[`${s.questions.length} questions`, s.timeLimitMinutes ? `${s.timeLimitMinutes} min limit` : null, s.cutoffMarks != null ? `cutoff ${s.cutoffMarks}` : null].filter(Boolean).join(' · ')}</Text>
          </View>
          {s.questions.map((x, i) => (
            <ListRow key={x.id ?? `${x.questionId}-${i}`} title={`${i + 1}. ${x.title}`} subtitle={`${TYPE_LABEL[x.type]} · ${DIFF_LABEL[x.difficulty] ?? x.difficulty} · ${fmtNum(x.marks)} marks`}
              onPress={(live || archived) && x.id ? () => setKeyFor(x.id!) : undefined} right={(live || archived) && x.id ? <Text variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>Fix key</Text> : <View />} last={i === s.questions.length - 1} />
          ))}
        </Card>
      ))}

      <ConfirmSheet visible={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive this test?" tone="danger" confirmLabel="Archive"
        message="Students will no longer see it and reminders are cancelled. Results stay available to you." onConfirm={() => doArchive()} />
      <LiveSettingsSheet a={a} visible={liveOpen} onClose={() => setLiveOpen(false)} />
      <KeyFixSheet a={a} aqId={keyFor} onClose={() => setKeyFor(null)} onSaved={(reason) => { setKeyFor(null); setRegradeReason(reason); setRegradeOpen(true); }} />
      <RegradeSheet assessmentId={a.id} visible={regradeOpen} onClose={() => setRegradeOpen(false)} defaultReason={regradeReason} hasCoding={hasCoding} />
    </Frame>
  );
}

/** A published test only accepts a few changes; send just what changed. */
function LiveSettingsSheet({ a, visible, onClose }: { a: Assessment; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveAssessment();
  const [instr, setInstr] = useState(''); const [vis, setVis] = useState<string>('after_close'); const [review, setReview] = useState(false);
  const [warns, setWarns] = useState(''); const [closes, setClosesState] = useState<ReturnType<typeof isoToISTParts>>(null);
  const [lines, setLines] = useState<string[]>([]);
  React.useEffect(() => {
    if (visible) {
      setInstr(a.instructions ?? ''); setVis(a.settings.resultVisibility); setReview(!!a.settings.allowReview);
      setWarns(String(a.settings.proctoring?.maxWarnings ?? 3)); setClosesState(isoToISTParts(a.closesAt)); setLines([]);
    }
  }, [visible, a]);
  const dt = useISTPicker(closes ?? nowISTParts(getServerOffsetMs()), (p) => setClosesState(p));
  const newCloseIso = closes ? istPartsToISO(closes) : null;
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60000);
  const closeMoved = !a.practice && !!newCloseIso && !!a.closesAt && minute(newCloseIso) !== minute(a.closesAt);
  const closeErr = closeMoved && a.closesAt && minute(newCloseIso!) < minute(a.closesAt) ? 'The close time can only move later.' : null;
  const w = parseNum(warns);
  const wErr = a.settings.proctoring?.enabled && (w === null || !Number.isInteger(w) || w < 1 || w > 20) ? 'Warnings must be 1 to 20.' : null;

  const submit = async () => {
    setLines([]);
    const body: any = {}; const settings: any = {};
    if (instr !== (a.instructions ?? '')) body.instructions = instr;
    if (closeMoved) body.closesAt = newCloseIso;
    if (vis !== a.settings.resultVisibility) settings.resultVisibility = vis;
    if (review !== !!a.settings.allowReview) settings.allowReview = review;
    if (a.settings.proctoring?.enabled && w !== a.settings.proctoring.maxWarnings) settings.proctoring = { maxWarnings: w };
    if (Object.keys(settings).length) body.settings = settings;
    if (Object.keys(body).length === 0) { onClose(); return; }
    try { await save.mutateAsync({ id: a.id, body }); toast.show('Settings updated', 'success'); onClose(); }
    catch (e) { setLines(e instanceof ApiError && e.code === 'ASSESSMENT_LOCKED' ? ['That change is not allowed once a test is published.'] : errorLines(e)); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Edit live settings">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        <Banner tone="info" message="Only these settings can change after publishing. Questions, marks, audience and the opening time are locked." />
        <ErrorList title="Could not save" lines={lines} />
        <TextField label="Instructions" value={instr} onChangeText={setInstr} multiline />
        {!a.practice ? (
          <View style={{ gap: 4 }}>
            <PickerRow label="Closes (can only move later)" icon="event" value={closes ? dateLabel(closes) : 'Not set'} onPress={() => dt.open('date')} error={closeErr} />
            <PickerRow label="Closing time (IST)" icon="schedule" value={closes ? timeLabel(closes) : 'Not set'} onPress={() => dt.open('time')} />
            {dt.iosPicker}
          </View>
        ) : null}
        <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Result visibility</Text>
        <SegmentedControl value={vis} onChange={setVis} options={[{ value: 'immediate', label: 'Immediately' }, { value: 'after_close', label: 'After close' }, { value: 'manual', label: 'Manual' }]} />
        <ToggleRow label="Allow answer review" value={review} onChange={setReview} />
        {a.settings.proctoring?.enabled ? <NumberField label="Maximum warnings" integer value={warns} onChange={setWarns} error={wErr} /> : null}
        <Button label="Save changes" full loading={save.isPending} disabled={!!closeErr || !!wErr} onPress={submit} />
      </View>
    </Sheet>
  );
}
