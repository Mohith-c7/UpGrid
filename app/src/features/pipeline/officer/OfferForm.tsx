import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Select, Sheet, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { pipeCode, pipeError, useOfferActions, useSelectedCandidates } from '@/api/pipeline';
import type { OfferBody } from '@/api/pipelineTypes';
import { validateText } from '@/lib/validation';
import { nowISTParts, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, useISTPicker } from '@/features/officer/components/pickers';
import { Boundary, confirm, sp, useOnce } from '../kit';
import { PolicyBanner } from './PolicyBanner';

const EXPIRY = [{ value: '3', label: '3 days' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '60', label: '60 days' }];
const pad = (n: number) => String(n).padStart(2, '0');

function inDays(d: number): ISTParts {
  const n = nowISTParts(getServerOffsetMs());
  const t = new Date(Date.UTC(n.y, n.m - 1, n.d + d, 10, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 10, mm: 0 };
}
const money = (s: string): number | null | undefined => {
  const t = s.trim();
  if (!t) return undefined;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
};

/** Create an offer for a selected candidate. Check the placement policy first; officers' offers are issued to the student immediately. */
export function OfferForm({ driveId, visible, onClose, onSaved }: { driveId: string; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const cands = useSelectedCandidates(driveId, visible);
  const { create, policyCheck } = useOfferActions(driveId);
  const [appId, setAppId] = useState('');
  const [fixed, setFixed] = useState(''); const [variable, setVariable] = useState(''); const [bonus, setBonus] = useState(''); const [joiningBonus, setJoiningBonus] = useState('');
  const [esop, setEsop] = useState(''); const [location, setLocation] = useState(''); const [notes, setNotes] = useState(''); const [override, setOverride] = useState('');
  const [join, setJoin] = useState<ISTParts>(() => inDays(30)); const [expiry, setExpiry] = useState('14');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<{ result: string; reasons: { code: string; message: string }[]; tier?: string } | null>(null);
  const picker = useISTPicker(join, setJoin);
  useEffect(() => {
    if (!visible) return;
    setAppId(''); setFixed(''); setVariable(''); setBonus(''); setJoiningBonus(''); setEsop(''); setLocation(''); setNotes(''); setOverride(''); setJoin(inDays(30)); setExpiry('14');
    setErrors({}); setFormError(null); setPolicy(null);
  }, [visible]);

  const options = useMemo(() => (cands.data ?? []).filter((c) => !c.hasOffer).map((c) => ({ value: c.applicationId, label: `${c.candidate.name} (${c.reference})` })), [cands.data]);

  const build = (): { body: OfferBody | null; errs: Record<string, string> } => {
    const errs: Record<string, string> = {};
    if (!appId) errs.appId = 'Choose a candidate';
    const f = money(fixed); const v = money(variable); const b = money(bonus); const jb = money(joiningBonus);
    if (f === undefined || f === null || f <= 0) errs.fixed = 'Enter fixed pay greater than 0 (up to 2 decimals)';
    if (v === null) errs.variable = 'Enter a valid amount'; if (b === null) errs.bonus = 'Enter a valid amount'; if (jb === null) errs.joiningBonus = 'Enter a valid amount';
    const loc = location.trim(); if (loc.length < 2 || loc.length > 120) errs.location = 'Location must be 2 to 120 characters';
    const nt = validateText(notes, { max: 500 }); if (!nt.ok) errs.notes = nt.error;
    if (esop.trim().length > 200) errs.esop = 'ESOP note is too long';
    if (override.trim() && (override.trim().length < 10 || override.trim().length > 300)) errs.override = 'Override reason must be 10 to 300 characters';
    if (Object.keys(errs).length) return { body: null, errs };
    const n = nowISTParts(getServerOffsetMs());
    const joinMs = Date.UTC(join.y, join.m - 1, join.d);
    if (joinMs <= Date.UTC(n.y, n.m - 1, n.d)) return { body: null, errs: { join: 'Joining date must be in the future' } };
    const body: OfferBody = {
      ctc: { fixedLpa: f as number, ...(v ? { variableLpa: v } : {}), ...(b ? { bonusLpa: b } : {}), ...(jb ? { joiningBonusLpa: jb } : {}), ...(esop.trim() ? { esopNote: esop.trim() } : {}) },
      joiningDate: `${join.y}-${pad(join.m)}-${pad(join.d)}`, location: loc,
      expiresAt: new Date(Date.now() + getServerOffsetMs() + Number(expiry) * 86400_000).toISOString(),
      ...(notes.trim() ? { notes: notes.trim() } : {}), ...(override.trim() ? { overrideReason: override.trim() } : {}),
    };
    return { body, errs };
  };

  const [check, checking] = useOnce(async () => {
    const { body, errs } = build();
    // Policy only needs candidate + pay
    const f = money(fixed);
    if (!appId || f === undefined || f === null || f <= 0) { setErrors({ ...errs, ...(appId ? {} : { appId: 'Choose a candidate' }), ...(f ? {} : { fixed: 'Enter fixed pay first' }) }); return; }
    setErrors({}); setFormError(null);
    try { setPolicy((await policyCheck.mutateAsync({ applicationId: appId, ctc: body?.ctc ?? { fixedLpa: f } })).policy); }
    catch (e) { setFormError(pipeError(e)); }
  });

  const [submit, busy] = useOnce(async () => {
    const { body, errs } = build();
    setErrors(errs);
    if (!body) return;
    setFormError(null);
    try { await create.mutateAsync({ applicationId: appId, body }); onSaved(); }
    catch (e: any) {
      const code = pipeCode(e);
      if (code === 'OFFER_BLOCKED_BY_POLICY' || code === 'OVERRIDE_REQUIRED') void check();
      const f = e?.fields as Record<string, string> | undefined;
      setFormError([pipeError(e), f?.policy].filter(Boolean).join(' '));
    }
  });
  const ask = () => {
    const { body, errs } = build();
    setErrors(errs);
    if (!body) return;
    confirm('Issue this offer?', 'As an officer, this issues the offer to the student straight away. They are notified and the response clock starts.', 'Issue offer', () => { void submit(); }, false);
  };

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="New offer">
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        <Boundary isLoading={cands.isLoading} isError={cands.isError} error={cands.error} onRetry={() => { void cands.refetch(); }} rows={2} height={60}
          isEmpty={options.length === 0} empty={{ icon: 'person-search', title: 'No candidates ready', message: 'Offers can be made for candidates in Selected status who have no open offer. Approve a select proposal or move a candidate to Selected first.' }}>
          <Select label="Candidate" value={appId} onChange={(v) => { setAppId(v); setPolicy(null); setErrors((x) => ({ ...x, appId: '' })); }} options={options} error={errors.appId || null} placeholder="Choose a selected candidate" />
          <TextField label="Fixed pay (LPA)" value={fixed} onChangeText={(t) => { setFixed(t); setPolicy(null); setErrors((x) => ({ ...x, fixed: '' })); }} keyboardType="decimal-pad" error={errors.fixed || null} helper="For stipend drives enter rupees per month" />
          <TextField label="Variable pay (LPA, optional)" value={variable} onChangeText={(t) => { setVariable(t); setPolicy(null); }} keyboardType="decimal-pad" error={errors.variable || null} />
          <TextField label="Bonus (LPA, optional)" value={bonus} onChangeText={(t) => { setBonus(t); setPolicy(null); }} keyboardType="decimal-pad" error={errors.bonus || null} />
          <TextField label="Joining bonus (LPA, optional)" value={joiningBonus} onChangeText={(t) => { setJoiningBonus(t); setPolicy(null); }} keyboardType="decimal-pad" error={errors.joiningBonus || null} />
          <TextField label="ESOP note (optional)" value={esop} onChangeText={setEsop} maxLength={200} error={errors.esop || null} />
          <PickerRow label="Joining date (IST)" icon="event" value={dateLabel(join)} error={errors.join || null} onPress={() => picker.open('date')} />
          {picker.iosPicker}
          {errors.join ? <Text variant="caption" color={colors.error}>{errors.join}</Text> : null}
          <TextField label="Location" value={location} onChangeText={(t) => { setLocation(t); setErrors((x) => ({ ...x, location: '' })); }} maxLength={120} error={errors.location || null} />
          <Select label="Offer valid for" value={expiry} onChange={setExpiry} options={EXPIRY} />
          <TextField label="Notes for the student (optional)" value={notes} onChangeText={setNotes} multiline maxLength={500} error={errors.notes || null} />
          {policy ? <PolicyBanner policy={policy as never} /> : null}
          {policy?.result === 'needs_override' ? (
            <TextField label="Override reason" value={override} onChangeText={(t) => { setOverride(t); setErrors((x) => ({ ...x, override: '' })); }} multiline maxLength={300} error={errors.override || null} helper="10 to 300 characters. Recorded in the audit log." />
          ) : null}
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label="Check placement policy" variant="secondary" icon="policy" full loading={checking} onPress={() => check()} />
          <Button label="Issue offer" full loading={busy} disabled={policy?.result === 'blocked'} onPress={ask} />
        </Boundary>
      </View>
    </Sheet>
  );
}
