import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Button, KeyValueList, SectionHeader, Text, TimelineList, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useRestriction, useRestrictionMutations } from '@/api/ops';
import type { Appeal } from '@/api/opsTypes';
import { Async, ConfirmSheet, Group, OpsPage, useOnce } from '@/features/ops/kit';
import { AppealCard, AppealDecideSheet, RestrictionBadge, SCOPE_LABEL } from '@/features/ops/restrictionParts';
import { formatDateTimeIST } from '@/lib/format';

export default function RestrictionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const q = useRestriction(id);
  const m = useRestrictionMutations();
  const [dialog, setDialog] = useState<'reject' | 'lift' | null>(null);
  const [dErr, setDErr] = useState<string | null>(null);
  const [aErr, setAErr] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Appeal | null>(null);
  const r = q.data?.restriction;

  const [approve, approving] = useOnce(async () => {
    setAErr(null);
    try { await m.approve(id); toast.show('Restriction approved and active', 'success'); }
    catch (e) { setAErr(errMessage(e)); } // SELF_APPROVAL shows the server's message
  });

  return (
    <OpsPage title="Restriction" back="/(officer)/ops/restrictions" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3} rowHeight={120}>
        {r ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="title" style={{ flexShrink: 1 }}>{SCOPE_LABEL[r.scope] ?? r.scope}</Text>
              <RestrictionBadge status={r.effectiveStatus} />
            </View>
            {aErr ? <Banner tone="error" title={/self/i.test(aErr) ? 'You cannot approve your own request' : undefined} message={aErr} /> : null}
            <Group title="Details">
              <KeyValueList items={[
                { label: 'Applies to', value: r.scope === 'tenant' ? 'Everyone' : r.scopeValue ?? (r.studentId ? 'One student' : '—') },
                ...(r.studentId && r.scope !== 'student' ? [{ label: 'Limited to student', value: r.studentId }] : []),
                { label: 'Starts', value: r.startsAt ? formatDateTimeIST(r.startsAt) : 'On approval' },
                { label: 'Ends', value: r.endsAt ? formatDateTimeIST(r.endsAt) : 'No end date' },
                { label: 'Created', value: formatDateTimeIST(r.createdAt) },
                ...(r.approvedAt ? [{ label: 'Approved', value: formatDateTimeIST(r.approvedAt) }] : []),
                ...(r.liftedAt ? [{ label: 'Lifted', value: formatDateTimeIST(r.liftedAt) }] : []),
              ]} />
            </Group>
            <Group title="Reasons">
              <Text variant="overline" color={colors.muted}>Internal reason</Text>
              <Text variant="body">{r.reason}</Text>
              <Text variant="overline" color={colors.muted}>Message the student sees</Text>
              <Text variant="body">{r.studentMessage}</Text>
              {r.evidenceNotes ? (<><Text variant="overline" color={colors.muted}>Evidence notes (officers only)</Text><Text variant="body">{r.evidenceNotes}</Text></>) : null}
              {r.liftReason ? (<><Text variant="overline" color={colors.muted}>Lift reason</Text><Text variant="body">{r.liftReason}</Text></>) : null}
            </Group>

            {r.status === 'pending_approval' ? (
              <View style={{ gap: 12 }}>
                <Button label="Approve" icon="done" full loading={approving} onPress={() => approve()} />
                <Button label="Reject" icon="close" variant="danger" full onPress={() => { setDErr(null); setDialog('reject'); }} />
              </View>
            ) : null}
            {r.status === 'active' ? <Button label="Lift restriction" icon="lock-open" variant="secondary" full onPress={() => { setDErr(null); setDialog('lift'); }} /> : null}

            <SectionHeader title="Appeals" />
            {(q.data?.appeals.length ?? 0) === 0 ? <Text variant="body" color={colors.muted}>No appeals on this restriction.</Text> : q.data!.appeals.map((a) => (
              <AppealCard key={a.id} a={a} onDecide={() => setDeciding(a)} />
            ))}

            <SectionHeader title="History" />
            {(q.data?.history.length ?? 0) === 0 ? <Text variant="body" color={colors.muted}>No history yet.</Text> : (
              <TimelineList items={q.data!.history.map((h) => ({ title: `${h.type.replace(/_/g, ' ')}${h.actorName ? ` by ${h.actorName}` : ''}`, time: formatDateTimeIST(h.createdAt), subtitle: h.note ?? undefined, state: 'done' as const }))} />
            )}
          </>
        ) : null}
      </Async>

      <ConfirmSheet visible={dialog === 'reject'} onClose={() => setDialog(null)} title="Reject restriction" message="It will not take effect." confirmLabel="Reject" danger reasonLabel="Reason" reasonRequired error={dErr}
        onConfirm={async (note) => { try { await m.reject(id, note); setDialog(null); toast.show('Restriction rejected', 'success'); } catch (e) { setDErr(errMessage(e)); } }} />
      <ConfirmSheet visible={dialog === 'lift'} onClose={() => setDialog(null)} title="Lift restriction" message="Students can apply again straight away." confirmLabel="Lift restriction" reasonLabel="Reason" reasonRequired error={dErr}
        onConfirm={async (reason) => { try { await m.lift(id, reason); setDialog(null); toast.show('Restriction lifted', 'success'); } catch (e) { setDErr(errMessage(e)); } }} />
      <AppealDecideSheet appeal={deciding} onClose={() => setDeciding(null)} />
    </OpsPage>
  );
}
