import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Avatar, Banner, Button, Card, PasswordField, SectionHeader, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { validatePassword } from '@/lib/validation';
import { errCode, errFields, errMessage, useAuth, useChangePassword, useDeleteAccount, useProfileFull } from '@/features/student/me/data';
import { confirm, makeResolver, Page, RowGroup, sp, useBack, useOnce, useUnsavedGuard } from '@/features/student/me/kit';

interface FV { currentPassword: string; newPassword: string; confirmPassword: string }
const resolver = makeResolver<FV>({
  currentPassword: (v) => (v ? null : 'Enter your current password'),
  newPassword: (v, all) => {
    const r = validatePassword(v ?? '');
    if (!r.ok) return r.error;
    return v === all.currentPassword ? 'New password must be different from the current one' : null;
  },
  confirmPassword: (v, all) => (v === all.newPassword ? null : 'Passwords do not match'),
});

const DELETE_WORD = 'DELETE';

export default function AccountScreen() {
  const toast = useToast();
  const router = useRouter();
  const back = useBack('/(student)/(tabs)/profile');
  const auth = useAuth();
  const profile = useProfileFull();
  const change = useChangePassword();
  const del = useDeleteAccount();
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const { control, handleSubmit, formState, reset } = useForm<FV>({
    resolver, mode: 'onBlur', defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  useUnsavedGuard(formState.isDirty);

  const [submit, changing] = useOnce(async (v: FV) => {
    setServerErr({});
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.show('Password changed. Other devices were signed out.', 'success');
    } catch (e) {
      const f = errFields(e);
      if (f) setServerErr(f);
      else if (errCode(e) === 'INVALID_CURRENT_PASSWORD') setServerErr({ currentPassword: 'Current password is incorrect' });
      toast.show(errMessage(e), 'error');
    }
  });
  const [doLogout, loggingOut] = useOnce(async () => {
    try { await auth.logout(); } catch { toast.show('Could not log out cleanly. Please try again.', 'error'); }
  });
  const [doDelete, deleting] = useOnce(async () => {
    try { await del.mutateAsync(); } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const canDelete = typed.trim() === DELETE_WORD;

  const who = profile.data?.user?.name ?? auth.user?.name ?? 'Student';
  return (
    <Page title="Account" onBack={back} keyboard gap={sp.xl}>
      <Card>
        <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
          <Avatar name={who} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" color={colors.muted}>Signed in as</Text>
            <Text variant="subhead" numberOfLines={1} ellipsizeMode="tail">{who}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1} ellipsizeMode="middle">{profile.data?.user?.email ?? auth.user?.email}</Text>
          </View>
        </View>
      </Card>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Change password" />
        <Card>
          <View style={{ gap: sp.lg }}>
            <Controller control={control} name="currentPassword" render={({ field, fieldState }) => (
              <PasswordField label="Current password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message ?? serverErr.currentPassword} />
            )} />
            <Controller control={control} name="newPassword" render={({ field, fieldState }) => (
              <PasswordField label="New password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} showStrength error={fieldState.error?.message ?? serverErr.newPassword} />
            )} />
            <Controller control={control} name="confirmPassword" render={({ field, fieldState }) => (
              <PasswordField label="Confirm new password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
            )} />
            <Text variant="caption" color={colors.muted}>8-64 characters with at least one letter and one number. Changing it signs out your other devices. If you forget it, use Forgot password on the log in screen.</Text>
            <Button label="Change password" full loading={changing} onPress={handleSubmit(submit, () => toast.show('Fix the highlighted fields', 'error'))} />
          </View>
        </Card>
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Legal" />
        <RowGroup
          rows={[
            { icon: 'gavel', title: 'Terms of use', subtitle: 'Draft', onPress: () => router.push('/(student)/settings/terms' as never) },
            { icon: 'privacy-tip', title: 'Privacy policy', subtitle: 'Draft: what data we collect and who sees it', onPress: () => router.push('/(student)/settings/privacy' as never) },
          ]}
        />
      </View>

      <Button label="Log out" variant="secondary" icon="logout" full loading={loggingOut}
        onPress={() => confirm('Log out?', 'You will need to sign in again to see your applications.', 'Log out', () => doLogout(), false)} />

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Delete account" />
        <Banner tone="error" title="This cannot be undone from the app" message="It signs you out everywhere, removes your push tokens, cancels your reminders and closes your account. Your email and mobile number become free to register again. The placement cell may keep application records it already received." />
        <Card>
          <View style={{ gap: sp.md }}>
            <TextField label={`Type ${DELETE_WORD} to confirm`} value={typed} onChangeText={setTyped} maxLength={10} autoCapitalize="characters" helper="Capital letters" />
            <Button label="Delete my account" variant="danger" icon="delete-outline" full disabled={!canDelete} loading={deleting}
              onPress={() => confirm('Delete your account?', 'This closes your account and signs you out.', 'Delete', () => doDelete())} />
          </View>
        </Card>
      </View>
    </Page>
  );
}
