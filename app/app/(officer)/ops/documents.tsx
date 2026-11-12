import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, SearchBar, SegmentedTabs, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { fetchFileUrl, flattenPages, useDocMutations, useDocQueue } from '@/api/ops';
import type { DocType, VerifyDoc } from '@/api/opsTypes';
import { Async, ChipRow, ConfirmSheet, LoadMore, OpsPage, STATUS_TONE, useOnce } from '@/features/ops/kit';
import { formatDateTimeIST } from '@/lib/format';

const TYPES: { value: DocType | ''; label: string }[] = [
  { value: '', label: 'All types' }, { value: 'marksheet', label: 'Marksheet' }, { value: 'id_proof', label: 'ID proof' }, { value: 'resume', label: 'Resume' },
  { value: 'certificate', label: 'Certificate' }, { value: 'offer_letter', label: 'Offer letter' }, { value: 'other', label: 'Other' },
];
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? t;

export default function Documents() {
  const toast = useToast();
  const m = useDocMutations();
  const [status, setStatus] = useState('pending');
  const [docType, setDocType] = useState<DocType | ''>('');
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const list = useDocQueue({ status, docType, q: dq || undefined });
  const items = flattenPages(list.data);
  const [rejecting, setRejecting] = useState<VerifyDoc | null>(null);
  const [rejErr, setRejErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const [view] = useOnce(async (d: VerifyDoc) => {
    setOpening(d.id);
    try {
      const url = d.url ?? (d.fileId ? (await fetchFileUrl(d.fileId)).url : null);
      if (!url) { toast.show('This document has no file or link.', 'error'); return; }
      if (!(await Linking.canOpenURL(url))) { toast.show('No app on this device can open this document.', 'error'); return; }
      await Linking.openURL(url);
    } catch (e) { toast.show(errMessage(e), 'error'); } finally { setOpening(null); }
  });
  const [verify, verifying] = useOnce(async (d: VerifyDoc) => {
    try { await m.verify(d.id); toast.show(`${d.label} verified`, 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
  });

  return (
    <OpsPage title="Document verification" back="/(officer)/ops" onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <SegmentedTabs value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search student or document" />
      <ChipRow>{TYPES.map((t) => <Chip key={t.value || 'all'} label={t.label} selected={docType === t.value} onPress={() => setDocType(t.value)} />)}</ChipRow>
      <Async isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => void list.refetch()} isEmpty={items.length === 0}
        empty={{ icon: 'fact-check', title: status === 'pending' ? 'Nothing waiting' : 'No documents here', message: status === 'pending' ? 'All submitted documents have been reviewed.' : 'Try another status or type.' }} rowHeight={140}>
        {items.map((d) => (
          <Card key={d.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="subhead" style={{ flexShrink: 1 }}>{d.label}</Text>
              <Badge label={d.status === 'pending' ? 'Pending' : d.status === 'verified' ? 'Verified' : 'Rejected'} tone={STATUS_TONE[d.status] ?? 'neutral'} />
            </View>
            <Text variant="caption" color={colors.muted}>{typeLabel(d.docType)} · Submitted {formatDateTimeIST(d.createdAt)}</Text>
            {d.student ? <Text variant="body" color={colors.textSecondary}>{d.student.name}{d.student.registrationNumber ? ` · ${d.student.registrationNumber}` : ''}{d.student.department ? ` · ${d.student.department}` : ''}</Text> : null}
            {d.rejectReason ? <Banner tone="error" message={`Rejected: ${d.rejectReason}`} /> : null}
            <Button label="View document" icon="open-in-new" variant="secondary" loading={opening === d.id} onPress={() => view(d)} />
            {d.status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 140 }}><Button label="Approve" icon="done" full disabled={verifying} onPress={() => verify(d)} /></View>
                <View style={{ flex: 1, minWidth: 140 }}><Button label="Reject" icon="close" variant="danger" full onPress={() => { setRejErr(null); setRejecting(d); }} /></View>
              </View>
            ) : null}
          </Card>
        ))}
        <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
      </Async>
      <ConfirmSheet visible={!!rejecting} onClose={() => setRejecting(null)} title="Reject document" message="The student is told why and can upload a new one." confirmLabel="Reject" danger
        reasonLabel="Reason" reasonRequired maxReason={300} error={rejErr}
        onConfirm={async (reason) => { try { await m.reject(rejecting!.id, reason); setRejecting(null); toast.show('Document rejected', 'success'); } catch (e) { setRejErr(errMessage(e)); } }} />
    </OpsPage>
  );
}
