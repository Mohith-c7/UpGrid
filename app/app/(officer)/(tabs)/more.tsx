import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, Card, CompanyLogo, EmptyState, Header, IconBadge, ListRow, MetricRow, OfflineBanner, Panel, PanelRow, Screen, Sheet, Skeleton, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { useAuth } from '@/api/hooks';
import { useFeature } from '@/config/features';
import { useAnnouncements, useDashboard, useDrivesOfficer } from '@/features/officer/data';
import { QueryBoundary, useOnce } from '@/features/officer/components/common';
import { timeAgo } from '@/lib/format';
import { spacing } from '@/features/officer/layout';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

export default function More() {
  const r = useRouter();
  const toast = useToast();
  const auth = useAuth();
  const testsOn = useFeature('assessments');
  const drives = useDrivesOfficer();
  const dash = useDashboard();
  const ann = useAnnouncements();
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const items = useMemo(() => drives.data?.pages.flatMap((p) => p.items) ?? [], [drives.data]);
  const companies = useMemo(() => {
    const m = new Map<string, { name: string; logoUrl?: string | null; drives: number; open: number }>();
    items.forEach((d) => {
      const key = d.company.name || 'Unnamed company';
      const c = m.get(key) ?? { name: key, logoUrl: d.company.logoUrl, drives: 0, open: 0 };
      c.drives++; if (d.status === 'open' || d.status === 'closing') c.open++;
      m.set(key, c);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);
  const count = (s: string) => items.filter((d) => d.status === s).length;

  const [logout] = useOnce(async () => {
    setConfirmOut(false);
    try { await auth.logout(); } catch { toast.show('Signed out on this device. Server sign-out could not be confirmed.', 'info'); }
    r.replace('/(auth)/welcome');
  });

  const user = auth.user;
  const refresh = () => { void drives.refetch(); void ann.refetch(); void dash.refetch(); };

  return (
    <Screen scroll padded onRefresh={refresh} refreshing={drives.isRefetching || ann.isRefetching || dash.isRefetching}>
      <FocusedStatusBar />
      <OfflineBanner />
      <Header title="More" />
      <View style={{ gap: spacing[4] }}>
        <Card padding={16} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={user?.name ?? 'Placement officer'} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subhead" numberOfLines={1}>{user?.name ?? 'Placement officer'}</Text>
            <Text variant="caption" color={colors.muted} numberOfLines={1} ellipsizeMode="tail">{user?.email ?? ''}</Text>
          </View>
        </Card>

        <Panel title="Communicate">
          <PanelRow left={<IconBadge name="campaign" />} title="New announcement" subtitle="Message all students or a drive's participants" onPress={() => r.push('/(officer)/announce')} />
          <PanelRow left={<IconBadge name="support-agent" />} title="Support inbox" subtitle="Questions and disputes from students" onPress={() => r.push('/(officer)/support')} last />
        </Panel>

        <Panel title="Manage">
          <PanelRow left={<IconBadge name="admin-panel-settings" />} title="Operations" subtitle="Analytics, policy, restrictions, cohorts, calendar, audit" onPress={() => r.push('/(officer)/ops')} />
          {testsOn ? <PanelRow left={<IconBadge name="quiz" />} title="Tests and question bank" subtitle="Build tests, review results, shortlist" onPress={() => r.push('/(officer)/assessments')} /> : null}
          <PanelRow left={<IconBadge name="upload-file" />} title="Import academic data" subtitle="Update CGPA, backlogs and more from CSV" onPress={() => r.push('/(officer)/import-students')} />
          <PanelRow left={<IconBadge name="business" />} title="Companies" subtitle={drives.isLoading ? 'Loading…' : `${companies.length} from your drives`} onPress={() => setCompaniesOpen(true)} last />
        </Panel>

        <Panel title="Recent announcements">
          <QueryBoundary isLoading={ann.isLoading} isError={ann.isError} error={ann.error} onRetry={() => { void ann.refetch(); }}
            isEmpty={(ann.data?.length ?? 0) === 0} empty={{ icon: 'campaign', title: 'No announcements yet', message: 'Messages you send to students are listed here.' }} skeletonRows={2} skeletonHeight={64}>
            {ann.data?.slice(0, 5).map((a, i, arr) => (
              <PanelRow key={a.id} title={a.title} subtitle={a.body} meta={a.createdAt ? <Text variant="caption" color={colors.subtle}>{timeAgo(a.createdAt)}</Text> : undefined} last={i === arr.length - 1} />
            ))}
          </QueryBoundary>
        </Panel>

        <Panel title="Reports summary" subtitle="Based on the drives loaded on this device">
          {drives.isLoading || dash.isLoading ? <View style={{ padding: 16 }}><Skeleton height={200} radius={12} /></View> : drives.isError || dash.isError ? (
            <QueryBoundary isLoading={false} isError error={drives.error ?? dash.error} onRetry={refresh}>{null}</QueryBoundary>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              <MetricRow label="Total drives" value={items.length} />
              <MetricRow label="Open or closing" value={count('open') + count('closing')} />
              <MetricRow label="Closed" value={count('closed')} />
              <MetricRow label="Drafts" value={count('draft')} />
              <MetricRow label="Applications today" value={dash.data?.applicationsToday ?? 0} />
              <MetricRow label="Pending verifications" value={dash.data?.pendingVerifications ?? 0} last />
            </View>
          )}
        </Panel>

        <Panel title="Legal">
          <PanelRow title="Terms of use" subtitle="Draft" onPress={() => r.push('/(officer)/legal/terms')} />
          <PanelRow title="Privacy policy" subtitle="Draft" onPress={() => r.push('/(officer)/legal/privacy')} last />
        </Panel>

        <Button label="Log out" icon="logout" variant="secondary" full onPress={() => setConfirmOut(true)} />
      </View>

      <Sheet visible={companiesOpen} onClose={() => setCompaniesOpen(false)} title="Companies">
        {companies.length === 0 ? <EmptyState icon="business" title="No companies yet" message="Companies appear after you create drives." /> : (
          <View>
            {companies.map((c, i) => (
              <ListRow key={c.name} left={<CompanyLogo name={c.name} logoUrl={c.logoUrl} size={40} />} title={c.name}
                subtitle={`${c.drives} ${c.drives === 1 ? 'drive' : 'drives'} · ${c.open} open`} last={i === companies.length - 1} />
            ))}
            {drives.hasNextPage ? <Text variant="caption" color={colors.muted} style={{ paddingVertical: 8 }}>Only recent drives are included.</Text> : null}
          </View>
        )}
      </Sheet>
      <Sheet visible={confirmOut} onClose={() => setConfirmOut(false)} title="Log out?">
        <View style={{ gap: spacing[3], paddingBottom: 8 }}>
          <Text variant="body">You will need to sign in again.</Text>
          <Button label="Log out" variant="danger" full onPress={() => logout()} />
          <Button label="Cancel" variant="secondary" full onPress={() => setConfirmOut(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
