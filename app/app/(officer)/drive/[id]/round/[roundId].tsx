import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Icon, ListRow, SectionHeader, SegmentedTabs, Sheet, Text, useToast } from '@/ui';
import { colors, MIN_TOUCH, radius, SCREEN_PADDING, shadow } from '@/theme';
import { flattenPages, pipeError, useRoundCandidateActions, useRoundCandidates, useRounds } from '@/api/pipeline';
import type { BulkResult, RoundCandidate } from '@/api/pipelineTypes';
import { Boundary, CandidateStatusBadge, confirm, KIND_LABEL, LoadMore, Page, sp, useOnce } from '@/features/pipeline/kit';
import { AdvanceSheet } from '@/features/pipeline/officer/AdvanceSheet';
import { ResultsSheet } from '@/features/pipeline/officer/ResultsSheet';
import { TokenSheet } from '@/features/pipeline/officer/TokenSheet';

const TAB_KEYS = ['all', 'pending', 'invited', 'attended', 'absent', 'passed', 'failed', 'on_hold', 'waitlist'] as const;
const TAB_LABEL: Record<string, string> = { all: 'All', pending: 'Not invited', invited: 'Invited', attended: 'Attended', absent: 'Absent', passed: 'Passed', failed: 'Not passed', on_hold: 'On hold', waitlist: 'Waitlist' };

function summarize(verb: string, r: BulkResult): { tone: 'success' | 'warning'; text: string } {
  const failed = r.failed ?? [];
  const n = r.updated ?? r.promoted ?? r.added ?? 0;
  const base = `${n} ${verb}${r.unchanged ? `, ${r.unchanged} unchanged` : ''}${failed.length ? `, ${failed.length} failed` : ''}.`;
  return { tone: failed.length ? 'warning' : 'success', text: failed.length ? `${base} ${failed.slice(0, 3).map((f) => f.reason).join('; ')}${failed.length > 3 ? '; and more' : ''}` : base };
}

