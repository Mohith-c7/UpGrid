import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Chip, EmptyState, ErrorState, HeaderAction, Icon, ListRow, SearchBar, SegmentedControl, Sheet, Skeleton, StatTile, Text, useIsOnline, useToast } from '@/ui';
import { colors, MIN_TOUCH, radius, shadow } from '@/theme';
import { errMessage } from '@/api/client';
import { fetchResultsCsv, uniqueById, useAssessment, usePublishResults, useResults, type ResultRow } from '@/api/assessments';
import { shareTextFile } from '@/lib/shareFile';
import { ConfirmSheet, ListFrame, MoreFooter, ROOT, fmtDuration, fmtNum } from '@/features/assessments/kit';
import { RegradeSheet } from '@/features/assessments/sheets';
import { useOnce } from '@/features/officer/components/common';

const STATUS = [{ value: '', label: 'All' }, { value: 'submitted', label: 'Submitted' }, { value: 'in_progress', label: 'In progress' }, { value: 'not_attempted', label: 'Not attempted' }];
const PASS = [{ value: '', label: 'Any' }, { value: '1', label: 'Passed' }, { value: '0', label: 'Failed' }];
const SORT = [{ value: 'rank', label: 'Rank' }, { value: 'score', label: 'Score' }, { value: 'name', label: 'Name' }, { value: 'time', label: 'Time' }];

