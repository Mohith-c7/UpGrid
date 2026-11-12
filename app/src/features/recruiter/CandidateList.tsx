import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorState, Icon, SearchBar, Select, Sheet, Text, TextField, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { errMessage } from '@/api/client';
import { flatten } from '@/api/hooks';
import { useBulkDecision, useCandidates, useRecruiterDrive } from '@/api/recruiter';
import type { CandidateQuery, CandidateRow, Decision } from '@/api/recruiterTypes';
import { can, DECISION_META, fmt, SkeletonList, StatusBadge } from './kit';

const DECISION_CHIPS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'rejected', label: 'Rejected' },
];
const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'screening', label: 'Screening' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'interview', label: 'Interview' },
  { value: 'selected', label: 'Selected' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'offer_issued', label: 'Offer issued' },
  { value: 'offer_accepted', label: 'Offer accepted' },
];
const ROUND_STATUS_OPTIONS = [
  { value: '', label: 'Any round status' },
  { value: 'pending', label: 'Pending' },
  { value: 'invited', label: 'Invited' },
  { value: 'attended', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'on_hold', label: 'On hold' },
];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'Name' },
  { value: 'cgpa', label: 'CGPA, high to low' },
  { value: 'score', label: 'Average score' },
];
const MAX_BULK = 100;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CandidateItem({ c, selecting, selected, blind, onToggle, onOpen }: { c: CandidateRow; selecting: boolean; selected: boolean; blind: boolean; onToggle: () => void; onOpen: () => void }) {
  const d = c.decision ? DECISION_META[c.decision] : null;
  return (
    <Card padding={0} style={selected ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {selecting ? (
          <Pressable
            onPress={onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`Select ${c.candidate.name ?? c.reference}`}
            style={{ width: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={selected ? 'check-box' : 'check-box-outline-blank'} size={24} color={selected ? colors.primary : colors.muted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={selecting ? onToggle : onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${c.candidate.name ?? c.reference}, ${c.reference}`}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: MIN_TOUCH, padding: 14, paddingLeft: selecting ? 0 : 14, gap: 6, backgroundColor: pressed ? colors.pressed : 'transparent', borderRadius: 14 })}
        >
          <Text variant="subhead">{c.candidate.name ?? 'Candidate'}</Text>
          <Text variant="caption" color={colors.muted} tabular>
            {[c.reference, c.candidate.department, c.candidate.cgpa != null ? `CGPA ${fmt(c.candidate.cgpa)}` : null].filter(Boolean).join('  |  ')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <StatusBadge status={c.status} />
            {d ? <Badge label={d.label} tone={d.tone} icon={d.icon as never} /> : null}
            {c.currentRound ? <Badge label={`${c.currentRound.name}: ${c.currentRound.status.replace('_', ' ')}`} tone="neutral" /> : null}
          </View>
          {c.scorecardCount > 0 ? (
            <Text variant="caption" color={colors.muted} tabular>
              {c.scorecardCount} scorecard{c.scorecardCount === 1 ? '' : 's'}{!blind && c.avgScore != null ? `, average ${fmt(c.avgScore)} of 5` : ''}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </Card>
  );
}

/** Candidate list for one drive: search, filters, multi-select with bulk shortlist/reject behind a confirm sheet. */
export function CandidateList({ driveId, onOpen }: { driveId: string; onOpen: (applicationId: string) => void }) {
  const toast = useToast();
  const drive = useRecruiterDrive(driveId);
  const perms = drive.data?.permissions;
  const rounds = drive.data?.rounds ?? [];
  // Blind scorecards: an average over every recruiter's scores would reveal the scores this recruiter is not allowed to see yet.
  const blind = drive.data?.settings.blindScorecards ?? true;
  const sortOptions = useMemo(() => (blind ? SORT_OPTIONS.filter((o) => o.value !== 'score') : SORT_OPTIONS), [blind]);

  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState('');
  const [status, setStatus] = useState('');
  const [roundId, setRoundId] = useState('');
  const [roundStatus, setRoundStatus] = useState('');
  const [sort, setSort] = useState<NonNullable<CandidateQuery['sort']>>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = useDebounced(search.trim(), 350);
  useEffect(() => { if (blind && sort === 'score') setSort('newest'); }, [blind, sort]);

  const query: CandidateQuery = useMemo(
    () => ({ q: q || undefined, decision: decision || undefined, status: status || undefined, roundId: roundId || undefined, roundStatus: roundId && roundStatus ? roundStatus : undefined, sort }),
    [q, decision, status, roundId, roundStatus, sort],
  );
  const list = useCandidates(driveId, query);
  const items = useMemo(() => flatten(list.data), [list.data]);
  const total = list.data?.pages[0]?.total;
  const activeFilters = [status, roundId, roundStatus].filter(Boolean).length + (sort !== 'newest' ? 1 : 0);

  // selection
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ applicationId: string; reason: string }[]>([]);
  const bulk = useBulkDecision(driveId);
  const canShortlist = can(perms, 'shortlist');

  useEffect(() => { setPicked(new Set()); setSelecting(false); }, [driveId]);

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= MAX_BULK) toast.show(`You can select up to ${MAX_BULK} candidates at a time.`, 'info');
      else next.add(id);
      return next;
    });
  }, [toast]);

  const names = useMemo(() => new Map(items.map((c) => [c.applicationId, c.candidate.name ?? c.reference])), [items]);

  const submit = async () => {
    if (!confirm) return;
    const r = reason.trim();
    if (confirm === 'rejected' && (r.length < 3 || r.length > 500)) { setReasonErr('Give a reason of 3 to 500 characters.'); return; }
    setReasonErr(null);
    try {
      const res = await bulk.mutateAsync({ applicationIds: [...picked], decision: confirm, reason: r || undefined });
      setFailed(res.failed ?? []);
      toast.show(`${res.updated} candidate${res.updated === 1 ? '' : 's'} updated${res.failed?.length ? `, ${res.failed.length} failed` : ''}.`, res.failed?.length ? 'info' : 'success');
      setConfirm(null); setReason(''); setPicked(new Set()); setSelecting(false);
    } catch (e) {
      setReasonErr(errMessage(e));
    }
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, registration number or email" accessibilityLabel="Search candidates" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {DECISION_CHIPS.map((c) => <Chip key={c.value} label={c.label} selected={decision === c.value} onPress={() => setDecision(c.value)} />)}
        <Chip label={activeFilters ? `Filters (${activeFilters})` : 'Filters'} icon="tune" selected={activeFilters > 0} onPress={() => setFiltersOpen(true)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: MIN_TOUCH }}>
        <Text variant="caption" color={colors.muted} tabular style={{ flex: 1 }}>{total !== undefined ? `${total} candidate${total === 1 ? '' : 's'}` : ' '}</Text>
        {canShortlist ? (
          <Button size="sm" variant="secondary" label={selecting ? 'Cancel selection' : 'Select'} icon={selecting ? 'close' : 'checklist'} onPress={() => { setSelecting(!selecting); setPicked(new Set()); }} />
        ) : null}
      </View>
      {failed.length ? (
        <Banner
          tone="warning"
          title={`${failed.length} could not be updated`}
          message={failed.slice(0, 3).map((f) => `${names.get(f.applicationId) ?? 'Candidate'}: ${f.reason}`).join('\n')}
          action={{ label: 'Dismiss', onPress: () => setFailed([]) }}
        />
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (list.isLoading) body = <View style={{ paddingHorizontal: 16 }}>{header}<SkeletonList rows={4} height={110} /></View>;
  else if (list.isError && !items.length)
    body = <View style={{ paddingHorizontal: 16 }}>{header}<ErrorState message={errMessage(list.error)} onRetry={() => void list.refetch()} /></View>;
  else
    body = (
      <FlatList
        data={items}
        keyExtractor={(c) => c.applicationId}
        contentContainerStyle={{ padding: 16, paddingBottom: selecting ? 24 : 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <CandidateItem c={item} selecting={selecting} selected={picked.has(item.applicationId)} blind={blind} onToggle={() => toggle(item.applicationId)} onOpen={() => onOpen(item.applicationId)} />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={q || decision || activeFilters ? 'No candidates match' : 'No candidates yet'}
            message={q || decision || activeFilters ? 'Try a different search or clear the filters.' : 'Applications appear here after the placement cell screens them.'}
            actionLabel={q || decision || activeFilters ? 'Clear filters' : 'Refresh'}
            onAction={() => { if (q || decision || activeFilters) { setSearch(''); setDecision(''); setStatus(''); setRoundId(''); setRoundStatus(''); setSort('newest'); } else void list.refetch(); }}
          />
        }
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          list.isFetchingNextPage ? <SkeletonList rows={1} height={90} />
            : list.isError && items.length ? <Button label="Could not load more. Retry" variant="ghost" full onPress={() => void list.fetchNextPage()} />
            : undefined
        }
      />
    );

  return (
    <View style={{ flex: 1 }}>
      {body}
      {selecting ? (
        <View style={{ padding: 12, gap: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text variant="caption" color={colors.muted} tabular>{picked.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button label="Shortlist" icon="check" full disabled={!picked.size} onPress={() => { setReason(''); setReasonErr(null); setConfirm('shortlisted'); }} /></View>
            <View style={{ flex: 1 }}><Button label="Reject" icon="close" variant="danger" full disabled={!picked.size} onPress={() => { setReason(''); setReasonErr(null); setConfirm('rejected'); }} /></View>
          </View>
        </View>
      ) : null}

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Select label="Application status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <Select label="Round" value={roundId} onChange={(v) => { setRoundId(v); if (!v) setRoundStatus(''); }} options={[{ value: '', label: 'Any round' }, ...rounds.map((r) => ({ value: r.id, label: `${r.seq}. ${r.name}` }))]} />
          {roundId ? <Select label="Status in round" value={roundStatus} onChange={setRoundStatus} options={ROUND_STATUS_OPTIONS} /> : null}
          <Select label="Sort by" value={sort} onChange={(v) => setSort(v as NonNullable<CandidateQuery['sort']>)} options={sortOptions} />
          <Button label="Show results" full onPress={() => setFiltersOpen(false)} />
          <Button label="Clear filters" variant="ghost" full onPress={() => { setStatus(''); setRoundId(''); setRoundStatus(''); setSort('newest'); setFiltersOpen(false); }} />
        </View>
      </Sheet>

      <Sheet visible={!!confirm} onClose={() => { if (!bulk.isPending) setConfirm(null); }} title={confirm === 'rejected' ? 'Reject candidates?' : 'Shortlist candidates?'}>
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text variant="body">
            {confirm === 'rejected'
              ? `${picked.size} candidate${picked.size === 1 ? '' : 's'} will be marked rejected in your working list. This does not change their application status; propose an outcome on each candidate for that.`
              : `${picked.size} candidate${picked.size === 1 ? '' : 's'} will be marked shortlisted. Placement officers are notified.`}
          </Text>
          {confirm === 'rejected' ? (
            <TextField label="Reason (required)" value={reason} onChangeText={(t) => { setReason(t); setReasonErr(null); }} multiline maxLength={500} error={reasonErr} helper="3 to 500 characters. Visible to the placement cell." />
          ) : reasonErr ? <Banner tone="error" message={reasonErr} /> : null}
          <Button label={confirm === 'rejected' ? `Reject ${picked.size}` : `Shortlist ${picked.size}`} variant={confirm === 'rejected' ? 'danger' : 'primary'} full loading={bulk.isPending} onPress={submit} />
          <Button label="Cancel" variant="ghost" full disabled={bulk.isPending} onPress={() => setConfirm(null)} />
        </View>
      </Sheet>
    </View>
  );
}
