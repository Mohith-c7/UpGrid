import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, EmailField, EmptyState, OfflineBanner, Screen, ScreenHero, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { useSession } from '@/state/session';
import { useFeatures } from '@/config/features';
import { patchMe, sendEmailVerification, verifyEmailCode } from '@/api/integrations';
import type { AuthUser } from '@/api/integrationsTypes';
import { ApiError } from '@/api/client';
import { suggestEmailFix, validateEmail } from '@/lib/validation';
import { authErrorMessage } from '@/features/auth/errors';
import { ExpiryLine, OtpField, ResendButton } from '@/features/auth/otp';
import { postAuth } from '@/features/auth/postAuth';

const CODE_TTL_S = 600;
const COOLDOWN_S = 60;
const MAX_ATTEMPTS = 5;

export default function VerifyEmail() {
  const router = useRouter();
  const toast = useToast();
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();
  const s = useSession();
  const user = s.user as AuthUser | null;
  const { flags, status: cfgStatus, refetch } = useFeatures();

  const now = Date.now();
  const [expiresAt, setExpiresAt] = useState<number | null>(fresh === '1' ? now + CODE_TTL_S * 1000 : null);
  const [resendAt, setResendAt] = useState<number | null>(fresh === '1' ? now + COOLDOWN_S * 1000 : null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(fresh === '1' ? MAX_ATTEMPTS : null);
  const [locked, setLocked] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newEmailError, setNewEmailError] = useState<string | null>(null);
  const busy = useRef(false);

  const leave = () => {
    postAuth.dismissVerify();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (!user) return null;

  if (user.emailVerified === true) {
    return (
      <Screen scroll edges={['bottom']}>
        <ScreenHero title="Email verified" subtitle={user.email}>
          <Card padding={20} style={{ gap: 16 }}>
            <EmptyState icon="verified" title="Your email is verified" message="You can apply to drives and receive updates." actionLabel="Continue" onAction={leave} />
          </Card>
        </ScreenHero>
      </Screen>
    );
  }

  if (cfgStatus === 'ready' && !flags.emailVerification) {
    return (
      <Screen scroll edges={['bottom']}>
        <ScreenHero title="Verify your email" onBack={leave}>
          <Card padding={20}>
            <EmptyState icon="mail-outline" title="Email codes are not available" message="The server cannot send email right now, so there is nothing to verify. You can keep using the app." actionLabel="Back" onAction={leave} />
          </Card>
        </ScreenHero>
      </Screen>
    );
  }

  const noteSent = (r: { expiresInSeconds?: number; resendAfterSeconds?: number }) => {
    setExpiresAt(Date.now() + (r.expiresInSeconds ?? CODE_TTL_S) * 1000);
    setResendAt(Date.now() + (r.resendAfterSeconds ?? COOLDOWN_S) * 1000);
    setAttemptsLeft(MAX_ATTEMPTS);
    setLocked(false);
    setCode('');
    setCodeError(null);
  };

  const submit = async () => {
    if (busy.current) return;
    setFormError(null);
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code from your email');
      return;
    }
    busy.current = true;
    try {
      await verifyEmailCode(code);
      postAuth.dismissVerify();
      toast.show('Email verified', 'success');
      router.replace('/');
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      if (c === 'INVALID_CODE') {
        if (attemptsLeft !== null) {
          const left = attemptsLeft - 1;
          setAttemptsLeft(left);
          if (left <= 0) {
            setLocked(true);
            setCodeError('Too many wrong codes. Request a new code to try again.');
          } else setCodeError(`That code is not correct. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
        } else setCodeError('That code is not correct, or it was replaced by a newer one.');
      } else if (c === 'CODE_EXPIRED') {
        setExpiresAt(Date.now());
        setCodeError('This code has expired. Request a new one.');
      } else if (c === 'TOO_MANY_ATTEMPTS') {
        setLocked(true);
        setAttemptsLeft(0);
        setCodeError('Too many wrong codes. Request a new code to try again.');
      } else if (c === 'VALIDATION_ERROR') {
        setCodeError('Enter the 6-digit code from your email');
      } else {
        setFormError(authErrorMessage(e));
        if (c === 'EMAIL_NOT_CONFIGURED') void refetch();
      }
    } finally {
      busy.current = false;
    }
  };

  const resend = async () => {
    if (busy.current) return;
    busy.current = true;
    setFormError(null);
    try {
      const r = await sendEmailVerification();
      if (r.alreadyVerified) {
        toast.show('Your email is already verified', 'success');
        postAuth.dismissVerify();
        router.replace('/');
        return;
      }
      noteSent(r);
      toast.show('A new code is on its way', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESEND_COOLDOWN') {
        setResendAt(Date.now() + (e.retryAfterSeconds ?? COOLDOWN_S) * 1000);
        setFormError('Please wait a moment before requesting another code.');
      } else setFormError(authErrorMessage(e));
    } finally {
      busy.current = false;
    }
  };

  const saveEmail = async () => {
    if (busy.current) return;
    const v = validateEmail(newEmail);
    if (!v.ok) {
      setNewEmailError(v.error);
      return;
    }
    if (v.value === user.email.toLowerCase()) {
      setNewEmailError('This is already your email address');
      return;
    }
    busy.current = true;
    setNewEmailError(null);
    try {
      await patchMe({ email: v.value });
      setChanging(false);
      setNewEmail('');
      // the server cleared emailVerified and sent a fresh code (when mail is available)
      noteSent({});
      toast.show('Email updated. We sent a new code.', 'success');
    } catch (e) {
      setNewEmailError(e instanceof ApiError && e.fields?.email ? e.fields.email : authErrorMessage(e));
    } finally {
      busy.current = false;
    }
  };

  const typo = suggestEmailFix(user.email);

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero title="Verify your email" subtitle="Enter the 6-digit code we emailed you." onBack={leave}>
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          <View style={{ gap: 4 }}>
            <Text variant="caption" color={colors.muted}>Code sent to</Text>
            <Text variant="subhead" style={{ flexShrink: 1 }}>{user.email}</Text>
          </View>
          {typo ? (
            <Banner
              tone="warning"
              title="Check your email address"
              message={`Did you mean ${typo}? Codes sent to a wrong address never arrive.`}
              action={{ label: `Use ${typo}`, onPress: () => { setChanging(true); setNewEmail(typo); } }}
            />
          ) : null}
          <OtpField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} editable={!locked} onSubmit={submit} />
          <ExpiryLine expiresAt={expiresAt} />
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label="Verify email" full onPress={submit} disabled={locked} />
          <ResendButton resendAt={resendAt} onResend={resend} />
          {changing ? (
            <View style={{ gap: 12 }}>
              <EmailField label="Correct email address" value={newEmail} onChangeText={(t) => { setNewEmail(t); setNewEmailError(null); }} error={newEmailError} />
              <Button label="Save and send new code" full onPress={saveEmail} />
              <Button label="Cancel" variant="ghost" full onPress={() => { setChanging(false); setNewEmailError(null); }} />
            </View>
          ) : (
            <Button label="Wrong email? Change it" variant="ghost" full onPress={() => setChanging(true)} />
          )}
        </Card>
      </ScreenHero>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Button label="Skip for now" variant="ghost" full onPress={leave} />
        <Text variant="caption" color={colors.muted} align="center">
          {flags.requireVerifiedEmail ? 'You will need a verified email before you can apply to drives.' : 'You can verify later from your profile.'}
        </Text>
      </View>
    </Screen>
  );
}
