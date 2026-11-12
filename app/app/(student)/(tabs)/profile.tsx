import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, Button, Card, ListRow, ProgressBar, SectionHeader, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { formatPhone } from '@/lib/validation';
import { useAuth, useProfileFull } from '@/features/student/me/data';
import { useFeature, useFeatures } from '@/config/features';
import { useTestsEnabled } from '@/api/tests';
import { nextStepOf } from '@/features/student/discover/helpers';
import { confirm, Page, QueryBoundary, RowGroup, sp, useOnce, VerificationBadge } from '@/features/student/me/kit';

const EDIT_ROUTE: Record<string, string> = {
  registrationNumber: '/(student)/profile/edit-identity',
  city: '/(student)/profile/edit-identity',
  department: '/(student)/profile/edit-academics',
  batchYear: '/(student)/profile/edit-academics',
  cgpa: '/(student)/profile/edit-academics',
  tenthTwelfth: '/(student)/profile/edit-academics',
  backlogsGap: '/(student)/profile/edit-academics',
  linkedin: '/(student)/profile/links',
  resume: '/(student)/profile/resumes',
};

const VERIFIED_ROWS: { key: string; label: string; value: (a: any, i: any) => string }[] = [
  { key: 'identity.registrationNumber', label: 'Registration number', value: (_a, i) => i.registrationNumber ?? '' },
  { key: 'academics.department', label: 'Department', value: (a) => a.department ?? '' },
  { key: 'academics.batchYear', label: 'Batch year', value: (a) => (a.batchYear ? String(a.batchYear) : '') },
  { key: 'academics.cgpa', label: 'CGPA', value: (a) => (a.cgpa != null ? `${Number(a.cgpa).toFixed(2)} / ${a.cgpaScale ?? 10}` : '') },
  { key: 'academics.tenthPercent', label: '10th percentage', value: (a) => (a.tenthPercent != null ? `${a.tenthPercent}%` : '') },
  { key: 'academics.twelfthPercent', label: '12th percentage', value: (a) => (a.twelfthPercent != null ? `${a.twelfthPercent}%` : '') },
  { key: 'academics.activeBacklogs', label: 'Active backlogs', value: (a) => (a.activeBacklogs != null ? String(a.activeBacklogs) : '') },
];

