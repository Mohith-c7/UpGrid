import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, EmptyState, Icon, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors, getServerOffsetMs } from '@/api/client';
import { useCandidate, useCreateOffer, usePolicyCheck, useRecruiterDrive } from '@/api/recruiter';
import type { OfferCtc, PolicyResult } from '@/api/recruiterTypes';
import { validateText, validateUrl } from '@/lib/validation';
import { istPartsToISO, nowISTParts, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, useISTPicker } from '@/features/officer/components/pickers';
import { can, Page, useBack } from '@/features/recruiter/kit';
import { PolicyResultBanner } from '@/features/recruiter/OfferParts';

/** LPA amounts are small (up to 4 digits); a monthly stipend in rupees needs more (e.g. 25000). */
const num = (s: string, maxInt = 4): number | null => {
  const t = s.trim();
  if (!t) return null;
  if (!new RegExp(`^\\d{1,${maxInt}}(\\.\\d{1,2})?$`).test(t)) return NaN;
  return Number(t);
};
const plusDays = (n: number, hh: number): ISTParts => {
  const p = nowISTParts(getServerOffsetMs());
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n, hh, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh, mm: 0 };
};

export default function OfferNew() {
  const { id, applicationId } = useLocalSearchParams<{ id: string; applicationId: string }>();
  const router = useRouter();
  const back = useBack(`/(recruiter)/drive/${id}/offers`);
  const toast = useToast();
  const drive = useRecruiterDrive(id);
  const cand = useCandidate(id, applicationId);
  const create = useCreateOffer(id);
  const check = usePolicyCheck();
  const stipend = drive.data?.drive.ctc?.kind === 'stipend_monthly';

  const [fixed, setFixed] = useState('');
  const [variable, setVariable] = useState('');
  const [bonus, setBonus] = useState('');
  const [joinBonus, setJoinBonus] = useState('');
  const [esop, setEsop] = useState('');
  const [location, setLocation] = useState('');
  const [joining, setJoining] = useState<ISTParts>(() => plusDays(45, 10));
  const [expires, setExpires] = useState<ISTParts>(() => plusDays(14, 18));
  const [letter, setLetter] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicyResult | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const joinPicker = useISTPicker(joining, (p) => setJoining(p));
  const expPicker = useISTPicker(expires, (p) => setExpires(p));

  const ctc = useMemo((): OfferCtc | null => {
    const f = num(fixed, stipend ? 7 : 4); const v = num(variable); const b = num(bonus); const j = num(joinBonus);
    if (f === null || Number.isNaN(f) || f <= 0) return null;
    if ([v, b, j].some((x) => x !== null && Number.isNaN(x))) return null;
    return { fixedLpa: f, ...(v ? { variableLpa: v } : {}), ...(b ? { bonusLpa: b } : {}), ...(j ? { joiningBonusLpa: j } : {}), ...(esop.trim() ? { esopNote: esop.trim() } : {}) };
  }, [fixed, variable, bonus, joinBonus, esop, stipend]);
  const total = ctc ? (ctc.fixedLpa + (ctc.variableLpa ?? 0) + (ctc.bonusLpa ?? 0) + (ctc.joiningBonusLpa ?? 0)) : null;

  // live policy check (debounced) as the amounts change; the server re-checks when the offer is created
  const seq = useRef(0);
  useEffect(() => {
    if (!ctc || !applicationId || stipend) { setPolicy(null); setPolicyError(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await check.mutateAsync({ applicationId, ctc });
        if (mine === seq.current) { setPolicy(r); setPolicyError(null); }
      } catch (e) {
        if (mine === seq.current) { setPolicy(null); setPolicyError(errMessage(e)); }
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctc, applicationId, stipend]);

  if (drive.isLoading || cand.isLoading) return <Page title="Propose offer" onBack={back}><Skeleton height={80} radius={14} /><Skeleton height={300} radius={14} /></Page>;
  if (!can(drive.data?.permissions, 'proposeOffers'))
    return <Page title="Propose offer" onBack={back}><EmptyState icon="lock-outline" title="Not allowed" message="You do not have permission to propose offers on this drive." /></Page>;
  if (cand.isError || !cand.data)
    return <Page title="Propose offer" onBack={back}><EmptyState icon="error-outline" title="Candidate not found" message={errMessage(cand.error)} actionLabel="Go back" onAction={back} /></Page>;
  if (cand.data.status !== 'selected')
    return <Page title="Propose offer" onBack={back}><Banner tone="warning" title="Candidate is not selected" message="An offer can be proposed only after the placement cell marks the candidate as selected." /></Page>;

  const blocked = policy?.result === 'blocked';

  const submit = async () => {
    const errs: Record<string, string> = {};
    const f = num(fixed, stipend ? 7 : 4);
    if (f === null || Number.isNaN(f) || f <= 0) errs.fixedLpa = stipend ? 'Enter the monthly stipend amount.' : 'Enter the fixed pay in LPA, for example 8.5.';
    ([['variable', variable], ['bonus', bonus], ['joinBonus', joinBonus]] as const).forEach(([k, v]) => { const n = num(v); if (n !== null && Number.isNaN(n)) errs[k] = 'Enter a number with up to 2 decimals.'; });
    const loc = location.trim();
    if (loc.length < 2 || loc.length > 120) errs.location = 'Location must be 2 to 120 characters.';
    const joinMs = Date.parse(istPartsToISO(joining));
    const expMs = Date.parse(istPartsToISO(expires));
    const now = Date.now() + getServerOffsetMs();
    if (joinMs <= now) errs.joiningDate = 'Joining date must be in the future.';
    if (expMs <= now) errs.expiresAt = 'Offer expiry must be in the future.';
    else if (expMs > now + 90 * 86400000) errs.expiresAt = 'Offers can stay open for at most 90 days.';
    if (letter.trim()) { const r = validateUrl(letter.trim(), 'any', false); if (!r.ok || !/^https:\/\//i.test(letter.trim())) errs.letterUrl = 'Enter an https:// link to the offer letter.'; }
    const n = validateText(notes, { max: 500 });
    if (!n.ok) errs.notes = n.error;
    setErrors(errs);
    if (Object.keys(errs).length || !ctc) return;
    setFormError(null);
    const joiningDate = `${joining.y}-${String(joining.m).padStart(2, '0')}-${String(joining.d).padStart(2, '0')}`;
    try {
      const o = await create.mutateAsync({ applicationId: applicationId!, body: { ctc, joiningDate, location: loc, expiresAt: istPartsToISO(expires), letterUrl: letter.trim() || undefined, notes: notes.trim() || undefined } });
      toast.show(o.status === 'pending_approval' ? 'Offer sent to the placement cell for approval' : 'Offer created', 'success');
      router.replace(`/(recruiter)/drive/${id}/offers` as never);
    } catch (e) {
      const fe = fieldErrors(e);
      const mapped: Record<string, string> = {};
      Object.entries(fe).forEach(([k, v]) => { if (k !== 'policy') mapped[k.replace(/^ctc\./, '')] = v; });
      setErrors(mapped);
      setFormError(fe.policy ? `${errMessage(e)} ${fe.policy}` : errMessage(e));
    }
  };

  return (
    <Page
      title="Propose offer"
      subtitle={cand.data.fields.name ?? cand.data.reference}
      onBack={back}
      keyboard
      footer={<Button label="Send for approval" full loading={create.isPending} disabled={blocked || !ctc} onPress={submit} />}
    >
      <Banner tone="info" message="The placement cell approves every offer before the student can see it." />
      <Card style={{ gap: 16 }}>
        <Text variant="subhead">{stipend ? 'Stipend' : 'Compensation (LPA)'}</Text>
        <TextField label={stipend ? 'Monthly stipend (rupees)' : 'Fixed pay (LPA)'} value={fixed} onChangeText={(t) => setFixed(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={errors.fixedLpa || null} />
        {!stipend ? (
          <>
            <TextField label="Variable pay (LPA, optional)" value={variable} onChangeText={(t) => setVariable(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={errors.variable || errors.variableLpa || null} />
            <TextField label="Bonus (LPA, optional)" value={bonus} onChangeText={(t) => setBonus(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={errors.bonus || errors.bonusLpa || null} />
            <TextField label="Joining bonus (LPA, optional)" value={joinBonus} onChangeText={(t) => setJoinBonus(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={errors.joinBonus || errors.joiningBonusLpa || null} />
            <TextField label="ESOP note (optional)" value={esop} onChangeText={setEsop} maxLength={200} multiline />
            {total !== null ? <Text variant="body" tabular style={{ fontWeight: '600' }}>Total: {total.toFixed(2)} LPA</Text> : null}
          </>
        ) : null}
      </Card>

      {stipend ? <Banner tone="info" message="Policy checks are skipped for stipend offers." /> : null}
      {!stipend && check.isPending ? <Skeleton height={64} radius={14} /> : null}
      {!stipend && policy ? <PolicyResultBanner policy={policy} /> : null}
      {!stipend && policyError ? <Banner tone="warning" title="Could not check policy" message={policyError} /> : null}
      {!stipend && !policy && !policyError && !check.isPending ? <Text variant="caption" color={colors.muted}>Enter the fixed pay to see how this offer fits the placement policy.</Text> : null}

      <Card style={{ gap: 16 }}>
        <Text variant="subhead">Terms</Text>
        <TextField label="Work location" value={location} onChangeText={setLocation} maxLength={120} error={errors.location || null} />
        <PickerRow label="Joining date (IST)" icon="event" value={dateLabel(joining)} onPress={() => joinPicker.open('date')} error={errors.joiningDate} />
        {joinPicker.iosPicker}
        {errors.joiningDate ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errors.joiningDate}</Text></View> : null}
        <PickerRow label="Offer valid until (IST)" icon="event" value={dateLabel(expires)} onPress={() => expPicker.open('date')} error={errors.expiresAt} />
        {expPicker.iosPicker}
        {errors.expiresAt ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errors.expiresAt}</Text></View> : null}
        <TextField label="Offer letter link (optional)" value={letter} onChangeText={setLetter} autoCapitalize="none" keyboardType="url" error={errors.letterUrl || null} helper="https:// link" />
        <TextField label="Notes for the placement cell (optional)" value={notes} onChangeText={setNotes} maxLength={500} multiline error={errors.notes || null} />
      </Card>
      {formError ? <Banner tone="error" message={formError} /> : null}
    </Page>
  );
}
