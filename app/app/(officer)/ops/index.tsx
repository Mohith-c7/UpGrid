import React from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ListRow, SectionHeader, Text } from '@/ui';
import { colors } from '@/theme';
import { api } from '@/api/client';
import { useOpsSettings, useAppeals } from '@/api/ops';
import { OpsPage, useGo } from '@/features/ops/kit';
import { OPS_ROUTES } from '@/features/ops/routes';

export default function OperationsHub() {
  const go = useGo();
  const appeals = useAppeals('pending');
  const docs = useQuery({ queryKey: ['ops', 'hub-docs'], queryFn: async () => (await api.get<{ items: unknown[]; nextCursor?: string | null }>('/documents/queue?status=pending&limit=50')).items.length });
  const settings = useOpsSettings();
  const refresh = () => { void appeals.refetch(); void docs.refetch(); void settings.refetch(); };
  const row = (r: (typeof OPS_ROUTES)[number], right?: React.ReactNode, last?: boolean) => (
    <ListRow key={r.path} icon={r.icon} title={r.title} subtitle={r.subtitle} right={right} onPress={() => go(r.path)} last={last} />
  );
  const find = (k: string) => OPS_ROUTES.find((r) => r.key === k)!;
  const pendingAppeals = appeals.data?.length ?? 0;
  const pendingDocs = docs.data ?? 0;
  return (
    <OpsPage title="Operations" subtitle="Analytics, policy and records" back="/(officer)/(tabs)/more" onRefresh={refresh} refreshing={appeals.isRefetching || docs.isRefetching}>
      <Text variant="body" color={colors.muted}>Tools for the placement cell. Changes here are recorded in the audit log.</Text>

      <SectionHeader title="Insight" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {row(find('analytics'))}
        {row(find('calendar'))}
        {row(find('audit'), undefined, true)}
      </Card>

      <SectionHeader title="Rules" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {row(find('policy'))}
        {row(find('restrictions'), pendingAppeals > 0 ? <Badge label={`${pendingAppeals} ${pendingAppeals === 1 ? 'appeal' : 'appeals'}`} tone="warning" /> : undefined)}
        {row(find('cohorts'), undefined, true)}
      </Card>

      <SectionHeader title="People and companies" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {row(find('announcements'))}
        {row(find('companies'))}
        {row(find('documents'), pendingDocs > 0 ? <Badge label={`${pendingDocs}${pendingDocs >= 50 ? '+' : ''} pending`} tone="warning" /> : undefined, true)}
      </Card>

      <SectionHeader title="Configuration" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        {row(find('settings'), undefined, true)}
      </Card>
      <View style={{ height: 4 }} />
    </OpsPage>
  );
}
