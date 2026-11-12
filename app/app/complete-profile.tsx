import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Icon, OfflineBanner, PhoneField, Screen, ScreenHero, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { useSession } from '@/state/session';
import { useAuth } from '@/api/hooks';
import { patchMe } from '@/api/integrations';
import { ApiError } from '@/api/client';
import { PHONE_ERROR, validatePhone } from '@/lib/validation';
import { authErrorMessage } from '@/features/auth/errors';

/** Step shown after a Google sign-up: the app needs a mobile number before the student can apply to drives. */
export default function CompleteProfile() {
  const router = useRouter();
  const toast = useToast();
  const auth = useAuth();
  const s = useSession();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = useRef(false);

  const submit = async () => {
    if (busy.current) return;
    setFormError(null);
    const v = validatePhone(phone);
    if (!v.ok) {
      setError(v.error || PHONE_ERROR);
      return;
    }
    busy.current = true;
    try {
      await patchMe({ phone: v.value });
      toast.show('Mobile number saved', 'success');
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PHONE_TAKEN') setError('This mobile number is already registered with another account.');
      else if (e instanceof ApiError && e.fields?.phone) setError(e.fields.phone);
      else setFormError(authErrorMessage(e));
    } finally {
      busy.current = false;
    }
  };

  return (
    <Screen scroll keyboard edges={['bottom']}>
      <ScreenHero title="Complete your profile" subtitle={s.user?.name ? `Welcome, ${s.user.name}. One more step.` : 'One more step.'}>
        <Card padding={20} style={{ gap: 16 }}>
          <OfflineBanner />
          <Text variant="body">Recruiters and your placement cell contact you on your mobile number, and you need one to apply to drives.</Text>
          <PhoneField value={phone} onChangeText={(t) => { setPhone(t); setError(null); }} error={error} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={20} color={colors.success} />
            <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>
              You agreed to the Terms and Privacy Policy when you continued with Google.
            </Text>
          </View>
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label="Save and continue" full onPress={submit} />
        </Card>
      </ScreenHero>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Button label="Log out" variant="ghost" full onPress={() => auth.logout()} />
      </View>
    </Screen>
  );
}
