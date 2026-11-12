import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, ErrorState, MetricRow, SectionHeader, SegmentedControl, Select, Skeleton, Text, TextField, useIsOnline, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { useAssessment, useShortlist, type ShortlistBody, type ShortlistItem, type ShortlistResult } from '@/api/assessments';
import { useDrivesOfficer } from '@/features/officer/data';
import { STATUS_LABEL } from '@/features/officer/format';
import { ConfirmSheet, Frame, NumberField, fmtNum, parseNum } from '@/features/assessments/kit';

const TO_STATUSES = ['screening', 'assessment', 'interview', 'selected', 'offer_issued', 'rejected'];
const OUTCOME: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' }> = { change: { label: 'Will move', tone: 'success' }, unchanged: { label: 'No change', tone: 'neutral' }, skipped: { label: 'Skipped', tone: 'warning' } };
const SKIP_REASON: Record<string, string> = { NO_APPLICATION: 'No application on this drive', INVALID_TRANSITION: 'Status cannot move there' };

export default function ShortlistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const online = useIsOnline();
  const a = useAssessment(id);
  const drivesQ = useDrivesOfficer();
  const run = useShortlist();
  const [mode, setMode] = useState<'minScore' | 'topN'>('minScore');
  const [value, setValue] = useState('');
  const [driveId, setDriveId] = useState<string>('');
  const [toStatus, setToStatus] = useState('interview');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ sig: string; res: ShortlistResult } | null>(null);
  const [applied, setApplied] = useState<ShortlistResult | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const effDrive = driveId || a.data?.driveId || '';
  const drives = useMemo(() => (drivesQ.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.status !== 'draft' || d.id === effDrive).map((d) => ({ value: d.id, label: `${d.company.name} · ${d.role}` })), [drivesQ.data, effDrive]);
  const v = parseNum(value);
  const vErr = value.trim() !== '' && (v === null || (mode === 'topN' ? !Number.isInteger(v) || v < 1 : false)) ? (mode === 'topN' ? 'Enter a whole number of 1 or more.' : 'Enter a number.') : null;
  const ready = v !== null && !vErr && !!effDrive && !!toStatus;
  const sig = JSON.stringify({ mode, v, effDrive, toStatus, note: note.trim() });

  const body = (dryRun: boolean): ShortlistBody => ({ [mode]: v!, driveId: effDrive, toStatus, dryRun, ...(note.trim() ? { note: note.trim() } : {}) } as ShortlistBody);

  const doPreview = async () => {
    setErr(null); setPendingMsg(null); setApplied(null);
    try { const res = await run.mutateAsync({ id: id!, body: body(true) }); setPreview({ sig, res }); setShowAll(false); }
    catch (e) { setPreview(null); setErr(errMessage(e)); }
  };
  const doApply = async () => {
    setErr(null); setPendingMsg(null);
    try {
      const res = await run.mutateAsync({ id: id!, body: body(false) });
      setApplied(res); setPreview(null); setConfirm(false);
      toast.show(`${res.changed ?? 0} application${res.changed === 1 ? '' : 's'} moved`, 'success');
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError && e.code === 'EVALUATION_PENDING') setPendingMsg(e.message || 'Some attempts are still being evaluated.');
      else setErr(errMessage(e));
    }
  };

  const stale = !!preview && preview.sig !== sig;
  const p = preview?.res;
  const list: ShortlistItem[] = p ? (showAll ? p.items : p.items.slice(0, 20)) : [];

  return (
    <Frame title="Shortlist" subtitle={a.data?.title} keyboard
      footer={(
        <View style={{ gap: 8 }}>
          <Button label={preview && !stale ? 'Preview again' : 'Preview changes'} icon="visibility" variant={preview && !stale ? 'secondary' : 'primary'} full loading={run.isPending && !confirm} disabled={!ready || !online} onPress={doPreview} />
          {preview && !stale ? <Button label={p && (p.willChange ?? 0) > 0 ? `Move ${p.willChange} application${p.willChange === 1 ? '' : 's'}` : 'Nothing to move'} icon="done-all" full disabled={!p || (p.willChange ?? 0) === 0 || !online} onPress={() => setConfirm(true)} /> : null}
        </View>
      )}>
      <Banner tone="info" message="Pick who qualifies by score or rank, preview exactly what would change, then confirm. Students are notified of their new status. Nothing changes until you confirm." />
      {a.isError ? <ErrorState message={errMessage(a.error)} onRetry={() => { void a.refetch(); }} /> : null}
      {a.isLoading ? <Skeleton height={200} radius={14} /> : (
        <Card style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Who qualifies</Text>
            <SegmentedControl value={mode} onChange={(m) => { setMode(m as any); setValue(''); }} options={[{ value: 'minScore', label: 'Minimum score' }, { value: 'topN', label: 'Top N by rank' }]} />
          </View>
          <NumberField label={mode === 'minScore' ? `Minimum score (out of ${fmtNum(a.data?.totalMarks)})` : 'Number of top students'} integer={mode === 'topN'} value={value} onChange={setValue} error={vErr}
            helper={mode === 'topN' ? 'Ties at the boundary are included.' : 'Uses the effective score, including manual overrides.'} />
          <Select label="Drive whose applications move" value={effDrive || null} placeholder="Choose a drive" options={drives.length || !effDrive ? drives : [{ value: effDrive, label: 'Linked drive' }]} onChange={setDriveId}
            error={!effDrive ? 'Choose a drive.' : null} />
          <Select label="Move them to" value={toStatus} onChange={setToStatus} options={TO_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))} />
          <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} helper="Added to each application's history." />
        </Card>
      )}

      {err ? <Banner tone="error" message={err} /> : null}
      {pendingMsg ? <Banner tone="warning" title="Evaluation still running" message={`${pendingMsg} Wait for coding answers to finish judging, then preview again.`} action={{ label: 'Preview again', onPress: () => { void doPreview(); } }} /> : null}
      {stale ? <Banner tone="warning" message="You changed the criteria after previewing. Preview again before applying." /> : null}

      {applied ? (
        <>
          <Banner tone="success" title="Shortlist applied" message={`${applied.changed ?? 0} moved to ${STATUS_LABEL[toStatus] ?? toStatus}, ${applied.unchanged} already there, ${applied.skipped.length} skipped.`} />
          {applied.skipped.length ? <Card padding={0} style={{ paddingHorizontal: 16 }}>{applied.skipped.map((s, i) => <MetricRow key={s.studentId} label={s.name} hint={SKIP_REASON[s.reason] ?? s.reason} value="Skipped" last={i === applied.skipped.length - 1} />)}</Card> : null}
        </>
      ) : null}

      {p && !stale ? (
        <>
          <SectionHeader title="Preview" subtitle="Nothing has been changed yet" />
          <Card padding={0} style={{ paddingHorizontal: 16 }}>
            <MetricRow label="Match the criteria" value={p.matched} />
            <MetricRow label="Will be moved" value={p.willChange ?? 0} tone={(p.willChange ?? 0) > 0 ? 'success' : undefined} />
            <MetricRow label="Already at that status" value={p.unchanged} />
            <MetricRow label="Skipped" value={p.skipped.length} tone={p.skipped.length ? 'warning' : undefined} />
            <MetricRow label="Left out: still evaluating" value={p.pendingEvaluation} tone={p.pendingEvaluation ? 'warning' : undefined} last />
          </Card>
          {p.pendingEvaluation > 0 ? <Banner tone="warning" message="Some attempts are still being evaluated and are excluded. You cannot apply until they finish." /> : null}
          {p.items.length === 0 ? <Banner tone="info" message="No student matches these criteria." /> : null}
          {list.map((it) => {
            const o = OUTCOME[it.outcome] ?? OUTCOME.unchanged;
            return (
              <Card key={it.studentId} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Text variant="subhead" style={{ flex: 1 }} numberOfLines={2}>{it.name}</Text>
                  <Badge label={o.label} tone={o.tone} />
                </View>
                <Text variant="caption" color={colors.muted} tabular>{`${it.rank ? `Rank ${it.rank} · ` : ''}Score ${fmtNum(it.score)}${it.from ? ` · ${STATUS_LABEL[it.from] ?? it.from} to ${STATUS_LABEL[it.to] ?? it.to}` : ''}`}</Text>
                {it.outcome === 'skipped' ? <Text variant="caption" color={colors.warning}>{SKIP_REASON[it.reason ?? ''] ?? it.reason}</Text> : null}
              </Card>
            );
          })}
          {p.items.length > 20 ? <Button label={showAll ? 'Show fewer' : `Show all ${p.items.length}`} variant="ghost" full onPress={() => setShowAll((s) => !s)} /> : null}
        </>
      ) : null}

      <ConfirmSheet visible={confirm} onClose={() => setConfirm(false)} title="Move these applications?" confirmLabel={run.isPending ? 'Applying...' : 'Confirm and move'}
        message={`${p?.willChange ?? 0} application${p?.willChange === 1 ? '' : 's'} will move to ${STATUS_LABEL[toStatus] ?? toStatus} and each student is notified. Running it again changes nobody twice.`} onConfirm={doApply} disabled={run.isPending} />
    </Frame>
  );
}
