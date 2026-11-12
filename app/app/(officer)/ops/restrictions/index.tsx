import React, { useState } from 'react';
import { Button, Chip, HeaderAction, SegmentedTabs } from '@/ui';
import { useAppeals, useRestrictions, flattenPages } from '@/api/ops';
import type { Appeal } from '@/api/opsTypes';
import { Async, ChipRow, LoadMore, OpsPage, useGo } from '@/features/ops/kit';
import { AppealCard, AppealDecideSheet, RestrictionCard } from '@/features/ops/restrictionParts';

const STATUSES = [
  { value: '', label: 'All' }, { value: 'pending_approval', label: 'Awaiting approval' }, { value: 'active', label: 'Active' },
  { value: 'rejected', label: 'Rejected' }, { value: 'lifted', label: 'Lifted' },
];

export default function Restrictions() {
  const go = useGo();
  const [tab, setTab] = useState('restrictions');
  const [status, setStatus] = useState('');
  const list = useRestrictions({ status: status || undefined });
  const appeals = useAppeals('pending');
  const [deciding, setDeciding] = useState<Appeal | null>(null);
  const items = flattenPages(list.data);

  return (
    <OpsPage title="Restrictions" back="/(officer)/ops" onRefresh={() => { void list.refetch(); void appeals.refetch(); }} refreshing={list.isRefetching || appeals.isRefetching}
      right={<HeaderAction icon="add" label="New restriction" onPress={() => go('/(officer)/ops/restrictions/new')} />}>
      <SegmentedTabs value={tab} onChange={setTab} options={[{ value: 'restrictions', label: 'Restrictions' }, { value: 'appeals', label: 'Appeals', count: appeals.data?.length ?? 0 }]} />
      {tab === 'restrictions' ? (
        <>
          <ChipRow>{STATUSES.map((s) => <Chip key={s.value} label={s.label} selected={status === s.value} onPress={() => setStatus(s.value)} />)}</ChipRow>
          <Async isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => void list.refetch()} isEmpty={items.length === 0}
            empty={{ icon: 'block', title: 'No restrictions', message: status ? 'Nothing matches this filter.' : 'Restrictions you create appear here. Students see only the message meant for them.', actionLabel: 'New restriction', onAction: () => go('/(officer)/ops/restrictions/new') }} rowHeight={120}>
            {items.map((r) => <RestrictionCard key={r.id} r={r} onPress={() => go(`/(officer)/ops/restrictions/${r.id}`)} />)}
            <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
          </Async>
        </>
      ) : (
        <Async isLoading={appeals.isLoading} isError={appeals.isError} error={appeals.error} onRetry={() => void appeals.refetch()} isEmpty={(appeals.data?.length ?? 0) === 0}
          empty={{ icon: 'gavel', title: 'No appeals waiting', message: 'When a student appeals a restriction it shows up here.' }} rowHeight={140}>
          {appeals.data?.map((a) => <AppealCard key={a.id} a={a} onDecide={() => setDeciding(a)} onOpen={() => go(`/(officer)/ops/restrictions/${a.restrictionId}`)} />)}
        </Async>
      )}
      <AppealDecideSheet appeal={deciding} onClose={() => setDeciding(null)} />
    </OpsPage>
  );
}
