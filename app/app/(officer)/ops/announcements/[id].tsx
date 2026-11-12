import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, KeyValueList, MetricRow, ProgressBar, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useAnnouncementMutations, useAnnouncementV2, useCohorts } from '@/api/ops';
import { AUDIENCE_LABEL, SSTATUS_LABEL } from '@/features/ops/annParts';
import { Async, ConfirmSheet, Group, OpsPage, STATUS_TONE, useBack, useGo, useOnce } from '@/features/ops/kit';
import { formatDateTimeIST } from '@/lib/format';

export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const go = useGo();
  const back = useBack('/(officer)/ops/announcements');
  const q = useAnnouncementV2(id);
  const cohorts = useCohorts();
  const m = useAnnouncementMutations();
  const a = q.data;
  const [delOpen, setDelOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [pin, pinning] = useOnce(async () => {
    if (!a) return;
    try { await m.pin(id, !a.pinned); await q.refetch(); toast.show(a.pinned ? 'Unpinned' : 'Pinned', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const audienceText = a ? (a.audience.type === 'cohort' ? `Cohort: ${cohorts.data?.find((c) => c.id === (a.audience as { cohortId: string }).cohortId)?.name ?? 'unknown'}` : AUDIENCE_LABEL[a.audience.type]) : '';
  const readPct = a && a.delivered > 0 ? a.read / a.delivered : 0;

  return (
    <OpsPage title="Announcement" back="/(officer)/ops/announcements" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3} rowHeight={110}>
        {a ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Badge label={SSTATUS_LABEL[a.status] ?? a.status} tone={STATUS_TONE[a.status] ?? 'neutral'} />
              {a.pinned ? <Badge label="Pinned" tone="info" icon="push-pin" /> : null}
            </View>
            <Text variant="title">{a.title}</Text>
            <Text variant="body">{a.body}</Text>
            <Group title="Delivery">
              <KeyValueList items={[
                { label: 'Audience', value: audienceText },
                ...(a.status !== 'sent' && a.audienceCount != null ? [{ label: 'Would reach', value: `${a.audienceCount} students` }] : []),
                { label: 'Channels', value: [a.channels?.inApp && 'In-app', a.channels?.push && 'Push', a.channels?.email && 'Email'].filter(Boolean).join(', ') || '—' },
                ...(a.sendAt && a.status === 'scheduled' ? [{ label: 'Sends', value: formatDateTimeIST(a.sendAt) }] : []),
                ...(a.sentAt ? [{ label: 'Sent', value: formatDateTimeIST(a.sentAt) }] : []),
                ...(a.expiresAt ? [{ label: 'Hidden after', value: formatDateTimeIST(a.expiresAt) }] : []),
              ]} />
            </Group>
            {a.status === 'sent' ? (
              <Group title="Read receipts">
                <MetricRow label="Recipients" value={a.recipients} />
                <MetricRow label="Delivered" value={a.delivered} />
                <MetricRow label="Read" value={a.read} last />
                <ProgressBar value={readPct} label={`${Math.round(readPct * 100)}% of delivered were read`} />
              </Group>
            ) : null}
            {err ? <Banner tone="error" message={err} /> : null}
            <View style={{ gap: 12 }}>
              <Button label={a.pinned ? 'Unpin' : 'Pin to top'} icon="push-pin" variant="secondary" full loading={pinning} onPress={() => pin()} />
              {a.status !== 'sent' ? (
                <>
                  <Button label="Send now" icon="send" full onPress={() => { setErr(null); setSendOpen(true); }} />
                  <Button label="Edit" icon="edit" variant="secondary" full onPress={() => go(`/(officer)/ops/announcements/compose?id=${a.id}`)} />
                  <Button label="Delete" icon="delete-outline" variant="danger" full onPress={() => { setErr(null); setDelOpen(true); }} />
                </>
              ) : <Text variant="caption" color={colors.muted}>Sent announcements cannot be edited or deleted.</Text>}
            </View>
          </>
        ) : null}
      </Async>
      <ConfirmSheet visible={sendOpen} onClose={() => setSendOpen(false)} title="Send now?" message={a?.audienceCount != null ? `This reaches ${a.audienceCount} students straight away.` : 'This reaches the audience straight away.'} confirmLabel="Send now" error={err}
        onConfirm={async () => { try { await m.send(id); setSendOpen(false); await q.refetch(); toast.show('Announcement sent', 'success'); } catch (e) { setErr(errMessage(e)); } }} />
      <ConfirmSheet visible={delOpen} onClose={() => setDelOpen(false)} title="Delete announcement?" message="It will never be sent." confirmLabel="Delete" danger error={err}
        onConfirm={async () => { try { await m.remove(id); setDelOpen(false); toast.show('Deleted', 'success'); back(); } catch (e) { setErr(errMessage(e)); } }} />
    </OpsPage>
  );
}
