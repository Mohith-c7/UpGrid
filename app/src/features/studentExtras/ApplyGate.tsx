import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, PhoneField, Sheet, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError } from '@/api/client';
import { patchMe } from '@/api/integrations';
import type { ApplyGateCode } from '@/api/studentExtrasTypes';
import { validatePhone } from '@/lib/validation';
import { RESTRICTIONS_ROUTE } from './restrictions';

/**
 * Fix-it banner for the three apply gates the server can raise:
 *  EMAIL_NOT_VERIFIED -> go to the code screen, PHONE_REQUIRED -> add a number right here, RESTRICTED -> read the reason and appeal.
 * `onResolved` runs after the phone is saved so the caller can re-run the preview.
 */
export function ApplyGateBanner({ code, message, restrictionId, onResolved }: {
  code: ApplyGateCode; message?: string | null; restrictionId?: string | null; onResolved?: () => void;
}) {
  const router = useRouter();
  const [phoneOpen, setPhoneOpen] = useState(false);

  if (code === 'EMAIL_NOT_VERIFIED') {
    return (
      <Banner
        tone="warning" icon="mark-email-unread" title="Verify your email to apply"
        message={message || 'Your placement cell needs a verified email before you can apply. Enter the 6-digit code we send you.'}
        action={{ label: 'Verify email', onPress: () => router.push('/verify-email' as never) }}
      />
    );
  }
  if (code === 'RESTRICTED') {
    return (
      <Banner
        tone="error" icon="gpp-maybe" title="You are restricted from this drive"
        message={message || 'The placement cell has limited your applications. You can read the reason and appeal.'}
        action={{ label: 'View reason and appeal', onPress: () => router.push((restrictionId ? `${RESTRICTIONS_ROUTE}?id=${encodeURIComponent(restrictionId)}` : RESTRICTIONS_ROUTE) as never) }}
      />
    );
  }
  return (
    <>
      <Banner
        tone="warning" icon="phone-android" title="Add your mobile number to apply"
        message={message || 'Companies and the placement cell need a mobile number to reach you. It takes a few seconds.'}
        action={{ label: 'Add mobile number', onPress: () => setPhoneOpen(true) }}
      />
      <PhoneSheet visible={phoneOpen} onClose={() => setPhoneOpen(false)} onSaved={() => { setPhoneOpen(false); onResolved?.(); }} />
    </>
  );
}

export function PhoneSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const v = validatePhone(value);
    if (!v.ok) { setError(v.error); return; }
    setBusy(true);
    setError(null);
    try {
      await patchMe({ phone: v.value });
      toast.show('Mobile number saved', 'success');
      setValue('');
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'PHONE_TAKEN' || e.fields?.phone)) setError(e.fields?.phone ?? 'This mobile number is already registered with another account.');
      else setError(e instanceof Error && e.message ? e.message : 'Could not save the number. Try again.'); // inline: a toast would sit behind the sheet's modal
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add your mobile number">
      <View style={{ gap: 16 }}>
        <Text variant="body" color={colors.muted}>10-digit Indian mobile number. It is shown to the placement cell and to companies you apply to.</Text>
        <PhoneField value={value} onChangeText={(t) => { setValue(t); if (error) setError(null); }} error={error} />
        <Button label="Save and continue" full loading={busy} onPress={save} />
      </View>
    </Sheet>
  );
}