export default function ProfileTab() {
  const router = useRouter();
  const toast = useToast();
  const session = useAuth();
  const q = useProfileFull();
  const p = q.data;
  const name = p?.identity?.preferredName || p?.user?.name || session?.user?.name || 'Student';
  const email = p?.user?.email ?? session?.user?.email;
  const percent = Math.max(0, Math.min(100, Math.round(p?.completion?.percent ?? 0)));
  // the server sends a label string, but tolerate an item object so the card never prints "[object Object]"
  const nextLabel = nextStepOf(p?.completion as never)?.label ?? null;
  const to = (path: string) => () => router.push(path as never);
  const aiOn = useFeature('ai');
  const { flags } = useFeatures();
  const testsOn = useTestsEnabled();

  const [doLogout, loggingOut] = useOnce(async () => {
    try { await session.logout(); } catch { toast.show('Could not log out cleanly. Please try again.', 'error'); }
  });

  return (
    <Page title="Profile" onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} skeletonRows={4} skeletonHeight={110}>
        {p ? (
          <View style={{ gap: sp.xl }}>
            <Card>
              <View style={{ flexDirection: 'row', gap: sp.lg, alignItems: 'center' }}>
                <Avatar name={name} size={56} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="title" numberOfLines={2} ellipsizeMode="tail">{name}</Text>
                  {email ? <Text variant="caption" color={colors.muted} numberOfLines={1} ellipsizeMode="middle">{email}</Text> : null}
                  {p.user?.phone ? <Text variant="caption" color={colors.muted} tabular>{formatPhone(p.user.phone)}</Text> : null}
                </View>
              </View>
            </Card>

            <Card tinted>
              <View style={{ gap: sp.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: sp.md }}>
                  <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>Profile completion</Text>
                  <Text variant="heading" tabular>{`${percent}%`}</Text>
                </View>
                <ProgressBar value={percent / 100} label={`Profile ${percent} percent complete`} />
                <Text variant="caption" color={colors.textSecondary}>
                  {nextLabel ? `Next: ${nextLabel}` : 'All set. Keep details up to date before each season.'}
                </Text>
              </View>
            </Card>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Checklist" />
              <Card padding={0}>
                {(p.completion?.items ?? []).length === 0 ? (
                  <View style={{ padding: sp.lg }}><Text variant="body" color={colors.muted}>No checklist items.</Text></View>
                ) : null}
                {(p.completion?.items ?? []).map((it, i, arr) => {
                  const route = EDIT_ROUTE[it.key] ?? (it.key === 'skills' || it.key === 'preferences' ? '/(student)/profile/edit-identity' : undefined);
                  return (
                    <View key={it.key} style={{ paddingHorizontal: sp.lg }}>
                      <ListRow
                        title={it.label}
                        subtitle={it.done ? undefined : it.why}
                        right={<Badge label={it.done ? 'Done' : 'To do'} tone={it.done ? 'success' : 'warning'} />}
                        onPress={route ? () => router.push(route as never) : undefined}
                        last={i === arr.length - 1}
                      />
                    </View>
                  );
                })}
              </Card>
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Verification" subtitle="Checked manually by the placement cell" />
              <Card>
                <View style={{ gap: sp.lg }}>
                  {VERIFIED_ROWS.map((r) => {
                    const val = r.value(p.academics ?? {}, p.identity ?? {});
                    if (!val) return null;
                    return (
                      <View key={r.key} style={{ gap: sp.xs }}>
                        <Text variant="caption" color={colors.muted}>{r.label}</Text>
                        <Text variant="body" tabular style={{ fontWeight: '600' }}>{val}</Text>
                        <VerificationBadge v={p.verification?.[r.key]} />
                      </View>
                    );
                  })}
                  <Text variant="caption" color={colors.muted}>
                    Nothing is pulled from a university system. Editing a verified value makes it unverified again.
                  </Text>
                </View>
              </Card>
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Edit your profile" />
              <RowGroup
                rows={[
                  { icon: 'badge', title: 'Identity and location', subtitle: 'Registration number, preferred name, city', onPress: to('/(student)/profile/edit-identity') },
                  { icon: 'school', title: 'Academics', subtitle: 'CGPA, 10th and 12th, backlogs, batch', onPress: to('/(student)/profile/edit-academics') },
                  { icon: 'link', title: 'Links', subtitle: 'LinkedIn, GitHub, portfolio', onPress: to('/(student)/profile/links') },
                  { icon: 'description', title: 'Resumes', subtitle: 'Up to 5 files or links, one default', onPress: to('/(student)/profile/resumes') },
                ]}
              />
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Account and settings" />
              <RowGroup
                rows={[
                  { icon: 'fact-check', title: 'Eligibility', subtitle: 'Which drives you can apply to', onPress: to('/(student)/eligibility') },
                  { icon: 'verified-user', title: 'Verification status', subtitle: 'What the placement cell has checked', onPress: to('/(student)/verification') },
                  ...(flags.opsRestrictions ? [{ icon: 'gpp-maybe' as const, title: 'My restrictions', subtitle: 'Reasons, duration and appeals', onPress: to('/(student)/restrictions') }] : []),
                  { icon: 'edit-note', title: 'Resume builder', subtitle: 'Make a PDF resume from your profile', onPress: to('/(student)/resume-builder') },
                  { icon: 'notifications-none', title: 'Notifications', onPress: to('/(student)/notifications') },
                  ...(testsOn ? [{ icon: 'assignment' as const, title: 'Tests and practice', subtitle: 'Online tests, results and coding practice', onPress: to('/(student)/tests') }] : []),
                  { icon: 'alarm', title: 'Reminders', subtitle: 'Deadline alerts and quiet hours', onPress: to('/(student)/settings/reminders') },
                  { icon: 'lock-outline', title: 'Account', subtitle: 'Password and delete account', onPress: to('/(student)/settings/account') },
                  ...(aiOn ? [{ icon: 'auto-awesome' as const, title: 'AI assistant and privacy', subtitle: 'Chat, resume review, mock interviews, your AI data', onPress: to('/(student)/ai') }] : []),
                  { icon: 'support-agent', title: 'Help and support', subtitle: 'Ask the placement cell or report a problem', onPress: to('/(student)/support') },
                ]}
              />
            </View>
            <Button
              label="Log out" variant="secondary" icon="logout" full loading={loggingOut}
              onPress={() => confirm('Log out?', 'You will need to sign in again to see your applications.', 'Log out', () => doLogout(), false)}
            />
          </View>
        ) : null}
      </QueryBoundary>
    </Page>
  );
}
