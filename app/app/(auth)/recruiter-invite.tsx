import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Banner, Button, Card, Checkbox, KeyValueList, OfflineBanner, PasswordField, PhoneField, Screen, ScreenHero, Skeleton, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { ApiError, errMessage, fieldErrors } from '@/api/client';
import { lookupInvite, useRegisterRecruiter } from '@/api/recruiter';
import type { InviteInfo } from '@/api/recruiterTypes';
import { formatDateTimeIST } from '@/lib/format';
import { validateName, validatePassword, validatePhone } from '@/lib/validation';

const schema = z.object({
  name: z.string().superRefine((v, ctx) => { const r = validateName(v); if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error }); }),
  phone: z.string().superRefine((v, ctx) => { const r = validatePhone(v); if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error }); }),
  password: z.string().superRefine((v, ctx) => { const r = validatePassword(v); if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error }); }),
  acceptTerms: z.boolean().refine((v) => v === true, { message: 'You must agree to the Terms and Privacy Policy to continue' }),
});
type Form = z.infer<typeof schema>;

/** The invite may arrive as a bare token or as the full link the officer shared (...?token=abc). */
function extractToken(raw: string): string {
  const t = raw.trim();
  const m = t.match(/[?&]token=([^&#\s]+)/);
  const picked = m ? m[1] : t;
  try { return decodeURIComponent(picked); } catch { return picked; } // a stray % in pasted text must not crash the screen
}

const inviteMessage = (e: unknown) => {
  if (e instanceof ApiError && e.code === 'INVITE_EXPIRED') return 'This invite has expired. Ask the placement officer to resend it.';
  if (e instanceof ApiError && e.code === 'INVITE_INVALID') return 'This invite is not valid. It may have been used or withdrawn. Check the link or ask the officer for a new one.';
  return errMessage(e);
};

export default function RecruiterInvite() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [tokenInput, setTokenInput] = useState(typeof params.token === 'string' ? params.token : '');
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const register = useRegisterRecruiter();

  const { control, handleSubmit, setError } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', phone: '', password: '', acceptTerms: false },
    mode: 'onTouched',
  });

  const lookup = async (raw: string) => {
    const t = extractToken(raw);
    if (t.length < 8) { setLookupError('Paste the full invite code or link from your email.'); return; }
    setLooking(true); setLookupError(null);
    try {
      const inv = await lookupInvite(t);
      setToken(t); setInvite(inv);
    } catch (e) {
      setInvite(null); setToken(null); setLookupError(inviteMessage(e));
    } finally {
      setLooking(false);
    }
  };

  // opened from the invite link: look it up straight away
  useEffect(() => {
    if (typeof params.token === 'string' && params.token) void lookup(params.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  const submit = handleSubmit(async (v) => {
    if (!token) return;
    setFormError(null);
    const name = validateName(v.name); const phone = validatePhone(v.phone);
    if (!name.ok || !phone.ok) return;
    try {
      await register.mutateAsync({ inviteToken: token, name: name.value, phone: phone.value, password: v.password, acceptTerms: true });
      // the root layout routes to the recruiter area once the session is set
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'PHONE_TAKEN') { setError('phone', { type: 'server', message: 'This mobile number is already registered.' }); return; }
      if (code === 'EMAIL_TAKEN') { setFormError('An account already exists for this email. Log in instead.'); return; }
      if (code === 'INVITE_INVALID' || code === 'INVITE_EXPIRED') { setInvite(null); setToken(null); setLookupError(inviteMessage(e)); return; }
      const fe = fieldErrors(e);
      let mapped = false;
      (['name', 'phone', 'password'] as const).forEach((k) => { if (fe[k]) { setError(k, { type: 'server', message: fe[k] }); mapped = true; } });
      if (!mapped) setFormError(errMessage(e));
    }
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'));

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero title="Recruiter invite" subtitle="Join a campus drive to review candidates." onBack={back}>
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          {!invite ? (
            <>
              <TextField
                label="Invite code or link"
                value={tokenInput}
                onChangeText={(t) => { setTokenInput(t); setLookupError(null); }}
                autoCapitalize="none"
                helper="Sent to your email by the placement officer."
                error={lookupError}
                maxLength={400}
              />
              {looking ? <Skeleton height={52} radius={12} /> : null}
              <Button label="Continue" full loading={looking} disabled={!tokenInput.trim()} onPress={() => lookup(tokenInput)} />
            </>
          ) : (
            <>
              <Banner tone="success" title={`${invite.companyName}: ${invite.role}`} message="Your invite is valid. Create your recruiter account to continue." />
              <KeyValueList
                items={[
                  { label: 'Invited email', value: invite.email },
                  { label: 'Invite expires', value: formatDateTimeIST(invite.expiresAt) },
                ]}
              />
              <Text variant="caption" color={colors.muted}>The email is fixed to the invited address. Use the same email to log in later.</Text>
              <Controller control={control} name="name" render={({ field, fieldState }) => (
                <TextField label="Full name" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoComplete="name" textContentType="name" autoCapitalize="words" maxLength={80} placeholder={invite.name ?? undefined} />
              )} />
              <Controller control={control} name="phone" render={({ field, fieldState }) => (
                <PhoneField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
              )} />
              <Controller control={control} name="password" render={({ field, fieldState }) => (
                <PasswordField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} showStrength />
              )} />
              <Controller control={control} name="acceptTerms" render={({ field, fieldState }) => (
                <View style={{ gap: 4 }}>
                  <Checkbox checked={field.value} onChange={(v) => { field.onChange(v); field.onBlur(); }} error={fieldState.error?.message} accessibilityLabel="I agree to the Terms and Privacy Policy">
                    <Text variant="body">
                      I agree to the{' '}
                      <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/terms')} accessibilityRole="link">Terms</Text>
                      {' '}and{' '}
                      <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/privacy')} accessibilityRole="link">Privacy Policy</Text>
                    </Text>
                  </Checkbox>
                </View>
              )} />
              {formError ? <Banner tone="error" message={formError} /> : null}
              <Button label="Create recruiter account" full loading={register.isPending} onPress={submit} />
              <Button label="Use a different invite" variant="ghost" full onPress={() => { setInvite(null); setToken(null); }} />
            </>
          )}
        </Card>
      </ScreenHero>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Button label="Already have an account? Log in" variant="ghost" full onPress={() => router.replace('/(auth)/login')} />
      </View>
    </Screen>
  );
}
