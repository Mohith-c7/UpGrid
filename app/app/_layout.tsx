import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { qk, useSessionBootstrap } from '@/api/hooks';
import { syncServerTime } from '@/api/client';
import { session, useSession } from '@/state/session';
import { configureNotifications } from '@/lib/push';
import { ErrorBoundary, OfflineBanner, ToastProvider } from '@/ui';
import { FeatureFlagsProvider } from '@/config/features';
import { postAuth, useAuthStep } from '@/features/auth/postAuth';
import { colors, setInterLoaded } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

type NotificationData = { driveId?: string; applicationId?: string };

function RootBanner() {
  return <OfflineBanner root />; // pads for the status bar only while it is the visible banner
}

function Gate() {
  const s = useSession();
  const segments = useSegments() as unknown as string[];
  const router = useRouter();
  const qc = useQueryClient();
  const prevStatus = useRef(s.status);
  const handledPush = useRef<string | null>(null);
  const response = Notifications.useLastNotificationResponse();
  const authStep = useAuthStep(); // 'complete-profile' / 'verify-email' for signed-in users who still owe a step
  const authStepKey = authStep?.key ?? null;
  const authStepHref = authStep?.href ?? null;

  // restore session + notification handler once
  useEffect(() => {
    configureNotifications();
    void session.init();
  }, []);

  // release the splash screen as soon as we know where to go
  useEffect(() => {
    if (s.status !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
  }, [s.status]);

  // never leak one account's cached data into the next session
  useEffect(() => {
    if (prevStatus.current === 'signedIn' && s.status === 'signedOut') qc.clear();
    if (s.status === 'signedOut') postAuth.dismissVerify(); // a "verify email" prompt must not carry over to the next account
    prevStatus.current = s.status;
  }, [s.status, qc]);

  useSessionBootstrap(s.status === 'signedIn');

  // keep the clock offset and badge fresh when the app returns to the foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && session.getState().status === 'signedIn') {
        void syncServerTime();
        void qc.invalidateQueries({ queryKey: qk.unread });
      }
    });
    return () => sub.remove();
  }, [qc]);

  // refresh badge/list when a push arrives while the app is open
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: qk.unread });
      void qc.invalidateQueries({ queryKey: qk.notifications });
    });
    return () => sub.remove();
  }, [qc]);

  // route by session / role (the index route handles the very first redirect)
  useEffect(() => {
    if (s.status === 'loading' || segments.length === 0) return;
    const group = segments[0];
    if (group === '+not-found') return;
    if (s.status === 'signedOut') {
      if (group !== '(auth)') router.replace('/(auth)/welcome');
      return;
    }
    if (authStepKey && authStepHref && group !== authStepKey) {
      router.replace(authStepHref as never);
      return;
    }
    // verify-email is a top-level screen any signed-in user may open; complete-profile only while it is owed
    if (group === 'verify-email') return;
    if (group === 'complete-profile' && authStepKey === 'complete-profile') return;
    if (s.role === 'officer') {
      if (group !== '(officer)') router.replace('/(officer)/(tabs)');
    } else if (s.role === 'student') {
      if (group !== '(student)') router.replace('/(student)/(tabs)');
    } else if (s.role === 'recruiter') {
      if (group !== '(recruiter)') router.replace('/(recruiter)/(tabs)');
    } else {
      // signed in with a role this build does not know: never leave the user on a dead screen
      void session.clear();
    }
  }, [s.status, s.role, segments, router, authStepKey, authStepHref]);

  // push notification tap -> deep link
  useEffect(() => {
    if (!response || s.status !== 'signedIn' || !s.role) return;
    const id = response.notification.request.identifier;
    if (handledPush.current === id) return;
    const group = s.role === 'officer' ? '(officer)' : s.role === 'recruiter' ? '(recruiter)' : '(student)';
    if (segments[0] !== group) return;
    handledPush.current = id;
    const data = (response.notification.request.content.data ?? {}) as NotificationData;
    if (s.role === 'student') {
      if (data.applicationId) router.push(`/(student)/application/${data.applicationId}`);
      else if (data.driveId) router.push(`/(student)/drive/${data.driveId}`);
      else router.push('/(student)/notifications');
    } else if (s.role === 'recruiter') {
      if (data.driveId) router.push(`/(recruiter)/drive/${data.driveId}` as never);
    } else if (data.driveId) {
      router.push(`/(officer)/drive/${data.driveId}`);
    }
  }, [response, s.status, s.role, segments, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style="dark" />
      <RootBanner />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150, contentStyle: { backgroundColor: colors.canvas } }} />
      </View>
    </View>
  );
}

/** Inter is loaded behind the splash screen. If loading fails or takes > 4s we fall back to the system font. */
function useFontsReady(): boolean {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);
  if (loaded) setInterLoaded(true); // set before children render so the first paint already uses Inter
  return loaded || !!error || timedOut;
}

export default function RootLayout() {
  const fontsReady = useFontsReady();
  if (!fontsReady) return null; // splash screen stays visible
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <FeatureFlagsProvider>
              <ToastProvider>
                <Gate />
              </ToastProvider>
            </FeatureFlagsProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