function LeaderRow({ row, onPress }: { row: ResultRow; onPress?: () => void }) {
  const done = row.status === 'submitted';
  const label = `${row.rank ? `Rank ${row.rank}. ` : ''}${row.name}. ${row.status.replace('_', ' ')}${done ? `. ${fmtNum(row.score)} of ${fmtNum(row.maxScore)}` : ''}`;
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, ...shadow.card }}>
      <Pressable disabled={!onPress} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, minHeight: MIN_TOUCH, borderRadius: radius.card, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}>
        <View style={{ minWidth: 44, alignItems: 'center' }}>
          <Text variant="overline" color={colors.muted}>Rank</Text>
          <Text variant="title" tabular>{row.rank ?? '-'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="subhead" numberOfLines={2}>{row.name}</Text>
          {row.registrationNumber ? <Text variant="caption" color={colors.muted} tabular numberOfLines={1}>{row.registrationNumber}</Text> : null}
          {done ? (
            <Text variant="body" tabular>{fmtNum(row.score)} / {fmtNum(row.maxScore)}  <Text variant="caption" color={colors.muted}>({fmtNum(row.percent, 1)}%)</Text></Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {row.status === 'submitted' ? <Badge label="Submitted" tone="info" /> : row.status === 'in_progress' ? <Badge label="In progress" tone="warning" icon="hourglass-empty" /> : <Badge label="Not attempted" tone="neutral" />}
            {done && row.passed === true ? <Badge label="Passed" tone="success" icon="check-circle-outline" /> : null}
            {done && row.passed === false ? <Badge label="Failed" tone="error" icon="cancel" /> : null}
            {row.evaluation === 'pending' ? <Badge label="Evaluating" tone="warning" icon="hourglass-empty" /> : null}
            {row.flags?.plagiarism ? <Badge label="Plagiarism flag" tone="error" icon="flag" /> : null}
            {row.flags?.overridden ? <Badge label="Score overridden" tone="info" icon="edit" /> : null}
            {row.flags?.autoSubmitted ? <Badge label="Auto-submitted" tone="warning" /> : null}
            {row.proctorWarnings > 0 ? <Badge label={`${row.proctorWarnings} warning${row.proctorWarnings === 1 ? '' : 's'}`} tone="warning" icon="warning-amber" /> : null}
          </View>
          {done && row.timeTakenSeconds != null ? <Text variant="caption" color={colors.muted} tabular>Time taken {fmtDuration(row.timeTakenSeconds)}</Text> : null}
        </View>
        {onPress ? <Icon name="chevron-right" size={24} color={colors.subtle} /> : null}
      </Pressable>
    </View>
  );
}

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const a = useAssessment(id);
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [status, setStatus] = useState(''); const [passed, setPassed] = useState(''); const [flagged, setFlagged] = useState(false); const [sort, setSort] = useState('rank');
  const [filtersOpen, setFiltersOpen] = useState(false); const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmPub, setConfirmPub] = useState(false); const [regradeOpen, setRegradeOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const query = useResults(id, { q: dq || undefined, status: status || undefined, passed: (passed || undefined) as any, flagged, sort: sort as any });
  const pub = usePublishResults();
  const items = useMemo(() => uniqueById(query.data?.pages.flatMap((p) => p.items.map((x) => ({ ...x, id: x.studentId }))) ?? []), [query.data]);
  const summary = query.data?.pages[0]?.summary;
  const released = query.data?.pages[0]?.released ?? false;
  const hasCoding = !!a.data?.sections.some((s) => s.questions.some((x) => x.type === 'coding'));
  const manual = a.data?.settings.resultVisibility === 'manual';
  const filterCount = [status, passed, flagged ? 'f' : ''].filter(Boolean).length;

  const [doExport, exporting] = useOnce(async () => {
    if (!online) { toast.show('You are offline. Connect to export.', 'error'); return; }
    try {
      const csv = await fetchResultsCsv(id!);
      const slug = (a.data?.title ?? 'results').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'results';
      await shareTextFile(`results-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv', 'Export results');
    } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doPublish, pubBusy] = useOnce(async () => {
    const publish = !a.data?.resultsPublishedAt;
    try {
      const res = await pub.mutateAsync({ id: id!, publish });
      setConfirmPub(false);
      toast.show(publish ? (res.alreadyPublished ? 'Results were already published' : `Results published. ${res.notified ?? 0} student${res.notified === 1 ? '' : 's'} notified.`) : 'Results hidden again', 'success');
      void a.refetch();
    } catch (e) { setConfirmPub(false); toast.show(errMessage(e), 'error'); }
  });
  const publishedManually = !!a.data?.resultsPublishedAt;
  const go = (path: string) => { setActionsOpen(false); r.push(`${ROOT}/${id}/${path}` as any); };

  return (
    <ListFrame title="Results" subtitle={a.data?.title} right={<HeaderAction icon="more-vert" label="More actions" onPress={() => setActionsOpen(true)} />}>
      <FlatList
        data={query.isLoading || query.isError ? [] : items}
        keyExtractor={(x) => x.studentId}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => { void query.refetch(); void a.refetch(); }}
        ListHeaderComponent={(
          <View style={{ gap: 12, marginBottom: 4 }}>
            {summary ? (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <StatTile label="Participants" value={`${summary.participants}/${summary.audience}`} icon="groups" />
                  <StatTile label="Average" value={fmtNum(summary.avg, 1)} icon="functions" />
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <StatTile label="Median" value={fmtNum(summary.median, 1)} icon="align-vertical-center" />
                  <StatTile label="Pass rate" value={summary.passRate == null ? '-' : `${fmtNum(summary.passRate, 0)}%`} icon="check-circle-outline" />
                </View>
                {summary.pendingEvaluation > 0 ? <Banner tone="warning" title="Some answers are still being evaluated" message={`${summary.pendingEvaluation} attempt${summary.pendingEvaluation === 1 ? '' : 's'} have coding answers in the judge queue. Scores and ranks can still change. Pull down to refresh.`} /> : null}
              </>
            ) : null}
            {query.data ? (
              released
                ? <Banner tone="success" message={manual && publishedManually ? 'Results are visible to students.' : 'Results are visible to students under the visibility rule you set.'} action={manual && publishedManually ? { label: 'Hide results', onPress: () => setConfirmPub(true) } : undefined} />
                : <Banner tone="info" title="Students cannot see results yet" message={manual ? 'Results are released manually.' : 'They appear after the test closes.'} action={{ label: 'Publish results now', onPress: () => setConfirmPub(true) }} />
            ) : null}
            <SearchBar value={q} onChangeText={setQ} placeholder="Search name, email or reg. no." />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button label={filterCount ? `Filters (${filterCount})` : 'Filters'} icon="filter-list" variant="secondary" size="sm" onPress={() => setFiltersOpen(true)} />
              {status ? <Chip label={STATUS.find((s) => s.value === status)?.label ?? status} selected onPress={() => setStatus('')} /> : null}
              {passed ? <Chip label={passed === '1' ? 'Passed' : 'Failed'} selected onPress={() => setPassed('')} /> : null}
              {flagged ? <Chip label="Flagged only" selected onPress={() => setFlagged(false)} /> : null}
            </View>
            <SegmentedControl value={sort} onChange={setSort} options={SORT} />
          </View>
        )}
        renderItem={({ item }) => <LeaderRow row={item} onPress={item.attemptId ? () => r.push(`${ROOT}/${id}/attempt/${item.attemptId}` as any) : undefined} />}
        ListEmptyComponent={
          query.isLoading ? <View style={{ gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={110} radius={14} />)}</View>
          : query.isError ? <ErrorState message={errMessage(query.error)} onRetry={() => { void query.refetch(); }} />
          : <EmptyState icon="leaderboard" title={dq || filterCount ? 'No students match' : 'No results yet'} message={dq || filterCount ? 'Try clearing the search or filters.' : 'Results appear here as students submit.'} />
        }
        ListFooterComponent={items.length ? <MoreFooter hasMore={query.hasNextPage} loading={query.isFetchingNextPage} error={query.isFetchNextPageError} onMore={() => { void query.fetchNextPage(); }} onRetry={() => { void query.fetchNextPage(); }} /> : undefined}
      />

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter results">
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Attempt status</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{STATUS.map((s) => <Chip key={s.value} label={s.label} selected={status === s.value} onPress={() => setStatus(s.value)} />)}</View>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Outcome</Text>
          <SegmentedControl value={passed} onChange={setPassed} options={PASS} />
          <Chip label="Flagged only (plagiarism, proctor, override)" selected={flagged} onPress={() => setFlagged((f) => !f)} />
          <Button label="Show results" full onPress={() => setFiltersOpen(false)} />
          <Button label="Clear filters" variant="ghost" full onPress={() => { setStatus(''); setPassed(''); setFlagged(false); }} />
        </View>
      </Sheet>

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title="Result actions">
        <View style={{ paddingBottom: 12 }}>
          <ListRow icon="file-download" title="Export CSV" subtitle={exporting ? 'Preparing file...' : 'Share the full leaderboard as a spreadsheet'} onPress={() => { setActionsOpen(false); if (!exporting) void doExport(); }} />
          <ListRow icon="insights" title="Analytics" subtitle="Score distribution, question difficulty" onPress={() => go('analytics')} />
          {hasCoding ? <ListRow icon="policy" title="Plagiarism report" subtitle="Similar coding submissions" onPress={() => go('plagiarism')} /> : null}
          <ListRow icon="how-to-reg" title="Shortlist" subtitle="Move students to the next stage" onPress={() => go('shortlist')} />
          <ListRow icon="published-with-changes" title="Regrade" subtitle="Recompute scores after an answer-key fix" onPress={() => { setActionsOpen(false); setRegradeOpen(true); }} />
          <ListRow icon={publishedManually ? 'visibility-off' : 'visibility'} title={publishedManually ? 'Unpublish results' : 'Publish results'} subtitle="Control when students see their scores" onPress={() => { setActionsOpen(false); setConfirmPub(true); }} last />
        </View>
      </Sheet>

      <ConfirmSheet visible={confirmPub} onClose={() => setConfirmPub(false)} title={publishedManually ? 'Hide results?' : 'Publish results?'} confirmLabel={publishedManually ? 'Unpublish' : 'Publish'} tone={publishedManually ? 'danger' : 'primary'}
        message={publishedManually ? 'Students will no longer see their scores unless the visibility rule already shows them.' : 'Every student who submitted is notified and can see their score and rank.'} onConfirm={() => doPublish()} disabled={pubBusy} />
      <RegradeSheet assessmentId={id!} visible={regradeOpen} onClose={() => setRegradeOpen(false)} hasCoding={hasCoding} />
    </ListFrame>
  );
}
