import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/state/session';

export default function Index() {
  const s = useSession();
  if (s.status === 'loading') return null; // splash screen is still visible
  if (s.status === 'signedOut') return <Redirect href="/(auth)/welcome" />;
  if (s.role === 'recruiter') return <Redirect href="/(recruiter)/(tabs)" />;
  return <Redirect href={s.role === 'officer' ? '/(officer)/(tabs)' : '/(student)/(tabs)'} />;
}
