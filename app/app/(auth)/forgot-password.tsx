import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, EmailField, OfflineBanner, Screen, ScreenHero, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { useFeatures } from '@/config/features';
import { forgotPassword } from '@/api/integrations';
import { validateEmail } from '@/lib/validation';
import { authErrorMessage, isCode } from '@/features/auth/errors';
import { useTurnstile } from '@/features/auth/Turnstile';

export default function ForgotPassword() {
  const router = useRouter();
  const { flags, status, refetch } = useFeatures();
  const ts = useTurnstile();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'));
  const unavailable = status === 'ready' && !flags.emailVerification;

  const submit = async () => {
    if (busy.current) return;
    setFormError(null);
    const v = validateEmail(email);
    if (!v.ok) {
      setEmailError(v.error);
      return;
    }
    if (!ts.ready) {
      setFormError(ts.notReadyMessage);
      return;
    }
    busy.current = true;
    try {
      await forgotPassword(v.value, ts.token);
      // the API answers the same for every address, so we always continue to the code screen
      router.replace({ pathname: '/(auth)/reset-password', params: { email: v.value, sent: '1' } });
    } catch (e) {
      if (isCode(e, 'CAPTCHA_FAILED')) void refetch();
      setFormError(authErrorMessage(e));
    } finally {
      ts.reset();
      busy.current = false;
    }
  };

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero title="Forgot password" subtitle="We will email you a 6-digit code to set a new password." onBack={back}>
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          {status === 'loading' ? (
            <View style={{ gap: 12 }}>
              <Skeleton height={52} />
              <Skeleton height={52} />
            </View>
          ) : unavailable ? (
            <>
              <Banner tone="warning" title="Reset by email is not available" message="This server cannot send email right now. Ask your placement office to reset your password." />
              <Button label="Back to log in" variant="secondary" full onPress={back} />
            </>
          ) : (
            <>
              <EmailField value={email} onChangeText={(t) => { setEmail(t); setEmailError(null); }} error={emailError} />
              <Text variant="caption" color={colors.muted}>Signed up with Google? You can use this to set a password too.</Text>
              {ts.element}
              {formError ? <Banner tone="error" message={formError} /> : null}
              <Button label="Send reset code" full onPress={submit} />
              <Button label="I already have a code" variant="ghost" full onPress={() => router.push({ pathname: '/(auth)/reset-password', params: { email: email.trim().toLowerCase() } })} />
            </>
          )}
        </Card>
      </ScreenHero>
    </Screen>
  );
}
