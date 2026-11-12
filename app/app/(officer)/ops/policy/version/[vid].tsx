import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Checkbox, KeyValueList, MetricRow, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useFeature } from '@/config/features';
import {
  aiPolicyDraft, simulatePolicy, useActivateVersion, useApproveVersion, useOpsSettings, usePolicyVersion, useUpdateVersion, validatePolicyDraft,
} from '@/api/ops';
import type { AiPolicyDraft, SimulateResult, ValidateDraftResult } from '@/api/opsTypes';
import { useUnsavedGuard } from '@/features/student/me/kit';
import { AiErrorBanner } from '@/features/ai/kit';
import { Async, BarRow, DateTimeFields, Group, isoToIst, istToIso, OpsPage, STATUS_TONE, useOnce, versionLabel } from '@/features/ops/kit';
import { formErrors, fromForm, toForm, type PolicyForm } from '@/features/ops/policyForm';
import { formatDateTimeIST } from '@/lib/format';

export default function PolicyVersionScreen() {
  const { vid } = useLocalSearchParams<{ vid: string }>();
  const toast = useToast();
  const aiOn = useFeature('ai');
  const q = usePolicyVersion(vid);
  const settings = useOpsSettings();
  const update = useUpdateVersion(vid);
  const approve = useApproveVersion();
  const activate = useActivateVersion();

  const [form, setForm] = useState<PolicyForm | null>(null);
  const [note, setNote] = useState('');
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidateDraftResult | null>(null);
  const [sim, setSim] = useState<SimulateResult | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [actOpen, setActOpen] = useState(false);
  const [actSim, setActSim] = useState<SimulateResult | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const v = q.data;
  useEffect(() => {
    if (v && !dirty) {
      setForm(toForm(v.policy)); setNote(v.note ?? '');
      const p = isoToIst(v.effectiveFrom); setEDate(p.date); setETime(p.time);
    }
  }, [v, dirty]);

  const isDraft = v?.status === 'draft';
  useUnsavedGuard(dirty && isDraft);
  const set = <K extends keyof PolicyForm>(k: K, val: PolicyForm[K]) => { setForm((f) => (f ? { ...f, [k]: val } : f)); setDirty(true); setValidation(null); setSim(null); setErrs((e) => ({ ...e, [k]: '' })); };
  const effectiveIso = eDate.trim() ? istToIso(eDate, eTime || '00:00') : null;
  const approvalNotNeeded = settings.data?.policyApproval === 'not_required';

  const check = (): boolean => {
    if (!form) return false;
    const e = formErrors(form);
    setErrs(e);
    if (eDate.trim() && !effectiveIso) { setErrs((x) => ({ ...x, effective: 'Use YYYY-MM-DD and HH:mm' })); return false; }
    return Object.keys(e).length === 0;
  };

  const [doValidate, validating] = useOnce(async () => {
    if (!form || !check()) return;
    setBanner(null);
    try { setValidation(await validatePolicyDraft(fromForm(form))); } catch (e) { setBanner(errMessage(e)); }
  });
  const [doSimulate, simulating] = useOnce(async () => {
    if (!form || !check()) return;
    setSimErr(null);
    try { setSim(await simulatePolicy(isDraft ? { draft: fromForm(form) } : { versionId: vid })); } catch (e) { setSimErr(errMessage(e)); }
  });
  const [doSave, saving] = useOnce(async () => {
    if (!form || !check()) return;
    setBanner(null);
    try {
      await update.mutateAsync({ policy: fromForm(form), note: note.trim() || undefined, effectiveFrom: effectiveIso ?? undefined });
      setDirty(false); toast.show('Draft saved', 'success');
    } catch (e) {
      const f = fieldErrors(e);
      setErrs((x) => ({ ...x, ...f })); setBanner(errMessage(e));
    }
  });
  const [doApprove, approving] = useOnce(async () => {
    if (dirty) { setBanner('Save your changes before approving.'); return; }
    setBanner(null);
    try { await approve.mutateAsync(vid); toast.show('Version approved', 'success'); } catch (e) { setBanner(errMessage(e)); }
  });
  const openActivate = async () => {
    if (dirty) { setBanner('Save your changes before activating.'); return; }
    setBanner(null); setActSim(null); setActErr(null); setActOpen(true);
    try { setActSim(await simulatePolicy({ versionId: vid })); } catch (e) { setActErr(errMessage(e)); }
  };
  const [doActivate, activating] = useOnce(async () => {
    setActErr(null);
    try {
      const r = await activate.mutateAsync(vid);
      setActOpen(false); toast.show(r.active ? 'Policy activated' : 'Activation scheduled', 'success');
    } catch (e) { setActErr(errMessage(e)); }
  });

  const future = !!v?.effectiveFrom && Date.parse(v.effectiveFrom) > Date.now();
  const canApprove = isDraft;
  const canActivate = v?.status === 'approved' || (isDraft && approvalNotNeeded);

  const footer = form && v ? (
    <View style={{ gap: 8 }}>
      {isDraft ? <Button label={dirty ? 'Save draft' : 'Saved'} icon="save" full loading={saving} disabled={!dirty} onPress={() => doSave()} /> : null}
      {canApprove && !approvalNotNeeded ? <Button label="Approve version" icon="done" variant={dirty ? 'secondary' : 'primary'} full loading={approving} onPress={() => doApprove()} /> : null}
      {canActivate ? <Button label={future ? 'Schedule activation' : 'Preview and activate'} icon="bolt" full onPress={() => void openActivate()} /> : null}
    </View>
  ) : undefined;

  return (
    <OpsPage title={v ? `Version ${v.version}` : 'Policy version'} keyboard footer={footer} onRefresh={() => { setDirty(false); void q.refetch(); }} refreshing={q.isRefetching}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3} rowHeight={120}>
        {v && form ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge label={versionLabel(v.status)} tone={STATUS_TONE[v.status] ?? 'neutral'} />
              <Text variant="caption" color={colors.muted}>Created {formatDateTimeIST(v.createdAt)}</Text>
            </View>
            {!isDraft ? <Banner tone="info" message={v.status === 'approved' ? 'Approved versions cannot be edited. Simulate, then activate, or create a new draft from the policy page.' : 'Only drafts can be edited. Create a new draft from the policy page to change this policy.'} /> : null}
            {banner ? <Banner tone="error" message={banner} /> : null}

            <Group title="Offers">
              <Checkbox checked={form.oneOffer} onChange={(x) => isDraft && set('oneOffer', x)}><Text variant="body">One offer per student</Text><Text variant="caption" color={colors.muted}>A student with an accepted offer cannot apply to other drives, unless an exception below applies.</Text></Checkbox>
              <Checkbox checked={form.tiers} onChange={(x) => isDraft && set('tiers', x)}><Text variant="body">Dream and super dream tiers</Text><Text variant="caption" color={colors.muted}>A higher tier drive stays open to students placed in a lower tier.</Text></Checkbox>
              {form.tiers ? (
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1, minWidth: 140 }}><TextField label="Dream from (LPA)" value={form.dream} onChangeText={(t) => set('dream', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.dream} /></View>
                  <View style={{ flex: 1, minWidth: 140 }}><TextField label="Super dream from (LPA)" value={form.superDream} onChangeText={(t) => set('superDream', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.superDream} /></View>
                </View>
              ) : null}
              <Checkbox checked={form.upgrade} onChange={(x) => isDraft && set('upgrade', x)}><Text variant="body">Allow upgrade offers</Text><Text variant="caption" color={colors.muted}>Placed students may apply when the new CTC is a multiple of their best accepted CTC.</Text></Checkbox>
              {form.upgrade ? <TextField label="Multiplier (1.1 to 5)" value={form.multiplier} onChangeText={(t) => set('multiplier', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.multiplier} /> : null}
            </Group>

            <Group title="Default eligibility">
              <Text variant="caption" color={colors.muted}>Applied only where a drive does not set its own value. Leave blank for no default.</Text>
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}><TextField label="Minimum CGPA" value={form.minCgpa} onChangeText={(t) => set('minCgpa', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.minCgpa} /></View>
                <View style={{ flex: 1, minWidth: 140 }}><TextField label="Max active backlogs" value={form.maxActiveBacklogs} onChangeText={(t) => set('maxActiveBacklogs', t.replace(/\D/g, ''))} keyboardType="number-pad" editable={isDraft} error={errs.maxActiveBacklogs} /></View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}><TextField label="Minimum 10th %" value={form.min10th} onChangeText={(t) => set('min10th', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.min10th} /></View>
                <View style={{ flex: 1, minWidth: 140 }}><TextField label="Minimum 12th %" value={form.min12th} onChangeText={(t) => set('min12th', t)} keyboardType="decimal-pad" editable={isDraft} error={errs.min12th} /></View>
              </View>
              <TextField label="Max gap years" value={form.maxGapYears} onChangeText={(t) => set('maxGapYears', t.replace(/\D/g, ''))} keyboardType="number-pad" editable={isDraft} error={errs.maxGapYears} />
              <Checkbox checked={form.requireVerified} onChange={(x) => isDraft && set('requireVerified', x)}>
                <Text variant="body">Require verified academics</Text><Text variant="caption" color={colors.muted}>Criteria that are met but not verified show as pending.</Text>
              </Checkbox>
              {aiOn && isDraft ? <Button label="Draft defaults with AI" icon="auto-awesome" variant="secondary" full onPress={() => setAiOpen(true)} /> : null}
            </Group>

            <Group title="Notes and timing">
              <TextField label="Version note" value={note} onChangeText={(t) => { setNote(t); setDirty(true); }} multiline maxLength={300} editable={isDraft} helper="Shown in the version history." />
              <TextField label="Policy notes" value={form.notes} onChangeText={(t) => set('notes', t)} multiline maxLength={1000} editable={isDraft} error={errs.notes} />
              <DateTimeFields label="Effective from (optional)" date={eDate} time={eTime} onDate={(t) => { setEDate(t); setDirty(true); }} onTime={(t) => { setETime(t); setDirty(true); }} error={errs.effective}
                helper="Leave blank to take effect on activation. A future date schedules it." />
            </Group>

            <Group title="Check this version">
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}><Button label="Validate" icon="rule" variant="secondary" full loading={validating} onPress={() => doValidate()} /></View>
                <View style={{ flex: 1, minWidth: 140 }}><Button label="Simulate impact" icon="science" variant="secondary" full loading={simulating} onPress={() => doSimulate()} /></View>
              </View>
              {validation ? (
                validation.valid ? <Banner tone="success" message="This policy is valid." /> : (
                  <Banner tone="error" title="Fix these first" message={validation.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('\n')} />
                )
              ) : null}
              {validation?.warnings?.length ? <Banner tone="warning" title="Warnings" message={validation.warnings.join('\n')} /> : null}
              {simErr ? <Banner tone="error" message={simErr} /> : null}
              {sim ? <SimulationView sim={sim} /> : null}
            </Group>
          </>
        ) : null}
      </Async>

      <Sheet visible={actOpen} onClose={() => setActOpen(false)} title={future ? 'Schedule activation' : 'Activate policy'}>
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Text variant="body" color={colors.textSecondary}>
            {future ? `Takes effect ${formatDateTimeIST(v?.effectiveFrom)}.` : 'Takes effect immediately for new eligibility checks.'} Existing applications keep the policy version they were checked with.
          </Text>
          {!actSim && !actErr ? <Text variant="body" color={colors.muted}>Checking the impact on open drives…</Text> : null}
          {actSim ? <SimulationView sim={actSim} /> : null}
          {actErr ? <Banner tone="error" message={actErr} action={!actSim ? { label: 'Retry preview', onPress: () => void openActivate() } : undefined} /> : null}
          <Button label={future ? 'Schedule' : 'Activate now'} full loading={activating} disabled={!actSim} onPress={() => doActivate()} />
          <Button label="Cancel" variant="secondary" full onPress={() => setActOpen(false)} />
        </View>
      </Sheet>

      {form ? <AiDraftSheet visible={aiOpen} onClose={() => setAiOpen(false)} onUse={(r) => {
        setForm((f) => (f ? {
          ...f,
          minCgpa: r.minCgpa != null ? String(r.minCgpa) : f.minCgpa, min10th: r.min10th != null ? String(r.min10th) : f.min10th,
          min12th: r.min12th != null ? String(r.min12th) : f.min12th, maxActiveBacklogs: r.maxActiveBacklogs != null ? String(r.maxActiveBacklogs) : f.maxActiveBacklogs,
          maxGapYears: r.maxGapYears != null ? String(r.maxGapYears) : f.maxGapYears,
        } : f));
        setDirty(true); setValidation(null); setSim(null); setAiOpen(false); toast.show('AI values added. Review, then simulate before saving.', 'info');
      }} /> : null}
    </OpsPage>
  );
}

