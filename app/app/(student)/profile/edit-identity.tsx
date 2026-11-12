import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip, EmailField, PhoneField, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { normalizeSpaces, validateEmail, validateName, validatePhone, validateRegNo, validateText } from '@/lib/validation';
import { errCode, errFields, errMessage, useProfileFull, useSaveProfile, useUpdateMe, type ProfileFull } from '@/features/student/me/data';
import { makeResolver, Page, QueryBoundary, RHFText, sp, useBack, useOnce, useUnsavedGuard, VerificationBadge } from '@/features/student/me/kit';

interface FV { registrationNumber: string; preferredName: string; city: string; state: string; skills: string; roles: string }

const splitList = (s: string) => Array.from(new Set(s.split(',').map((x) => normalizeSpaces(x)).filter(Boolean)));
const WORK_MODES = [['onsite', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote'], ['any', 'Any']] as const;

const resolver = makeResolver<FV>({
  registrationNumber: (v) => { const r = validateRegNo(v ?? ''); return r.ok ? null : r.error; },
  preferredName: (v) => { if (!(v ?? '').trim()) return null; const r = validateName(v); return r.ok ? null : r.error; },
  city: (v) => { const r = validateText(v ?? '', { max: 60, label: 'City' }); return r.ok ? (/^[\p{L}\p{M} .'-]*$/u.test(r.value) ? null : "Use only letters, spaces and . ' -") : r.error; },
  state: (v) => { const r = validateText(v ?? '', { max: 60, label: 'State' }); return r.ok ? (/^[\p{L}\p{M} .'-]*$/u.test(r.value) ? null : "Use only letters, spaces and . ' -") : r.error; },
  skills: (v) => {
    const l = splitList(v ?? '');
    if (l.length > 30) return 'Add at most 30 skills';
    if (l.some((x) => x.length > 40)) return 'Each skill must be 40 characters or fewer';
    return /[\u0000-\u001F]/.test(v ?? '') ? 'Contains invalid characters' : null;
  },
  roles: (v) => {
    const l = splitList(v ?? '');
    if (l.length > 10) return 'Add at most 10 roles';
    if (l.some((x) => x.length > 60)) return 'Each role must be 60 characters or fewer';
    return null;
  },
});

function IdentityForm({ p }: { p: ProfileFull }) {
  const router = useRouter(); void router;
  const goBack = useBack('/(student)/(tabs)/profile');
  const toast = useToast();
  const save = useSaveProfile();
  const updateMe = useUpdateMe();
  // Contact details (PATCH /me). `base` is what the server has; it moves forward after a successful save.
  const [base, setBase] = useState({ name: p.user?.name ?? '', email: p.user?.email ?? '', phone: (p.user?.phone ?? '').replace(/\D/g, '').slice(-10) });
  const [name, setName] = useState(base.name);
  const [email, setEmail] = useState(base.email);
  const [phone, setPhone] = useState(base.phone);
  const [contactTouched, setContactTouched] = useState({ name: false, email: false, phone: false });
  const touch = (k: 'name' | 'email' | 'phone') => setContactTouched((t) => ({ ...t, [k]: true }));
  const nameR = validateName(name);
  const emailR = validateEmail(email);
  const phoneR = validatePhone(phone);
  const nameChanged = normalizeSpaces(name) !== base.name;
  const emailChanged = emailR.ok ? emailR.value !== base.email.toLowerCase() : email.trim() !== base.email;
  const phoneChanged = phone !== base.phone;
  const contactDirty = nameChanged || emailChanged || phoneChanged;
  const [workMode, setWorkMode] = useState<string | null>(p.preferences?.workMode ?? null);
  const [relocate, setRelocate] = useState<boolean | null>(p.preferences?.relocate ?? null);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const { control, handleSubmit, formState } = useForm<FV>({
    resolver, mode: 'onBlur',
    defaultValues: {
      registrationNumber: p.identity?.registrationNumber ?? '', preferredName: p.identity?.preferredName ?? '',
      city: p.contact?.city ?? '', state: p.contact?.state ?? '',
      skills: (p.skills ?? []).join(', '), roles: (p.preferences?.roles ?? []).join(', '),
    },
  });
  const dirty = contactDirty || formState.isDirty || workMode !== (p.preferences?.workMode ?? null) || relocate !== (p.preferences?.relocate ?? null);
  const { allowLeave } = useUnsavedGuard(dirty);
  const regVerified = p.verification?.['identity.registrationNumber'];

  const [submit, busy] = useOnce(async (v: FV) => {
    setServerErr({});
    const reg = validateRegNo(v.registrationNumber);
    const nameV = nameR.ok ? nameR.value : '';
    const emailV = emailR.ok ? emailR.value : '';
    const phoneV = phoneR.ok ? phoneR.value : '';
    if (contactDirty) {
      setContactTouched({ name: true, email: true, phone: true });
      // only the fields that changed must be valid: an old value that no longer passes a rule must not block saving another field
      if ((nameChanged && !nameR.ok) || (emailChanged && !emailR.ok) || (phoneChanged && !phoneR.ok)) { toast.show('Fix the highlighted fields', 'error'); return; }
      try {
        const body: { name?: string; email?: string; phone?: string } = {};
        if (nameChanged) body.name = nameV;
        if (emailChanged) body.email = emailV;
        if (phoneChanged) body.phone = phoneV;
        const u = await updateMe.mutateAsync(body);
        setBase({ name: u?.name ?? (nameChanged ? nameV : base.name), email: u?.email ?? (emailChanged ? emailV : base.email), phone: phoneChanged ? phoneV : base.phone });
        if (u?.name) setName(u.name);
        if (u?.email) setEmail(u.email);
      } catch (e) {
        const f = errFields(e);
        if (f) setServerErr((cur) => ({ ...cur, ...f }));
        else if (errCode(e) === 'EMAIL_TAKEN') setServerErr({ email: errMessage(e) });
        else if (errCode(e) === 'PHONE_TAKEN') setServerErr({ phone: errMessage(e) });
        toast.show(errMessage(e), 'error');
        return;
      }
    }
    try {
      await save.mutateAsync({
        identity: { registrationNumber: reg.ok ? reg.value : undefined, preferredName: v.preferredName.trim() ? normalizeSpaces(v.preferredName) : null },
        contact: { city: v.city.trim() ? normalizeSpaces(v.city) : null, state: v.state.trim() ? normalizeSpaces(v.state) : null },
        skills: splitList(v.skills),
        preferences: { roles: splitList(v.roles), workMode: workMode as any, relocate },
      });
      toast.show('Saved', 'success');
      allowLeave();
      goBack();
    } catch (e) {
      const f = errFields(e);
      if (f) {
        const m: Record<string, string> = {};
        for (const [k, msg] of Object.entries(f)) m[k.split('.').pop()!] = msg;
        setServerErr(m);
      } else if (errCode(e) === 'CONFLICT' || (e as any)?.status === 409) {
        setServerErr({ registrationNumber: errMessage(e) });
      }
      toast.show(errMessage(e), 'error');
    }
  });

  return (
    <Page
      title="Identity and location"
      onBack={goBack}
      keyboard
      gap={sp.xl}
      footer={<Button label="Save changes" full loading={busy} disabled={!dirty} onPress={handleSubmit(submit, () => { setContactTouched({ name: true, email: true, phone: true }); toast.show('Fix the highlighted fields', 'error'); })} />}
    >
      <Card>
        <View style={{ gap: sp.lg }}>
          <Text variant="subhead">Contact details</Text>
          <TextField
            label="Full name" value={name} onChangeText={(t) => { setName(t); setServerErr((e) => ({ ...e, name: '' })); }} maxLength={80}
            autoComplete="name" textContentType="name" onBlur={() => touch('name')}
            error={serverErr.name || (contactTouched.name && !nameR.ok ? nameR.error : null)}
          />
          <EmailField
            value={email} onChangeText={(t) => { setEmail(t); setServerErr((e) => ({ ...e, email: '' })); }} onBlur={() => touch('email')}
            error={serverErr.email || (contactTouched.email && !emailR.ok ? emailR.error : null)}
          />
          <PhoneField
            value={phone} onChangeText={(t) => { setPhone(t); setServerErr((e) => ({ ...e, phone: '' })); }} onBlur={() => touch('phone')}
            error={serverErr.phone || (contactTouched.phone && !phoneR.ok ? phoneR.error : null)}
          />
          <Text variant="caption" color={colors.muted}>
            If you change your email it becomes unverified and we send a 6-digit code to the new address. Your email is also your sign-in, so use one you can open.
          </Text>
        </View>
      </Card>

      <Card>
        <View style={{ gap: sp.lg }}>
          <Text variant="subhead">Identity</Text>
          <RHFText control={control} name="registrationNumber" label="Registration number" helper="5-20 characters: letters, numbers, / and -" maxLength={20} serverError={serverErr.registrationNumber} />
          <View style={{ gap: sp.xs }}>
            <VerificationBadge v={regVerified} />
            {regVerified === 'verified' ? <Text variant="caption" color={colors.warning}>Changing it resets verification.</Text> : null}
          </View>
          <RHFText control={control} name="preferredName" label="Preferred name (optional)" maxLength={80} serverError={serverErr.preferredName} />
          <RHFText control={control} name="city" label="City" maxLength={60} serverError={serverErr.city} />
          <RHFText control={control} name="state" label="State" maxLength={60} serverError={serverErr.state} />
        </View>
      </Card>

      <Card>
        <View style={{ gap: sp.lg }}>
          <Text variant="subhead">Preferences</Text>
          <RHFText control={control} name="skills" label="Skills" helper="Separate with commas, up to 30" multiline maxLength={800} serverError={serverErr.skills} />
          <RHFText control={control} name="roles" label="Roles you want" helper="Separate with commas, up to 10" maxLength={400} serverError={serverErr.roles} />
          <View style={{ gap: sp.xs }}>
            <Text variant="caption" color={colors.muted}>Work mode</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {WORK_MODES.map(([k, l]) => <Chip key={k} label={l} selected={workMode === k} onPress={() => setWorkMode(workMode === k ? null : k)} />)}
            </View>
          </View>
          <View style={{ gap: sp.xs }}>
            <Text variant="caption" color={colors.muted}>Willing to relocate</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <Chip label="Yes" selected={relocate === true} onPress={() => setRelocate(relocate === true ? null : true)} />
              <Chip label="No" selected={relocate === false} onPress={() => setRelocate(relocate === false ? null : false)} />
            </View>
          </View>
        </View>
      </Card>
    </Page>
  );
}

export default function EditIdentity() {
  const q = useProfileFull();
  const back = useBack('/(student)/(tabs)/profile');
  if (q.data) return <IdentityForm p={q.data} />;
  return (
    <Page title="Identity and location" onBack={back}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} skeletonRows={3} skeletonHeight={200}>
        {null}
      </QueryBoundary>
    </Page>
  );
}
