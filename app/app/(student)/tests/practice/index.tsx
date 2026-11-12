import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorState, Header, Icon, OfflineBanner, Screen, SearchBar, SegmentedTabs, Skeleton, Text } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { flatten } from '@/api/hooks';
import { usePracticeProblems, usePracticeSets, useStartAttempt } from '@/api/tests';
import type { PracticeAssessmentItem, PracticeProblemItem } from '@/api/testsTypes';
import { TestsGate } from '@/features/tests/Gate';
import { fmtMarks, fmtMinutes, netMessage, plural, sp } from '@/features/tests/kit';
import { langLabel } from '@/features/tests/CodingPanel';

const DIFF_TONE = { easy: 'success', medium: 'warning', hard: 'error' } as const;

function useDebounced<T>(v: T, ms: number): T {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
}

function ProblemCard({ p, onPress }: { p: PracticeProblemItem; onPress: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${p.title}. ${p.difficulty}. ${p.solved ? 'Solved' : p.attempted ? 'Attempted' : 'Not attempted'}`}>
      <View style={{ gap: sp.sm }}>
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start' }}>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>{p.title}</Text>
          <Icon name="chevron-right" size={24} color={colors.subtle} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignItems: 'center' }}>
          <Badge label={p.difficulty ? p.difficulty[0].toUpperCase() + p.difficulty.slice(1) : 'Unrated'} tone={DIFF_TONE[p.difficulty] ?? 'neutral'} icon={false} />
          {p.solved ? <Badge label="Solved" tone="success" icon="check-circle" /> : p.attempted ? <Badge label={`Attempted, best ${Math.round(p.bestPercent ?? 0)}%`} tone="info" icon="timelapse" /> : <Badge label="Not attempted" tone="neutral" icon="radio-button-unchecked" />}
        </View>
        <Text variant="caption" color={colors.muted} numberOfLines={2}>
          {[p.topic, ...(p.tags ?? []).slice(0, 2), (p.languages ?? []).map(langLabel).join(', ')].filter(Boolean).join('  |  ')}
        </Text>
      </View>
    </Card>
  );
}

function Problems() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q.trim(), 400);
  const query = usePracticeProblems({ q: dq || undefined, difficulty: difficulty || undefined, status: status || undefined });
  const items = useMemo(() => flatten(query.data), [query.data]);
  const refresh = () => void query.refetch();

  const header = (
    <View style={{ gap: sp.md, paddingBottom: sp.md }}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search problems" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {[['', 'Any level'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].map(([v, l]) => (
          <Chip key={v || 'any'} label={l} selected={difficulty === v} onPress={() => setDifficulty(v)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {[['', 'All'], ['unsolved', 'Unsolved'], ['solved', 'Solved']].map(([v, l]) => (
          <Chip key={v || 'all'} label={l} selected={status === v} onPress={() => setStatus(v)} />
        ))}
      </View>
    </View>
  );

  if (query.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>{header}{[0, 1, 2].map((i) => <Skeleton key={i} height={110} radius={14} />)}</View>;
  if (query.isError && items.length === 0) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>{header}<ErrorState title="Could not load problems" message={netMessage(query.error)} onRetry={refresh} /></View>;
  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, flexGrow: 1 }}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: sp.md }} />}
      renderItem={({ item }) => <ProblemCard p={item} onPress={() => router.push(`/(student)/tests/practice/problem/${item.id}` as never)} />}
      ListEmptyComponent={<EmptyState icon="code" title="No problems found" message={dq || difficulty || status ? 'Try a different search or filter.' : 'Practice problems added by your placement cell appear here.'} actionLabel="Refresh" onAction={refresh} />}
      ListFooterComponent={query.hasNextPage ? <View style={{ paddingTop: sp.lg }}><Button label="Load more" variant="secondary" full loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} /></View> : undefined}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
    />
  );
}

function SetCard({ s, onStart, busy }: { s: PracticeAssessmentItem; onStart: () => void; busy: boolean }) {
  return (
    <Card>
      <View style={{ gap: sp.sm }}>
        <Text variant="subhead">{s.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: sp.lg, rowGap: 2 }}>
          <Text variant="caption" tabular color={colors.textSecondary}>{fmtMinutes(s.durationMinutes)}</Text>
          <Text variant="caption" tabular color={colors.textSecondary}>{plural(s.questionCount, 'question')}</Text>
          <Text variant="caption" tabular color={colors.textSecondary}>{`${fmtMarks(s.totalMarks)} marks`}</Text>
        </View>
        <Text variant="caption" tabular color={colors.muted}>
          {s.attemptsUsed > 0 ? `${plural(s.attemptsUsed, 'attempt')}${s.lastScore !== null ? `, last score ${fmtMarks(s.lastScore)}` : ''}` : 'Not attempted yet'}
        </Text>
        <Button label={s.attemptsUsed > 0 ? 'Practise again' : 'Start practice'} icon="play-arrow" size="sm" loading={busy} onPress={onStart} />
      </View>
    </Card>
  );
}

function Sets() {
  const router = useRouter();
  const q = usePracticeSets();
  const start = useStartAttempt();
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const go = async (id: string) => {
    setErr(null);
    setBusyId(id);
    try {
      const s = await start.mutateAsync(id);
      router.push(`/(student)/tests/attempt/${s.attempt.id}` as never);
    } catch (e) {
      setErr(netMessage(e, 'Could not start this practice set.'));
    } finally {
      setBusyId(null);
    }
  };
  if (q.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>{[0, 1].map((i) => <Skeleton key={i} height={130} radius={14} />)}</View>;
  if (q.isError) return <View style={{ padding: SCREEN_PADDING }}><ErrorState title="Could not load practice sets" message={netMessage(q.error)} onRetry={() => void q.refetch()} /></View>;
  const items = q.data ?? [];
  return (
    <FlatList
      data={items}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, flexGrow: 1, gap: sp.md }}
      ListHeaderComponent={err ? <Banner tone="error" message={err} /> : <Banner tone="info" message="Practice sets are timed like real tests but never ranked. You see your score and answers straight away." />}
      renderItem={({ item }) => <SetCard s={item} busy={busyId === item.id} onStart={() => void go(item.id)} />}
      ListEmptyComponent={<EmptyState icon="assignment" title="No practice sets yet" message="Practice sets published by your placement cell appear here." actionLabel="Refresh" onAction={() => void q.refetch()} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
    />
  );
}

export default function PracticeHome() {
  const router = useRouter();
  const focused = useIsFocused();
  const [tab, setTab] = useState<'problems' | 'sets'>('problems');
  return (
    <Screen padded={false} edges={['bottom']}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="Practice" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/tests' as never))} />
      <TestsGate>
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: SCREEN_PADDING, backgroundColor: colors.surface }}>
            <OfflineBanner />
            <SegmentedTabs value={tab} onChange={(v) => setTab(v as 'problems' | 'sets')} options={[{ value: 'problems', label: 'Coding problems' }, { value: 'sets', label: 'Practice sets' }]} />
          </View>
          {tab === 'problems' ? (
            <TestsGate needCode>
              <Problems />
            </TestsGate>
          ) : (
            <Sets />
          )}
        </View>
      </TestsGate>
    </Screen>
  );
}
