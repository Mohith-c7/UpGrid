import React, { useState } from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, Card, HeaderAction, ListRow, SectionHeader, Select, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useActivePolicy, useCreatePolicy, usePolicies, usePolicyTemplates } from '@/api/ops';
import { Async, OpsPage, STATUS_TONE, useGo, useOnce } from '@/features/ops/kit';
import { formatDateTimeIST, timeAgo } from '@/lib/format';

export default function PolicyHome() {
  const go = useGo();
  const toast = useToast();
  const active = useActivePolicy();
  const list = usePolicies();
  const templates = usePolicyTemplates();
  const create = useCreatePolicy();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tpl, setTpl] = useState('one-offer');
  const [err, setErr] = useState<string | null>(null);

  const [submit, busy] = useOnce(async () => {
    if (name.trim().length < 2) { setErr('Enter a name of at least 2 characters'); return; }
    setErr(null);
    try {
      const r = await create.mutateAsync({ name: name.trim(), description: desc.trim() || undefined, templateId: tpl });
      setOpen(false); setName(''); setDesc('');
      toast.show('Policy created as a draft', 'success');
      go(`/(officer)/ops/policy/version/${r.version.id}`);
    } catch (e) { setErr(errMessage(e)); }
  });
  const refresh = () => { void active.refetch(); void list.refetch(); };

  return (
    <OpsPage title="Placement policy" onRefresh={refresh} refreshing={active.isRefetching || list.isRefetching}
      right={<HeaderAction icon="add" label="New policy" onPress={() => setOpen(true)} />}>
      <SectionHeader title="Active policy" />
      <Async isLoading={active.isLoading} isError={active.isError} error={active.error} onRetry={() => void active.refetch()} rows={1} rowHeight={96}>
        {active.data?.version ? (
          <Card tinted onPress={() => go(`/(officer)/ops/policy/${active.data!.version!.policyId}`)} accessibilityLabel={`Active policy ${active.data.version.name}`} style={{ gap: 6 }}>
            <Badge label="Active" tone="success" />
            <Text variant="subhead">{active.data.version.name} · version {active.data.version.version}</Text>
            <Text variant="caption" color={colors.muted}>Effective {formatDateTimeIST(active.data.version.effectiveFrom)}</Text>
            <ActiveSummary p={active.data.policy} />
          </Card>
        ) : (
          <Banner tone="info" title="No active policy" message="Students are checked against each drive's own rules only. Create a policy, simulate it, then activate it." />
        )}
      </Async>

      <SectionHeader title="All policies" />
      <Async isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => void list.refetch()}
        isEmpty={(list.data?.length ?? 0) === 0} empty={{ icon: 'gavel', title: 'No policies yet', message: 'Start from a template such as one-offer or dream and super dream.', actionLabel: 'Create policy', onAction: () => setOpen(true) }}>
        <Card padding={0} style={{ paddingHorizontal: 16 }}>
          {list.data?.map((p, i, a) => (
            <ListRow key={p.id} title={p.name}
              subtitle={`${p.activeVersion ? `Active: version ${p.activeVersion.version}` : 'Not active'} · latest version ${p.latestVersion ?? 1} · ${timeAgo(p.updatedAt)}`}
              right={p.activeVersion ? <Badge label="Active" tone="success" /> : <Badge label="Inactive" tone="neutral" />}
              onPress={() => go(`/(officer)/ops/policy/${p.id}`)} last={i === a.length - 1} />
          ))}
        </Card>
      </Async>

      <SectionHeader title="Tools" />
      <Card padding={0} style={{ paddingHorizontal: 16 }}>
        <ListRow icon="account-tree" title="Condition builder" subtitle="Build and check nested eligibility conditions for a drive" onPress={() => go('/(officer)/ops/policy/conditions')} last />
      </Card>

      <Sheet visible={open} onClose={() => setOpen(false)} title="New policy">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <TextField label="Name" value={name} onChangeText={setName} maxLength={80} />
          <TextField label="Description (optional)" value={desc} onChangeText={setDesc} multiline maxLength={300} />
          <Async isLoading={templates.isLoading} isError={templates.isError} error={templates.error} onRetry={() => void templates.refetch()} rows={1} rowHeight={56}>
            <Select label="Start from template" value={tpl} onChange={setTpl} options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <Text variant="caption" color={colors.muted}>{templates.data?.find((t) => t.id === tpl)?.description ?? ''}</Text>
          </Async>
          {err ? <Banner tone="error" message={err} /> : null}
          <Button label="Create draft" full loading={busy} onPress={() => submit()} />
        </View>
      </Sheet>
    </OpsPage>
  );
}

function ActiveSummary({ p }: { p: import('@/api/opsTypes').PolicyJson | null }) {
  if (!p) return null;
  const rows: string[] = [];
  rows.push(p.oneOffer.enabled ? 'One offer per student' : 'Multiple offers allowed');
  if (p.tiers.enabled) rows.push(`Tiers: dream from ₹${p.tiers.dreamMinLpa} LPA, super dream from ₹${p.tiers.superDreamMinLpa} LPA`);
  if (p.upgrade.enabled) rows.push(`Upgrade allowed at ${p.upgrade.multiplier}x current CTC`);
  if (p.requireVerifiedAcademics) rows.push('Verified academics required');
  return <View style={{ gap: 2 }}>{rows.map((r) => <Text key={r} variant="caption" color={colors.textSecondary}>{`• ${r}`}</Text>)}</View>;
}
