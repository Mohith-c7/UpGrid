import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, DriveCard, EmptyState, SegmentedTabs, Skeleton, StatTile, Text } from '@/ui';
import { colors } from '@/theme';
import { useServerOffset } from '@/api/hooks';
import { useDriveReasons, useEligibilityDrives, type EligDrive } from '@/features/student/me/data';
import { EligibilityTable } from '@/features/student/discover/eligibility';
import { Page, QueryBoundary, sp, useBack } from '@/features/student/me/kit';

const GROUPS = [
  { key: 'eligible', title: 'Eligible', hint: 'You meet every rule. You can apply.' },
  { key: 'pending', title: 'Pending', hint: 'We cannot check every rule yet because some profile details are missing.' },
  { key: 'not_eligible', title: 'Not eligible', hint: 'At least one rule is not met, so applying is blocked for these drives.' },
  { key: 'restricted', title: 'Restricted', hint: 'The placement cell has limited your applications to these drives. See My restrictions to read the reason and appeal.' },
] as const;
type GroupKey = (typeof GROUPS)[number]['key'];

function Reasons({ id }: { id: string }) {
  const router = useRouter();
  const q = useDriveReasons(id, true);
  if (q.isLoading) return <Skeleton height={120} radius={14} />;
  if (q.isError) {
    return (
      <Banner tone="error" message="Could not load the criteria." action={{ label: 'Retry', onPress: () => { void q.refetch(); } }} />
    );
  }
  const rows = q.data ?? [];
  if (!rows.length) return <Text variant="caption" color={colors.muted}>This drive has no specific criteria.</Text>;
  const fix = rows.some((r) => r.met !== true);
  return (
    <View style={{ gap: sp.md }}>
      <EligibilityTable reasons={rows} />
      {fix ? (
        <Button
          label="Update my profile" variant="secondary" icon="edit"
          onPress={() => router.push((rows.some((r) => r.criterion?.toLowerCase().includes('reg')) ? '/(student)/profile/edit-identity' : '/(student)/profile/edit-academics') as never)}
        />
      ) : null}
    </View>
  );
}

function EligItem({ d, offset }: { d: EligDrive; offset: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: sp.sm }}>
      <DriveCard drive={d} serverOffsetMs={offset} onPress={() => router.push(`/(student)/drive/${d.id}` as never)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        <Button label={open ? 'Hide criteria' : 'See criteria'} variant="ghost" icon={open ? 'expand-less' : 'expand-more'} onPress={() => setOpen((o) => !o)} />
        {d.eligibility.status !== 'eligible' && (d.eligibility.status as string) !== 'restricted' ? (
          <Button
            label="Dispute eligibility" variant="ghost" icon="flag"
            onPress={() => router.push({
              pathname: '/(student)/support/new',
              params: {
                category: 'eligibility',
                subject: `Eligibility dispute: ${d.company.name} - ${d.role}`.slice(0, 120),
                message: `Drive: ${d.company.name} - ${d.role} (ID ${d.id})\nShown as: ${d.eligibility.status === 'pending' ? 'Pending' : 'Not eligible'}${d.eligibility.reason ? ` (${d.eligibility.reason})` : ''}\n\nWhy I think this is wrong: `,
              },
            } as never)}
          />
        ) : null}
      </View>
      {open ? <Reasons id={d.id} /> : null}
    </View>
  );
}

export default function EligibilityScreen() {
  const router = useRouter();
  const back = useBack('/(student)/(tabs)/profile');
  const offset = useServerOffset();
  const q = useEligibilityDrives();
  const items = useMemo(() => q.data ?? [], [q.data]);
  const [tab, setTab] = useState<GroupKey>('eligible');
  const counts = useMemo(
    () => ({
      eligible: items.filter((d) => d.eligibility.status === 'eligible').length,
      pending: items.filter((d) => d.eligibility.status === 'pending').length,
      not_eligible: items.filter((d) => d.eligibility.status === 'not_eligible').length,
      // 'restricted' is not in the EligDrive union but the server sends it; without this group those drives vanished from every tab
      restricted: items.filter((d) => (d.eligibility.status as string) === 'restricted').length,
    }),
    [items],
  );
  const group = GROUPS.find((g) => g.key === tab) ?? GROUPS[0];
  const rows = items.filter((d) => (d.eligibility.status as string) === group.key);

  return (
    <Page title="Eligibility" onBack={back} onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Text variant="body" color={colors.muted}>Open drives grouped by whether your profile meets their rules. Results update when you change your profile.</Text>
      <QueryBoundary
        isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()}
        isEmpty={items.length === 0}
        empty={{ title: 'No open drives right now', message: 'When the placement cell publishes drives, you will see here whether you are eligible.', actionLabel: 'Check my profile', onAction: () => router.push('/(student)/(tabs)/profile' as never) }}
        skeletonRows={3} skeletonHeight={196}
      >
        <View style={{ gap: sp.lg }}>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <StatTile label="Eligible" value={counts.eligible} icon="check-circle-outline" tone="success" />
            <StatTile label="Pending" value={counts.pending} icon="hourglass-empty" tone="warning" />
            <StatTile label="Not eligible" value={counts.not_eligible} icon="block" tone="error" />
          </View>
          <SegmentedTabs
            value={tab}
            onChange={(v) => setTab(v as GroupKey)}
            options={GROUPS.filter((g) => g.key !== 'restricted' || counts.restricted > 0 || tab === 'restricted').map((g) => ({ value: g.key, label: g.title, count: counts[g.key] }))}
          />
          <Text variant="caption" color={colors.muted}>{group.hint}</Text>
          {rows.length === 0 ? (
            <EmptyState icon="inbox" title={`No ${group.title.toLowerCase()} drives`} message="Nothing here right now." />
          ) : (
            rows.map((d) => <EligItem key={d.id} d={d} offset={offset} />)
          )}
        </View>
      </QueryBoundary>
    </Page>
  );
}
