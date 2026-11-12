import React from 'react';
import { useRouter } from 'expo-router';
import { Banner } from '@/ui';
import { useNeedsEmailVerification } from './postAuth';
import { useFeatures } from '@/config/features';

/** Drop into any screen. Renders nothing unless the user's email is unverified and the server can send codes. */
export function VerifyEmailBanner() {
  const router = useRouter();
  const needs = useNeedsEmailVerification();
  const { flags } = useFeatures();
  if (!needs) return null;
  return (
    <Banner
      tone={flags.requireVerifiedEmail ? 'warning' : 'info'}
      title="Verify your email"
      message={flags.requireVerifiedEmail ? 'You need a verified email to apply to drives.' : 'Confirm your email so you can recover your account and receive updates.'}
      action={{ label: 'Enter code', onPress: () => router.push('/verify-email') }}
    />
  );
}