/** Impact preview: current vs candidate eligibility across open drives. */
function SimulationView({ sim }: { sim: SimulateResult }) {
  const max = Math.max(1, sim.current.eligible + sim.current.notEligible + sim.current.pending + sim.current.restricted, sim.candidate.eligible + sim.candidate.notEligible + sim.candidate.pending + sim.candidate.restricted);
  return (
    <View style={{ gap: 12 }}>
      <Text variant="subhead">Impact on {sim.drives} open {sim.drives === 1 ? 'drive' : 'drives'}</Text>
      <Text variant="caption" color={colors.muted}>Counts are student and drive pairs. Nothing has been changed.</Text>
      <Text variant="overline" color={colors.muted}>Now</Text>
      <Counts c={sim.current} max={max} />
      <Text variant="overline" color={colors.muted}>With this version</Text>
      <Counts c={sim.candidate} max={max} />
      <View>
        <MetricRow label="Newly eligible" value={sim.diff.newlyEligible} tone={sim.diff.newlyEligible ? 'success' : undefined} />
        <MetricRow label="Newly not eligible" value={sim.diff.newlyIneligible} tone={sim.diff.newlyIneligible ? 'error' : undefined} />
        <MetricRow label="Newly pending" value={sim.diff.newlyPending} tone={sim.diff.newlyPending ? 'warning' : undefined} />
        <MetricRow label="Unchanged" value={sim.diff.unchanged} last />
      </View>
      {sim.perReason.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="overline" color={colors.muted}>Why students fail or are pending</Text>
          {sim.perReason.map((r) => <MetricRow key={r.criterion} label={r.criterion} value={`${r.failed} failed`} hint={`${r.missing} missing data`} />)}
        </View>
      ) : null}
      {sim.samples.newlyIneligible.length ? (
        <View style={{ gap: 4 }}>
          <Text variant="overline" color={colors.muted}>Examples of newly not eligible</Text>
          {sim.samples.newlyIneligible.map((s, i) => <Text key={`${s.studentId}${i}`} variant="caption" color={colors.textSecondary}>{`• ${s.name}: ${s.reason}`}</Text>)}
        </View>
      ) : null}
      {sim.samples.newlyEligible.length ? (
        <View style={{ gap: 4 }}>
          <Text variant="overline" color={colors.muted}>Examples of newly eligible</Text>
          {sim.samples.newlyEligible.map((s, i) => <Text key={`${s.studentId}${i}`} variant="caption" color={colors.textSecondary}>{`• ${s.name}: ${s.reason}`}</Text>)}
        </View>
      ) : null}
    </View>
  );
}
function Counts({ c, max }: { c: SimulateResult['current']; max: number }) {
  return (
    <View style={{ gap: 8 }}>
      <BarRow label="Eligible" value={c.eligible} max={max} tone="success" />
      <BarRow label="Not eligible" value={c.notEligible} max={max} tone="warning" />
      <BarRow label="Pending" value={c.pending} max={max} tone="info" />
      {c.restricted ? <BarRow label="Restricted" value={c.restricted} max={max} /> : null}
    </View>
  );
}