export default function RoundCandidatesScreen() {
  const { id, roundId } = useLocalSearchParams<{ id: string; roundId: string }>();
  const driveId = String(id); const rid = String(roundId);
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<string>('all');
  const roundsQ = useRounds(driveId);
  const round = roundsQ.data?.find((r) => r.id === rid);
  const q = useRoundCandidates(driveId, rid, { status: tab === 'all' || tab === 'waitlist' ? undefined : tab, waitlisted: tab === 'waitlist' });
  const act = useRoundCandidateActions(driveId, rid);
  const items: RoundCandidate[] = useMemo(() => {
    const seen = new Set<string>();
    return flattenPages(q.data?.pages).filter((c) => !seen.has(c.applicationId) && (seen.add(c.applicationId), true));
  }, [q.data]);
  const counts = q.data?.pages?.[0]?.counts ?? {};
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/rounds` as never));
  const ids = [...picked];
  const toggle = (a: string) => setPicked((p) => { const n = new Set(p); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  const allPicked = items.length > 0 && items.every((c) => picked.has(c.applicationId));

  /** Run a bulk mutation, report counts + the first failure reasons, keep only failed rows selected. */
  const [run, busy] = useOnce(async (verb: string, fn: () => Promise<BulkResult>) => {
    setNotice(null); setActionsOpen(false);
    try {
      const r = await fn();
      const s = summarize(verb, r);
      setNotice(s);
      const failedIds = new Set((r.failed ?? []).map((f) => f.applicationId).filter(Boolean) as string[]);
      setPicked(failedIds);
    } catch (e) { setNotice({ tone: 'error', text: pipeError(e) }); }
  });

  const tabs = TAB_KEYS.map((k) => ({
    value: k, label: TAB_LABEL[k],
    count: k === 'all' ? undefined : k === 'waitlist' ? (counts as Record<string, number>).waitlisted : (counts as Record<string, number>)[k],
  }));
  const rows = ids.map((applicationId) => ({ applicationId }));

  const renderItem = ({ item: c }: { item: RoundCandidate }) => {
    const sel = picked.has(c.applicationId);
    const meta = [c.reference, c.department, c.cgpa != null ? `CGPA ${Number(c.cgpa).toFixed(2)}` : null].filter(Boolean).join(' · ');
    return (
      <Pressable onPress={() => toggle(c.applicationId)} accessibilityRole="checkbox" accessibilityState={{ checked: sel }}
        accessibilityLabel={`${c.name}, ${c.status}${c.waitlisted ? ', waitlisted' : ''}`}
        style={{ minHeight: MIN_TOUCH, padding: 14, gap: 8, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, ...shadow.card }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Icon name={sel ? 'check-box' : 'check-box-outline-blank'} size={26} color={sel ? colors.primary : colors.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subhead">{c.name}</Text>
            {meta ? <Text variant="caption" color={colors.muted} tabular>{meta}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CandidateStatusBadge status={c.status} />
          {c.waitlisted ? <Badge label={c.waitlistRank ? `Waitlist #${c.waitlistRank}` : 'Waitlisted'} tone="warning" icon="hourglass-empty" /> : null}
          {c.score != null ? <Badge label={`Score ${c.score}`} tone="neutral" icon="grade" /> : null}
          {c.avgScore != null ? <Badge label={`Avg ${c.avgScore}`} tone="neutral" icon="star-outline" /> : null}
        </View>
        {c.remark ? <Text variant="caption" color={colors.textSecondary}>{c.remark}</Text> : null}
      </Pressable>
    );
  };

  const header = (
    <View style={{ gap: sp.md, paddingBottom: sp.md }}>
      {round ? (
        <Card>
          <View style={{ gap: 4 }}>
            <Text variant="overline" color={colors.muted}>{`Round ${round.seq}`}</Text>
            <Text variant="title">{round.name}</Text>
            <Text variant="caption" color={colors.muted}>{KIND_LABEL[round.kind] ?? round.kind}</Text>
          </View>
        </Card>
      ) : null}
      {notice ? <Banner tone={notice.tone} message={notice.text} /> : null}
      <Card padding={0}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <ListRow icon="person-add-alt" title="Add screened candidates" subtitle="Everyone shortlisted in screening or later"
            onPress={() => confirm('Add all screened candidates?', 'Every applicant whose status is screening, assessment, interview or selected is added to this round.', 'Add candidates', () => { void run('added', () => act.addCandidates.mutateAsync({ allScreened: true })); }, false)} />
          <ListRow icon="qr-code-2" title="Attendance QR" subtitle="Create or revoke a scan code" onPress={() => setTokenOpen(true)} />
          <ListRow icon="upload-file" title="Upload results" subtitle="Paste reference, result, score" onPress={() => setResultsOpen(true)} />
          <ListRow icon="arrow-forward" title="Advance to next round" subtitle="Preview, then confirm" last onPress={() => setAdvanceOpen(true)} />
        </View>
      </Card>
      <SectionHeader title="Candidates" subtitle="Tap to select, then act on the whole selection" />
      <SegmentedTabs value={tab} onChange={(v) => { setTab(v); setPicked(new Set()); }} options={tabs} />
      {items.length > 0 ? (
        <Button label={allPicked ? 'Clear selection' : `Select all ${items.length} shown`} size="sm" variant="secondary" icon={allPicked ? 'deselect' : 'select-all'}
          onPress={() => setPicked(allPicked ? new Set() : new Set(items.map((c) => c.applicationId)))} />
      ) : null}
    </View>
  );

  const footer = picked.size > 0 ? (
    <>
      <Button label={`Mark present (${picked.size})`} icon="how-to-reg" full loading={busy} onPress={() => run('marked', () => act.attendance.mutateAsync(ids.map((applicationId) => ({ applicationId, present: true }))))} />
      <Button label={`More actions (${picked.size})`} variant="secondary" full disabled={busy} onPress={() => setActionsOpen(true)} />
    </>
  ) : undefined;

  return (
    <Page title="Round candidates" onBack={back} scroll={false} footer={footer}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.applicationId}
        extraData={picked}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { void q.refetch(); void roundsQ.refetch(); }} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={110} isEmpty
            empty={{ icon: 'groups', title: tab === 'all' ? 'No candidates in this round' : 'Nobody in this view', message: tab === 'all' ? 'Add screened candidates to start the round.' : 'Try another tab.' }}>
            {null}
          </Boundary>
        }
        ListFooterComponent={<LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} failed={q.isFetchNextPageError} onMore={() => { void q.fetchNextPage(); }} />}
      />

      {round ? <AdvanceSheet driveId={driveId} round={round} rounds={roundsQ.data ?? []} selectedIds={ids} visible={advanceOpen} onClose={() => setAdvanceOpen(false)} /> : null}
      <ResultsSheet driveId={driveId} roundId={rid} visible={resultsOpen} onClose={() => setResultsOpen(false)} />
      <TokenSheet driveId={driveId} roundId={rid} roundName={round?.name ?? 'this round'} visible={tokenOpen} onClose={() => setTokenOpen(false)} />

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title={`${picked.size} selected`}>
        <View style={{ paddingBottom: sp.sm }}>
          <ListRow icon="mail-outline" title="Invite" subtitle="Notify them they are invited" onPress={() => confirm('Invite selected candidates?', `${picked.size} candidate${picked.size === 1 ? '' : 's'} will be notified that they are invited.`, 'Invite', () => { void run('invited', () => act.setStatus.mutateAsync(ids.map((applicationId) => ({ applicationId, status: 'invited' })))); }, false)} />
          <ListRow icon="person-off" title="Mark absent" onPress={() => run('marked', () => act.attendance.mutateAsync(ids.map((applicationId) => ({ applicationId, present: false }))))} />
          <ListRow icon="check-circle-outline" title="Result: passed" subtitle="Hidden from students until you publish" onPress={() => run('updated', () => act.uploadResults.mutateAsync(rows.map((r) => ({ ...r, result: 'passed' as const }))))} />
          <ListRow icon="cancel" title="Result: not passed" subtitle="Hidden from students until you publish"
            onPress={() => confirm('Mark as not passed?', `${picked.size} candidate${picked.size === 1 ? '' : 's'} will be recorded as not passed. Students only see this after you publish results.`, 'Mark not passed', () => { void run('updated', () => act.uploadResults.mutateAsync(rows.map((r) => ({ ...r, result: 'failed' as const })))); })} />
          <ListRow icon="pause-circle-outline" title="Result: on hold" onPress={() => run('updated', () => act.uploadResults.mutateAsync(rows.map((r) => ({ ...r, result: 'on_hold' as const }))))} />
          <ListRow icon="hourglass-empty" title="Move to waitlist" onPress={() => run('waitlisted', async () => ({ updated: (await act.waitlist.mutateAsync(ids)).updated }))} />
          <ListRow icon="trending-up" title="Promote from waitlist" subtitle="They become invited and are notified" last onPress={() => confirm('Promote from waitlist?', `${picked.size} candidate${picked.size === 1 ? '' : 's'} become invited and are notified.`, 'Promote', () => { void run('promoted', async () => ({ promoted: (await act.promote.mutateAsync(ids)).promoted })); }, false)} />
        </View>
      </Sheet>
    </Page>
  );
}
