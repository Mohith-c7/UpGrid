import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Banner, Button, Card, ListRow, Text } from '@/ui';
import { colors } from '@/theme';
import { useAuth } from '@/api/hooks';
import { flatten } from '@/api/hooks';
import { useRecruiterDrives } from '@/api/recruiter';
import { driveSelection } from '@/features/recruiter/selection';
import { Page, PERMISSION_LABEL } from '@/features/recruiter/kit';
import type { RecruiterPermissionKey } from '@/api/recruiterTypes';

export default function RecruiterProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const drives = useRecruiterDrives();
  const [busy, setBusy] = useState(false);
  const items = flatten(drives.data);

  const signOut = () =>
    Alert.alert('Sign out?', 'You will need your email and password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { setBusy(true); try { driveSelection.set(null); await logout(); } finally { setBusy(false); } } },
    ]);

  return (
    <Page title="Profile" scroll onRefresh={() => void drives.refetch()} refreshing={drives.isRefetching}>
      <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Avatar name={user?.name ?? 'Recruiter'} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subhead">{user?.name}</Text>
          <Text variant="caption" color={colors.muted} selectable>{user?.email}</Text>
          {user?.phone ? <Text variant="caption" color={colors.muted} tabular>+91 {user.phone}</Text> : null}
        </View>
      </Card>

      <View style={{ gap: 8 }}>
        <Text variant="subhead">Your access</Text>
        {drives.isLoading ? <Text variant="caption" color={colors.muted}>Loading</Text> : null}
        {drives.isError ? <Banner tone="error" message="Could not load your drives." action={{ label: 'Retry', onPress: () => void drives.refetch() }} /> : null}
        {items.map((d) => {
          const off = (Object.keys(PERMISSION_LABEL) as RecruiterPermissionKey[]).filter((k) => d.permissions[k] === false);
          return (
            <Card key={d.driveId} style={{ gap: 4 }}>
              <Text variant="subhead">{d.company.name}</Text>
              <Text variant="caption" color={colors.muted}>{d.role}</Text>
              <Text variant="caption" color={off.length ? colors.textSecondary : colors.muted}>
                {off.length ? `Not allowed: ${off.map((k) => PERMISSION_LABEL[k].toLowerCase()).join(', ')}` : 'Full recruiter access'}
              </Text>
            </Card>
          );
        })}
      </View>

      <Card padding={0}>
        <View style={{ paddingHorizontal: 16 }}>
          <ListRow title="Terms of use" icon="description" onPress={() => router.push('/(recruiter)/legal/terms' as never)} />
          <ListRow title="Privacy policy" icon="privacy-tip" onPress={() => router.push('/(recruiter)/legal/privacy' as never)} last />
        </View>
      </Card>
      <Button label="Sign out" icon="logout" variant="secondary" full loading={busy} onPress={signOut} />
    </Page>
  );
}
