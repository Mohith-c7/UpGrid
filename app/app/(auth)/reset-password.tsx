import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, EmailField, OfflineBanner, PasswordField, Screen, ScreenHero, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { forgotPassword, resetPassword } from '@/api/integrations';
import { ApiError } from '@/api/client';
import { validateEmail, validatePassword } from '@/lib/validation';
import { authErrorMessage, isCode } from '@/features/auth/errors';
import { ExpiryLine, OtpField, ResendButton } from '@/features/auth/otp';
import { useTurnstile } from '@/features/auth/Turnstile';
import { useFeatures } from '@/config/features';

const CODE_TTL_S = 600;
const COOLDOWN_S = 60;
const MAX_ATTEMPTS = 5;

export default function ResetPassword() {
  const router = useRouter();
  const toast = useToast();
  const { refetch } = useFeatures();
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const ts = useTurnstile();
  const sentNow = params.sent === '1';

  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string; pw?: string; pw2?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(sentNow ? Date.now() + CODE_TTL_S * 1000 : null);
  const [resendAt, setResendAt] = useState<number | null>(sentNow ? Date.now() + COOLDOWN_S * 1000 : null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(sentNow ? MAX_ATTEMPTS : null);
  const [locked, setLocked] = useState(false);
  const [resentInfo, setResentInfo] = useState<string | null>(null);
  const busy = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'));

  const submit = async () => {
    if (busy.current) return;
    setFormError(null);
    const e: typeof errors = {};
    const ev = validateEmail(email);
    if (!ev.ok) e.email = ev.error;
    if (!/^\d{6}$/.test(code)) e.code = 'Enter the 6-digit code from your email';
    const pv = validatePassword(pw);
    if (!pv.ok) e.pw = pv.error;
    if (pv.ok && pw2 !== pw) e.pw2 = 'Passwords do not match';
    setErrors(e);
    if (Object.keys(e).length > 0 || !ev.ok) return;
    busy.current = true;
    try {
      await resetPassword(ev.value, code, pw);
      toast.show('Password updated. Log in with your new password.', 'success');
      router.replace('/(auth)/login');
    } catch (err) {
      const c = err instanceof ApiError ? err.code : '';
      if (c === 'INVALID_CODE') {
        if (attemptsLeft !== null) {
          const left = attemptsLeft - 1;
          setAttemptsLeft(left);
          if (left <= 0) {
            setLocked(true);
            setErrors({ code: 'Too many wrong codes. Request a new code to try again.' });
          } else setErrors({ code: `That code is not correct. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` });
        } else setErrors({ code: 'That code is not correct, or it was replaced by a newer one.' });
      } else if (c === 'CODE_EXPIRED') {
        setExpiresAt(Date.now());
        setErrors({ code: 'This code has expired. Request a new one.' });
      } else if (c === 'TOO_MANY_ATTEMPTS') {
        setLocked(true);
        setAttemptsLeft(0);
        setErrors({ code: 'Too many wrong codes. Request a new code to try again.' });
      } else if (c === 'VALIDATION_ERROR' && err instanceof ApiError && err.fields) {
        setErrors({ pw: err.fields.newPassword, code: err.fields.code, email: err.fields.email });
        if (!err.fields.newPassword && !err.fields.code && !err.fields.email) setFormError(authErrorMessage(err));
      } else setFormError(authErrorMessage(err));
    } finally {
      busy.current = false;
    }
  };

  const resend = async () => {
    if (busy.current) return;
    setFormError(null);
    const ev = validateEmail(email);
    if (!ev.ok) {
      setErrors((p) => ({ ...p, email: ev.error }));
      return;
    }
    if (!ts.ready) {
      setFormError(ts.notReadyMessage);
      return;
    }
    busy.current = true;
    try {
      await forgotPassword(ev.value, ts.token);
      setExpiresAt(Date.now() + CODE_TTL_S * 1000);
      setResendAt(Date.now() + COOLDOWN_S * 1000);
      setAttemptsLeft(MAX_ATTEMPTS);
      setLocked(false);
      setCode('');
      setErrors({});
      setResentInfo('If an account exists for this email, a new code has been sent.');
    } catch (err) {
      if (isCode(err, 'CAPTCHA_FAILED')) void refetch();
      setFormError(authErrorMessage(err));
    } finally {
      ts.reset();
      busy.current = false;
    }
  };

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero title="Set a new password" subtitle="Enter the code we emailed and choose a new password." onBack={back}>
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          {sentNow || resentInfo ? (
            <Banner tone="info" message={resentInfo ?? 'If an account exists for this email, we sent a 6-digit code. It is valid for 10 minutes.'} />
          ) : null}
          <EmailField value={email} onChangeText={(t) => { setEmail(t); setErrors((p) => ({ ...p, email: undefined })); }} error={errors.email} />
          <OtpField value={code} onChange={(v) => { setCode(v); setErrors((p) => ({ ...p, code: undefined })); }} error={errors.code} editable={!locked} />
          <ExpiryLine expiresAt={expiresAt} />
          <PasswordField label="New password" value={pw} onChangeText={(t) => { setPw(t); setErrors((p) => ({ ...p, pw: undefined })); }} error={errors.pw} showStrength />
          <PasswordField label="Confirm new password" value={pw2} onChangeText={(t) => { setPw2(t); setErrors((p) => ({ ...p, pw2: undefined })); }} error={errors.pw2} />
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label="Update password" full onPress={submit} />
          <View style={{ gap: 12 }}>
            <Text variant="caption" color={colors.muted}>Did not get a code? Check spam, or request a new one.</Text>
            {ts.element}
            <ResendButton resendAt={resendAt} onResend={resend} label="Send a new code" />
          </View>
        </Card>
      </ScreenHero>
    </Screen>
  );
}
