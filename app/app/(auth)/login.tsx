import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banner, Button, Card, EmailField, OfflineBanner, PasswordField, Screen, ScreenHero } from '@/ui';
import { loginRequest } from '@/api/integrations';
import { useFeatures } from '@/config/features';
import { GoogleSignInButton, OrDivider, useGoogleAvailable } from '@/features/auth/GoogleSignIn';
import { useTurnstile } from '@/features/auth/Turnstile';
import { postAuth } from '@/features/auth/postAuth';
import { authErrorMessage } from '@/features/auth/errors';
import { ApiError, fieldErrors } from '@/api/client';
import { loginSchema, type LoginForm } from '@/lib/schemas';

export default function Login() {
  const router = useRouter();
  const ts = useTurnstile();
  const googleOn = useGoogleAvailable();
  const { refetch } = useFeatures();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    if (!ts.ready) {
      setFormError(ts.notReadyMessage);
      return;
    }
    postAuth.dismissVerify();
    try {
      await loginRequest(values.email.trim().toLowerCase(), values.password, ts.token);
      // the root layout routes by role once the session is set
    } catch (e) {
      const fe = fieldErrors(e);
      let mapped = false;
      (['email', 'password'] as const).forEach((k) => {
        if (fe[k]) {
          setError(k, { type: 'server', message: fe[k] });
          mapped = true;
        }
      });
      if (!mapped) {
        const code = e instanceof ApiError ? e.code : '';
        if (code === 'CAPTCHA_FAILED') void refetch();
        setFormError(code === 'INVALID_CREDENTIALS' || (e instanceof ApiError && e.status === 401) ? 'Email or password is incorrect.' : authErrorMessage(e));
      }
    } finally {
      ts.reset();
    }
  });

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero
        title="Welcome back"
        subtitle="Log in to see your drives and applications."
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
      >
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <EmailField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <PasswordField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
            )}
          />
          <Button label="Forgot password?" variant="ghost" size="sm" onPress={() => router.push('/(auth)/forgot-password')} />
          {ts.element}
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label="Log in" full onPress={submit} />
          {googleOn ? (
            <>
              <OrDivider />
              <GoogleSignInButton turnstile={ts} />
            </>
          ) : null}
        </Card>
      </ScreenHero>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Button label="New here? Create an account" variant="ghost" full onPress={() => router.replace('/(auth)/register')} />
      </View>
    </Screen>
  );
}
