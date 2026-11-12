import React, { useState } from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, Card, SegmentedControl, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useRestrictionMutations } from '@/api/ops';
import type { Appeal, Restriction } from '@/api/opsTypes';
import { formatDateTimeIST, timeAgo } from '@/lib/format';
import { STATUS_TONE, useOnce } from './kit';

export const SCOPE_LABEL: Record<string, string> = {
  student: 'One student', company: 'Company', drive: 'Drive', department: 'Department', batch: 'Batch', tenant: 'Everyone',
};
export const RSTATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval', active: 'Active', rejected: 'Rejected', lifted: 'Lifted', expired: 'Expired',
};

export function RestrictionBadge({ status }: { status: string }) {
  return <Badge label={RSTATUS_LABEL[status] ?? status} tone={STATUS_TONE[status] ?? 'neutral'} />;
}

export function RestrictionCard({ r, onPress }: { r: Restriction; onPress: () => void }) {
  const target = r.scope === 'tenant' ? 'All students' : r.scopeValue ?? (r.studentId ? 'One student' : '');
  return (
    <Card onPress={onPress} accessibilityLabel={`${SCOPE_LABEL[r.scope]} restriction, ${RSTATUS_LABEL[r.effectiveStatus] ?? r.effectiveStatus}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="subhead" style={{ flexShrink: 1 }}>{SCOPE_LABEL[r.scope] ?? r.scope}{target && r.scope !== 'tenant' ? `: ${target}` : ''}</Text>
        <RestrictionBadge status={r.effectiveStatus} />
      </View>
      <Text variant="body" color={colors.textSecondary} numberOfLines={3}>{r.reason}</Text>
      <Text variant="caption" color={colors.muted}>
        {r.startsAt ? `From ${formatDateTimeIST(r.startsAt)}` : 'Starts on approval'}{r.endsAt ? ` · Until ${formatDateTimeIST(r.endsAt)}` : ' · No end date'}
      </Text>
    </Card>
  );
}

export function AppealCard({ a, onDecide, onOpen }: { a: Appeal; onDecide: () => void; onOpen?: () => void }) {
  return (
    <Card style={{ gap: 8 }} onPress={onOpen} accessibilityLabel={`Appeal from ${a.studentName}`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="subhead" style={{ flexShrink: 1 }}>{a.studentName}</Text>
        <Badge label={a.status === 'pending' ? 'Waiting for decision' : a.status === 'overturn' || a.status === 'overturned' ? 'Overturned' : a.status === 'uphold' || a.status === 'upheld' ? 'Upheld' : a.status} tone={a.status === 'pending' ? 'warning' : 'neutral'} />
      </View>
      <Text variant="body" color={colors.textSecondary}>{a.message}</Text>
      {a.restriction?.studentMessage ? <Text variant="caption" color={colors.muted}>Student was told: {a.restriction.studentMessage}</Text> : null}
      <Text variant="caption" color={colors.muted}>{timeAgo(a.createdAt)}</Text>
      {a.status === 'pending' ? <Button label="Decide" icon="gavel" variant="secondary" onPress={onDecide} /> : null}
    </Card>
  );
}

/** Uphold / overturn with a required note. */
export function AppealDecideSheet({ appeal, onClose }: { appeal: Appeal | null; onClose: () => void }) {
  const toast = useToast();
  const m = useRestrictionMutations();
  const [decision, setDecision] = useState<'uphold' | 'overturn'>('uphold');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [run, busy] = useOnce(async () => {
    if (!appeal) return;
    if (note.trim().length < 3) { setNoteErr('Write a note of at least 3 characters'); return; }
    setNoteErr(null); setErr(null);
    try {
      await m.decideAppeal(appeal.id, decision, note.trim());
      toast.show(decision === 'overturn' ? 'Appeal overturned. The student is exempted.' : 'Appeal upheld', 'success');
      setNote(''); onClose();
    } catch (e) { setErr(errMessage(e)); }
  });
  return (
    <Sheet visible={!!appeal} onClose={onClose} title="Decide appeal">
      <View style={{ gap: 16, paddingBottom: 16 }}>
        {appeal ? <Text variant="body" color={colors.textSecondary}>{appeal.studentName}: {appeal.message}</Text> : null}
        <SegmentedControl value={decision} onChange={(v) => setDecision(v as 'uphold' | 'overturn')} options={[{ value: 'uphold', label: 'Keep restriction' }, { value: 'overturn', label: 'Overturn' }]} />
        <Text variant="caption" color={colors.muted}>{decision === 'overturn' ? 'The student is exempted from this restriction and notified.' : 'The restriction stays in place for this student.'}</Text>
        <TextField label="Note to the student" value={note} onChangeText={setNote} multiline maxLength={500} error={noteErr} />
        {err ? <Banner tone="error" message={err} /> : null}
        <Button label={decision === 'overturn' ? 'Overturn appeal' : 'Uphold restriction'} full loading={busy} onPress={() => run()} />
      </View>
    </Sheet>
  );
}
