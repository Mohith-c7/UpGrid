/**
 * "Continue with Google" for login and register.
 * Uses expo-auth-session's Google provider (authorization code + PKCE, id_token from the token exchange) and sends the
 * ID token to POST /auth/google. Hidden unless GET /config says googleLogin is on AND a client id exists for this platform.
 *
 * Client ids: EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID / _IOS_ / _WEB_ (web and iOS also fall back to /config googleClientIds).
 * Android needs the reversed client id registered as an app scheme: app.config.js does that from the env var at build time.
 */
import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { Banner, Button, Checkbox, Text } from '@/ui';
import { colors, radius } from '@/theme';
import { useFeatures } from '@/config/features';
import { googleSignIn } from '@/api/integrations';
import { authErrorMessage, isCode } from './errors';
import { postAuth } from './postAuth';
import type { UseTurnstile } from './Turnstile';

WebBrowser.maybeCompleteAuthSession();

interface ClientIds { web?: string; android?: string; ios?: string }

function useClientIds(): ClientIds {
  const { config } = useFeatures();
  return {
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || config.googleClientIds.web,
    // Android must come from env: the redirect scheme is baked into the build
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined,
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || config.googleClientIds.ios,
  };
}

/** Whether the Google button should be shown on this device. */
export function useGoogleAvailable(): boolean {
  const { flags } = useFeatures();
  const ids = useClientIds();
  if (!flags.googleLogin) return false;
  if (Platform.OS === 'android') return !!ids.android;
  if (Platform.OS === 'ios') return !!ids.ios;
  return !!ids.web;
}

function Inner({
  ids,
  turnstile,
  acceptTerms,
  label,
}: {
  ids: ClientIds;
  turnstile?: UseTurnstile;
  /** pass the register form's Terms checkbox; when true it is sent with the first call */
  acceptTerms?: boolean;
  label: string;
}) {
  const router = useRouter();
  const { refetch } = useFeatures();
  const [request, , promptAsync] = Google.useAuthRequest({
    androidClientId: ids.android,
    iosClientId: ids.ios,
    webClientId: ids.web,
    scopes: ['openid', 'profile', 'email'],
    selectAccount: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);

  const finish = async (idToken: string, terms: boolean) => {
    postAuth.dismissVerify();
    try {
      await googleSignIn(idToken, { acceptTerms: terms, turnstileToken: turnstile?.token });
      setPendingToken(null);
      // the root layout routes by role, and to /complete-profile when the account has no mobile number yet
    } catch (e) {
      if (isCode(e, 'TERMS_REQUIRED')) {
        setPendingToken(idToken);
        setError(null);
        return;
      }
      if (isCode(e, 'GOOGLE_LOGIN_NOT_CONFIGURED', 'CAPTCHA_FAILED')) void refetch();
      if (isCode(e, 'INVALID_GOOGLE_TOKEN', 'GOOGLE_EMAIL_UNVERIFIED', 'GOOGLE_ACCOUNT_CONFLICT')) setPendingToken(null);
      setError(authErrorMessage(e));
    } finally {
      turnstile?.reset();
    }
  };

  const start = async () => {
    setError(null);
    if (turnstile?.required && !turnstile.token) {
      setError(turnstile.notReadyMessage);
      return;
    }
    if (!request) {
      setError('Google sign-in is still loading. Try again in a moment.');
      return;
    }
    let res;
    try {
      res = await promptAsync();
    } catch {
      setError('Could not open Google sign-in. Please try again.');
      return;
    }
    if (res.type === 'cancel' || res.type === 'dismiss') return;
    if (res.type !== 'success') {
      setError('Google sign-in did not complete. Please try again.');
      return;
    }
    const idToken = res.authentication?.idToken ?? (res.params as Record<string, string> | undefined)?.id_token;
    if (!idToken) {
      setError('Google did not return an identity token. Please try again.');
      return;
    }
    await finish(idToken, acceptTerms === true);
  };

  const confirmTerms = async () => {
    if (!agree) {
      setAgreeError('Agree to the Terms and Privacy Policy to create your account');
      return;
    }
    if (!pendingToken) return;
    if (turnstile?.required && !turnstile.token) {
      setError(turnstile.notReadyMessage);
      return;
    }
    setError(null);
    await finish(pendingToken, true);
  };

  return (
    <View style={{ gap: 12 }}>
      <Button label={label} variant="secondary" full onPress={start} disabled={!!pendingToken} accessibilityLabel={label} />
      {pendingToken ? (
        <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 12 }}>
          <Text variant="subhead">Create your account</Text>
          <Text variant="caption" color={colors.muted}>This Google account is new here. Agree to continue.</Text>
          <Checkbox checked={agree} onChange={(v) => { setAgree(v); setAgreeError(null); }} error={agreeError} accessibilityLabel="I agree to the Terms and Privacy Policy">
            <Text variant="body">
              I agree to the{' '}
              <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/terms')} accessibilityRole="link">Terms</Text>
              {' '}and{' '}
              <Text variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/(auth)/privacy')} accessibilityRole="link">Privacy Policy</Text>
            </Text>
          </Checkbox>
          <Button label="Agree and continue" full onPress={confirmTerms} />
          <Button label="Cancel" variant="ghost" full onPress={() => { setPendingToken(null); setAgree(false); setAgreeError(null); }} />
        </View>
      ) : null}
      {error ? <Banner tone="error" message={error} /> : null}
    </View>
  );
}

export function GoogleSignInButton(props: { turnstile?: UseTurnstile; acceptTerms?: boolean; label?: string }) {
  const ids = useClientIds();
  const available = useGoogleAvailable();
  if (!available) return null;
  return <Inner ids={ids} turnstile={props.turnstile} acceptTerms={props.acceptTerms} label={props.label ?? 'Continue with Google'} />;
}

/** "or" divider shown between the form and the Google button (render only when `useGoogleAvailable()`). */
export function OrDivider() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessible accessibilityLabel="or">
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text variant="caption" color={colors.muted}>or</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

