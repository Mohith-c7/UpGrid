import React from 'react';
import { Badge, Card, HeaderAction, Text } from '@/ui';
import { View } from 'react-native';
import { colors } from '@/theme';
import { useCohorts } from '@/api/ops';
import { Async, OpsPage, useGo } from '@/features/ops/kit';

export default function Cohorts() {
  const go = useGo();
  const q = useCohorts();
  return (
    <OpsPage title="Cohorts" back="/(officer)/ops" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}
      right={<HeaderAction icon="add" label="New cohort" onPress={() => go('/(officer)/ops/cohorts/new')} />}>
      <Text variant="body" color={colors.muted}>A cohort is a named group of students. Use it as an announcement audience.</Text>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} isEmpty={(q.data?.length ?? 0) === 0}
        empty={{ icon: 'groups', title: 'No cohorts yet', message: 'Create one from filters (like final year, CGPA 7+) or pick students by hand.', actionLabel: 'New cohort', onAction: () => go('/(officer)/ops/cohorts/new') }}>
        {q.data?.map((c) => (
          <Card key={c.id} onPress={() => go(`/(officer)/ops/cohorts/${c.id}`)} accessibilityLabel={`${c.name}, ${c.memberCount} students`} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text variant="subhead" style={{ flexShrink: 1 }}>{c.name}</Text>
              <Badge label={c.kind === 'dynamic' ? 'From filters' : 'Hand picked'} tone="info" icon={c.kind === 'dynamic' ? 'filter-list' : 'person'} />
            </View>
            {c.description ? <Text variant="body" color={colors.textSecondary} numberOfLines={2}>{c.description}</Text> : null}
            <Text variant="caption" tabular color={colors.muted}>{c.memberCount} {c.memberCount === 1 ? 'student' : 'students'}</Text>
          </Card>
        ))}
      </Async>
    </OpsPage>
  );
}