function AiDraftSheet({ visible, onClose, onUse }: { visible: boolean; onClose: () => void; onUse: (r: AiPolicyDraft['rules']) => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<AiPolicyDraft | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [gen, busy] = useOnce(async () => {
    setErr(null);
    try { setRes(await aiPolicyDraft(text.trim())); } catch (e) { setErr(e); }
  });
  const ok = text.trim().length >= 5 && text.trim().length <= 1000;
  const r = res?.rules;
  const lines = useMemo(() => {
    if (!r) return [];
    const L: { label: string; value: string }[] = [];
    if (r.minCgpa != null) L.push({ label: 'Minimum CGPA', value: String(r.minCgpa) });
    if (r.min10th != null) L.push({ label: 'Minimum 10th %', value: String(r.min10th) });
    if (r.min12th != null) L.push({ label: 'Minimum 12th %', value: String(r.min12th) });
    if (r.maxActiveBacklogs != null) L.push({ label: 'Max active backlogs', value: String(r.maxActiveBacklogs) });
    if (r.maxGapYears != null) L.push({ label: 'Max gap years', value: String(r.maxGapYears) });
    return L;
  }, [r]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Draft defaults with AI">
      <View style={{ gap: 16, paddingBottom: 16 }}>
        <TextField label="What should the defaults be?" value={text} onChangeText={setText} multiline maxLength={1000} placeholder="Students need at least 6.5 CGPA and no active backlogs" helper="AI only suggests numbers. You review and simulate before anything is saved." />
        {err ? <AiErrorBanner error={err} onRetry={() => gen()} /> : null}
        <Button label={res ? 'Regenerate' : 'Generate draft'} icon="auto-awesome" full variant={res ? 'secondary' : 'primary'} disabled={!ok} loading={busy} onPress={() => gen()} />
        {res ? (
          <View style={{ gap: 12 }}>
            <Banner tone="warning" title="AI draft: review before use" message="This is not approved or saved. It only fills the default fields in this draft." />
            <Text variant="body">{res.explanation}</Text>
            {lines.length ? <KeyValueList items={lines} inline /> : <Text variant="body" color={colors.muted}>No default values were suggested.</Text>}
            {res.unsupported?.length || r?.allowedDepartments?.length || r?.allowedBatches?.length ? (
              <Banner tone="info" title="Not applied here" message={[...(res.unsupported ?? []), r?.allowedDepartments?.length ? 'Department limits belong on each drive.' : '', r?.allowedBatches?.length ? 'Batch limits belong on each drive.' : ''].filter(Boolean).join('\n')} />
            ) : null}
            {res.simulation ? <Text variant="caption" color={colors.muted}>AI estimate across current students: {res.simulation.eligible} eligible, {res.simulation.not_eligible} not eligible, {res.simulation.pending} pending.</Text> : null}
            <Button label="Use these values" full disabled={lines.length === 0} onPress={() => onUse(res.rules)} />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
