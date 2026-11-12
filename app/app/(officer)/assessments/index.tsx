import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Chip, EmptyState, ErrorState, HeaderAction, Icon, SearchBar, SegmentedTabs, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { uniqueById, useAssessments, type AssessmentSummary } from '@/api/assessments';
import { formatDateTimeIST } from '@/lib/format';
import { AssessmentStatusBadge, ListFrame, MoreFooter, Pill, ROOT } from '@/features/assessments/kit';

const TABS = [{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }];

function windowText(a: AssessmentSummary): string {
  if (a.practice) return 'Practice set, always open';
  if (!a.opensAt || !a.closesAt) return 'Schedule not set';
  return `${formatDateTimeIST(a.opensAt)} to ${formatDateTimeIST(a.closesAt)}`;
}

export function AssessmentCard({ a, onPress }: { a: AssessmentSummary; onPress: () => void }) {
  const drive = a.drive ? `${a.drive.company} · ${a.drive.role}` : null;
  return (
    <Card onPress={onPress} accessibilityLabel={`${a.title}. ${a.status}. ${windowText(a)}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Text variant="subhead" style={{ flex: 1 }} numberOfLines={2}>{a.title}</Text>
        <Icon name="chevron-right" size={24} color={colors.subtle} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <AssessmentStatusBadge status={a.status} />
        {a.practice ? <Chip label="Practice" icon="fitness-center" /> : null}
      </View>
      {drive ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{drive}</Text> : null}
      <Text variant="caption" color={colors.muted} tabular>{windowText(a)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pill icon="help-outline" text={`${a.questionCount ?? 0} questions`} />
        <Pill icon="stars" text={`${a.totalMarks ?? 0} marks`} />
        <Pill icon="timer" text={`${a.durationMinutes} min`} />
        {a.status !== 'draft' && a.counts ? <Pill icon="groups" text={`${a.counts.submitted}/${a.counts.attempts} submitted`} /> : null}
      </View>
    </Card>
  );
}

export default function AssessmentsHome() {
  const r = useRouter();
  const { driveId } = useLocalSearchParams<{ driveId?: string }>();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [practice, setPractice] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const query = useAssessments({ status: tab === 'all' ? undefined : tab, practice, q: dq || undefined });
  const all = useMemo(() => uniqueById(query.data?.pages.flatMap((p) => p.items) ?? []), [query.data]);
  const items = useMemo(() => (driveId ? all.filter((a) => a.driveId === driveId) : all), [all, driveId]);
  const driveLabel = driveId ? all.find((a) => a.driveId === driveId)?.drive : null;

  // when filtering by drive, keep pulling pages so older matches are not hidden
  useEffect(() => {
    if (driveId && query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
  }, [driveId, query.hasNextPage, query.isFetchingNextPage, query.isError, query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const newHref = driveId ? `${ROOT}/builder/new?driveId=${driveId}` : `${ROOT}/builder/new`;
  return (
    <ListFrame
      title="Tests"
      subtitle={driveId ? (driveLabel ? `${driveLabel.company} · ${driveLabel.role}` : 'For one drive') : undefined}
      right={<HeaderAction icon="library-books" label="Question bank" onPress={() => r.push(`${ROOT}/questions` as any)} />}
      footer={<Button label="New test" icon="add" full onPress={() => r.push(newHref as any)} />}
    >
      <FlatList
        data={query.isLoading || query.isError ? [] : items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => { void query.refetch(); }}
        ListHeaderComponent={(
          <View style={{ gap: 12, marginBottom: 4 }}>
            <SearchBar value={q} onChangeText={setQ} placeholder="Search tests by title" />
            <SegmentedTabs value={tab} onChange={setTab} options={TABS} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Practice sets only" selected={practice} onPress={() => setPractice((p) => !p)} />
              {driveId ? <Chip label="This drive only" selected onPress={() => r.setParams({ driveId: undefined as any })} /> : null}
            </View>
          </View>
        )}
        renderItem={({ item }) => <AssessmentCard a={item} onPress={() => r.push(`${ROOT}/${item.id}` as any)} />}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={150} radius={14} />)}</View>
          ) : query.isError ? (
            <ErrorState message={errMessage(query.error)} onRetry={() => { void query.refetch(); }} />
          ) : (
            <EmptyState icon="quiz" title={dq || practice || tab !== 'all' || driveId ? 'No tests match' : 'No tests yet'}
              message={dq || practice || tab !== 'all' || driveId ? 'Try clearing the search or filters.' : 'Create a test from your question bank, then attach it to a drive.'}
              actionLabel={dq || practice || tab !== 'all' ? undefined : 'New test'} onAction={dq || practice || tab !== 'all' ? undefined : () => r.push(newHref as any)} />
          )
        }
        ListFooterComponent={items.length ? (
          <MoreFooter hasMore={query.hasNextPage && !driveId} loading={query.isFetchingNextPage} error={query.isFetchNextPageError}
            onMore={() => { void query.fetchNextPage(); }} onRetry={() => { void query.fetchNextPage(); }} />
        ) : undefined}
      />
    </ListFrame>
  );
}
