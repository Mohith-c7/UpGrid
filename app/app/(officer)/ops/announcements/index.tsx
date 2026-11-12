import React, { useState } from 'react';
import { Button, Card, HeaderAction, ListRow, SegmentedTabs } from '@/ui';
import { flattenPages, useAnnouncementsV2 } from '@/api/ops';
import { AnnouncementCard } from '@/features/ops/annParts';
import { Async, LoadMore, OpsPage, useGo } from '@/features/ops/kit';

export default function Announcements() {
  const go = useGo();
  const [tab, setTab] = useState('');
  const q = useAnnouncementsV2(tab || undefined);
  const items = flattenPages(q.data);
  return (
    <OpsPage title="Announcements" back="/(officer)/ops" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}
      right={<HeaderAction icon="add" label="New announcement" onPress={() => go('/(officer)/ops/announcements/compose')} />}>
      <SegmentedTabs value={tab} onChange={setTab} options={[{ value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'sent', label: 'Sent' }]} />
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} isEmpty={items.length === 0}
        empty={{ icon: 'campaign', title: 'No announcements', message: tab ? 'Nothing in this view.' : 'Write one, schedule it, or save a draft.', actionLabel: 'New announcement', onAction: () => go('/(officer)/ops/announcements/compose') }} rowHeight={110}>
        {items.map((a) => <AnnouncementCard key={a.id} a={a} onPress={() => go(`/(officer)/ops/announcements/${a.id}`)} />)}
        <LoadMore hasNext={q.hasNextPage} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />
      </Async>
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        <ListRow icon="description" title="Templates" subtitle="Reusable titles and messages" onPress={() => go('/(officer)/ops/announcements/templates')} last />
      </Card>
    </OpsPage>
  );
}
