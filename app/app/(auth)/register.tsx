import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banner, Button, Card, Checkbox, EmailField, OfflineBanner, PasswordField, PhoneField, Screen, ScreenHero, SegmentedControl, Text, TextField } from '@/ui';
import { registerRequest } from '@/api/integrations';
import { useFeatures } from '@/config/features';
import { GoogleSignInButton, OrDivider, useGoogleAvailable } from '@/features/auth/GoogleSignIn';
import { useTurnstile } from '@/features/auth/Turnstile';
import { postAuth } from '@/features/auth/postAuth';
import { authErrorMessage } from '@/features/auth/errors';
import { ApiError, fieldErrors } from '@/api/client';
import { registerSchema, type RegisterForm } from '@/lib/schemas';
import { validateEmail, validateName, validatePhone } from '@/lib/validation';
import { colors } from '@/theme';

type FieldName = keyof RegisterForm;
const FIELD_NAMES: FieldName[] = ['name', 'email', 'phone', 'password', 'role', 'inviteCode', 'acceptTerms'];

export default function Register() {
  const router = useRouter();
  const ts = useTurnstile();
  const googleOn = useGoogleAvailable();
  const { refetch } = useFeatures();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, watch, setValue } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: '', password: '', role: 'student', inviteCode: '', acceptTerms: false },
    mode: 'onTouched',
  });
  const role = watch('role');
  const termsChecked = watch('acceptTerms');

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const email = validateEmail(values.email);
    const phone = validatePhone(values.phone);
    const name = validateName(values.name);
    if (!email.ok || !phone.ok || !name.ok) return; // resolver already reported these
    if (!ts.ready) {
      setFormError(ts.notReadyMessage);
      return;
    }
    postAuth.promptVerify(); // after sign-up, offer the email code screen once
    try {
      await registerRequest({
        name: name.value,
        email: email.value,
        phone: phone.value,
        password: values.password,
        role: values.role,
        inviteCode: values.role === 'officer' ? values.inviteCode.trim() : undefined,
        acceptTerms: true,
      }, ts.token);
      // the root layout routes by role once the session is set
    } catch (e) {
      postAuth.dismissVerify();
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'CAPTCHA_FAILED') void refetch();
      if (code === 'EMAIL_TAKEN') {
        setError('email', { type: 'server', message: 'This email is already registered. Try logging in instead.' });
        return;
      }
      if (code === 'PHONE_TAKEN') {
        setError('phone', { type: 'server', message: 'This mobile number is already registered. Try logging in instead.' });
        return;
      }
      const fe = fieldErrors(e);
      let mapped = false;
      FIELD_NAMES.forEach((k) => {
        if (fe[k]) {
          setError(k, { type: 'server', message: fe[k] });
          mapped = true;
        }
      });
      if (!mapped) setFormError(code === 'INVALID_INVITE_CODE' ? 'That invite code is not valid.' : authErrorMessage(e));
    } finally {
      ts.reset();
    }
  });

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero
        title="Create account"
        subtitle="Join your campus placement network."
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
      >
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <View style={{ gap: 6 }}>
              <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>
                I am a
              </Text>
              <SegmentedControl
                value={field.value}
                onChange={(v) => setValue('role', v === 'officer' ? 'officer' : 'student', { shouldValidate: true })}
                options={[
                  { value: 'student', label: 'Student' },
                  { value: 'officer', label: 'Placement officer' },
                ]}
              />
            </View>
          )}
        />
        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <TextField
              label="Full name"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              maxLength={80}
            />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <EmailField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <PhoneField value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <PasswordField
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              showStrength
            />
          )}
        />
        {role === 'officer' ? (
          <Controller
            control={control}
            name="inviteCode"
            render={({ field, fieldState }) => (
              <TextField
                label="Officer invite code"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                helper="Ask your placement office for this code."
                autoCapitalize="none"
                maxLength={100}
              />
            )}
          />
        ) : null}
        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <View style={{ gap: 4 }}>
              <Checkbox
                checked={field.value}
                onChange={(v) => { field.onChange(v); field.onBlur(); }}
                error={fieldState.error?.message}
                accessibilityLabel="I agree to the Terms and Privacy Policy"
              >
                <Text variant="body">
                  I agree to the{' '}
                  <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/terms')} accessibilityRole="link">Terms</Text>
                  {' '}and{' '}
                  <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/privacy')} accessibilityRole="link">Privacy Policy</Text>
                </Text>
              </Checkbox>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button label="Read Terms" variant="ghost" size="sm" onPress={() => router.push('/(auth)/terms')} />
                <Button label="Read Privacy Policy" variant="ghost" size="sm" onPress={() => router.push('/(auth)/privacy')} />
              </View>
            </View>
          )}
        />
        {ts.element}
        {formError ? <Banner tone="error" message={formError} /> : null}
        <Button label="Create account" full onPress={submit} />
        {googleOn && role === 'student' ? (
          <>
            <OrDivider />
            <GoogleSignInButton turnstile={ts} acceptTerms={termsChecked === true} label="Sign up with Google" />
          </>
        ) : null}
        </Card>
      </ScreenHero>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Button label="Already have an account? Log in" variant="ghost" full onPress={() => router.replace('/(auth)/login')} />
      </View>
    </Screen>
  );
}
