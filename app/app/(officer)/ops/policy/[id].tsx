import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, ListRow, SectionHeader, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useClonePolicy, useCreateVersion, usePolicy, useRollbackPolicy } from '@/api/ops';
import { Async, ConfirmSheet, OpsPage, PickRow, STATUS_TONE, useGo, useOnce, versionLabel } from '@/features/ops/kit';
import { formatDateTimeIST } from '@/lib/format';

export default function PolicyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const go = useGo();
  const toast = useToast();
  const q = usePolicy(id);
  const newVersion = useCreateVersion(id);
  const rollback = useRollbackPolicy(id);
  const clone = useClonePolicy(id);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneErr, setCloneErr] = useState<string | null>(null);
  const [rbOpen, setRbOpen] = useState(false);
  const [rbPick, setRbPick] = useState<string | null>(null);
  const [rbErr, setRbErr] = useState<string | null>(null);
  const [confirmRb, setConfirmRb] = useState(false);

  const versions = q.data?.versions ?? [];
  const [addVersion, adding] = useOnce(async () => {
    try {
      const r = await newVersion.mutateAsync({});
      go(`/(officer)/ops/policy/version/${r.version.id}`);
    } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doClone, cloning] = useOnce(async () => {
    if (cloneName.trim().length < 2) { setCloneErr('Enter a name of at least 2 characters'); return; }
    try {
      const r = await clone.mutateAsync(cloneName.trim());
      setCloneOpen(false); setCloneName(''); toast.show('Policy cloned', 'success');
      go(`/(officer)/ops/policy/${r.policy.id}`);
    } catch (e) { setCloneErr(errMessage(e)); }
  });

  return (
    <OpsPage title={q.data?.policy.name ?? 'Policy'} back="/(officer)/ops/policy" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data ? (
          <>
            {q.data.policy.description ? <Text variant="body" color={colors.textSecondary}>{q.data.policy.description}</Text> : null}
            <Button label="New draft version" icon="add" full loading={adding} onPress={() => addVersion()} />
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 150 }}><Button label="Clone policy" icon="content-copy" variant="secondary" full onPress={() => setCloneOpen(true)} /></View>
              <View style={{ flex: 1, minWidth: 150 }}><Button label="Roll back" icon="undo" variant="secondary" full disabled={versions.length < 2} onPress={() => { setRbPick(null); setRbErr(null); setRbOpen(true); }} /></View>
            </View>
            <SectionHeader title="Versions" subtitle="Existing applications keep the policy version they were checked with." />
            <Card padding={0} style={{ paddingHorizontal: 16 }}>
              {versions.map((v, i) => (
                <ListRow key={v.id} title={`Version ${v.version}`}
                  subtitle={[v.note, v.activatedAt ? `Activated ${formatDateTimeIST(v.activatedAt)}` : `Created ${formatDateTimeIST(v.createdAt)}`, v.effectiveFrom && v.status === 'scheduled' ? `Effective ${formatDateTimeIST(v.effectiveFrom)}` : null].filter(Boolean).join(' · ')}
                  right={<Badge label={versionLabel(v.status)} tone={STATUS_TONE[v.status] ?? 'neutral'} />}
                  onPress={() => go(`/(officer)/ops/policy/version/${v.id}`)} last={i === versions.length - 1} />
              ))}
            </Card>
          </>
        ) : null}
      </Async>

      <Sheet visible={cloneOpen} onClose={() => setCloneOpen(false)} title="Clone policy">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Text variant="body" color={colors.textSecondary}>Creates a new policy with a draft copy of the latest version.</Text>
          <TextField label="New policy name" value={cloneName} onChangeText={setCloneName} maxLength={80} error={cloneErr} />
          <Button label="Clone" full loading={cloning} onPress={() => doClone()} />
        </View>
      </Sheet>

      <Sheet visible={rbOpen && !confirmRb} onClose={() => setRbOpen(false)} title="Roll back to a version">
        <View style={{ gap: 12, paddingBottom: 16 }}>
          <Text variant="body" color={colors.textSecondary}>Pick an earlier version. It is copied as a new version and activated. History is kept.</Text>
          {versions.map((v) => <PickRow key={v.id} label={`Version ${v.version} · ${versionLabel(v.status)}`} sub={v.note ?? undefined} selected={rbPick === v.id} onPress={() => setRbPick(v.id)} />)}
          <Button label="Continue" full disabled={!rbPick} onPress={() => setConfirmRb(true)} />
        </View>
      </Sheet>
      <ConfirmSheet visible={confirmRb} onClose={() => { setConfirmRb(false); setRbOpen(false); }} title="Roll back now?"
        message="This activates the copied version immediately for new eligibility checks. Existing applications are not changed."
        confirmLabel="Roll back and activate" reasonLabel="Reason (optional)" error={rbErr}
        onConfirm={async (note) => {
          try { await rollback.mutateAsync({ toVersionId: rbPick!, note: note || undefined }); setConfirmRb(false); setRbOpen(false); toast.show('Rolled back', 'success'); }
          catch (e) { setRbErr(errMessage(e)); }
        }} />
    </OpsPage>
  );
}
