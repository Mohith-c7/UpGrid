import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, Chip, CompanyLogo, KeyValueList, SectionHeader, SegmentedControl, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useCrmCompany, useCrmMutations, useInteractions } from '@/api/ops';
import type { CompanyStage, Interaction } from '@/api/opsTypes';
import { stageLabel, stageTone, STAGES } from '@/features/ops/crm';
import { Async, ChipRow, ConfirmSheet, DateTimeFields, Group, isDate, istToIso, OpsPage, todayIst, useBack, useGo, useOnce } from '@/features/ops/kit';
import { formatDateIST, formatDateTimeIST } from '@/lib/format';

const TYPES: { value: Interaction['type']; label: string }[] = [{ value: 'call', label: 'Call' }, { value: 'meeting', label: 'Meeting' }, { value: 'email', label: 'Email' }, { value: 'other', label: 'Other' }];

export default function CompanyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const go = useGo();
  const back = useBack('/(officer)/ops/companies');
  const q = useCrmCompany(id);
  const log = useInteractions(id);
  const m = useCrmMutations();
  const c = q.data;
  const [stageOpen, setStageOpen] = useState(false);
  const [newStage, setNewStage] = useState<CompanyStage>('prospect');
  const [stageNote, setStageNote] = useState('');
  const [stageErr, setStageErr] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [type, setType] = useState<Interaction['type']>('call');
  const [od, setOd] = useState(todayIst()); const [ot, setOt] = useState('');
  const [summary, setSummary] = useState('');
  const [fd, setFd] = useState('');
  const [logErr, setLogErr] = useState<Record<string, string>>({});
  const [logBanner, setLogBanner] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [saveStage, savingStage] = useOnce(async () => {
    setStageErr(null);
    try { await m.stage(id, newStage, stageNote.trim() || undefined); setStageOpen(false); setStageNote(''); toast.show('Stage updated', 'success'); } catch (e) { setStageErr(errMessage(e)); }
  });
  const [saveLog, savingLog] = useOnce(async () => {
    const e: Record<string, string> = {};
    const occurredAt = isDate(od) ? istToIso(od, ot || '12:00') : null;
    if (!occurredAt) e.occurredAt = 'Use YYYY-MM-DD'; else if (Date.parse(occurredAt) > Date.now() + 60_000) e.occurredAt = 'Cannot be in the future';
    if (summary.trim().length < 3) e.summary = 'Write at least 3 characters';
    if (fd && !isDate(fd)) e.followUpAt = 'Use YYYY-MM-DD';
    setLogErr(e); setLogBanner(null);
    if (Object.keys(e).length) return;
    try {
      await m.addInteraction(id, { type, occurredAt: occurredAt!, summary: summary.trim(), followUpAt: fd ? istToIso(fd, '09:00') ?? undefined : undefined });
      setLogOpen(false); setSummary(''); setFd(''); toast.show('Interaction logged', 'success');
    } catch (x) { setLogBanner(errMessage(x)); }
  });
  const [toggleDone] = useOnce(async (i: Interaction) => {
    try { await m.updateInteraction(id, i.id, { followUpDone: !i.followUpDone }); } catch (x) { toast.show(errMessage(x), 'error'); }
  });

  return (
    <OpsPage title={c?.name ?? 'Company'} back="/(officer)/ops/companies" keyboard onRefresh={() => { void q.refetch(); void log.refetch(); }} refreshing={q.isRefetching}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {c ? (
          <>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <CompanyLogo name={c.name} size={56} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title">{c.name}</Text>
                <Text variant="caption" color={colors.muted}>{[c.industry, c.hq].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Badge label={stageLabel(c.stage)} tone={stageTone(c.stage)} />
              {c.verified ? <Badge label="Verified" tone="success" icon="verified" /> : null}
              {c.tags?.map((t) => <Chip key={t} label={t} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 150 }}><Button label="Change stage" icon="timeline" variant="secondary" full onPress={() => { setNewStage(c.stage); setStageErr(null); setStageOpen(true); }} /></View>
              <View style={{ flex: 1, minWidth: 150 }}><Button label="Edit" icon="edit" variant="secondary" full onPress={() => go(`/(officer)/ops/companies/new?id=${c.id}`)} /></View>
            </View>
            <Group title="Details">
              <KeyValueList items={[
                { label: 'Website', value: c.website || '—' }, { label: 'Drives', value: String(c.driveCount) },
                { label: 'Last contact', value: c.lastInteractionAt ? formatDateIST(c.lastInteractionAt) : 'Never' },
                { label: 'Next follow-up', value: c.nextFollowUpAt ? formatDateIST(c.nextFollowUpAt) : 'None' },
              ]} />
              {c.notes ? <Text variant="body" color={colors.textSecondary}>{c.notes}</Text> : null}
            </Group>
            <Group title="Contacts">
              {(c.contacts?.length ?? 0) === 0 ? <Text variant="body" color={colors.muted}>No contacts saved.</Text> : c.contacts.map((p, i) => (
                <View key={i}>
                  <Text variant="subhead">{p.name}</Text>
                  <Text variant="caption" color={colors.muted}>{[p.role, p.email, p.phone ? `+91 ${p.phone}` : null].filter(Boolean).join(' · ')}</Text>
                </View>
              ))}
            </Group>
            {c.drives?.length ? (
              <Group title="Drives">
                {c.drives.map((d) => <Text key={d.id} variant="body" accessibilityRole="link" style={{ color: colors.primary, minHeight: 48, textAlignVertical: 'center' }} onPress={() => go(`/(officer)/drive/${d.id}`)}>{d.role ?? 'Drive'}{d.status ? ` (${d.status})` : ''}</Text>)}
              </Group>
            ) : null}

            <SectionHeader title="Interaction log" action={{ label: 'Log', onPress: () => { setLogErr({}); setLogBanner(null); setLogOpen(true); } }} />
            <Async isLoading={log.isLoading} isError={log.isError} error={log.error} onRetry={() => void log.refetch()} isEmpty={(log.data?.length ?? 0) === 0}
              empty={{ icon: 'forum', title: 'Nothing logged', message: 'Record calls, meetings and emails so the next officer knows where things stand.', actionLabel: 'Log interaction', onAction: () => setLogOpen(true) }} rows={2} rowHeight={80}>
              {log.data?.map((i) => (
                <Card key={i.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <Badge label={TYPES.find((t) => t.value === i.type)?.label ?? i.type} tone="info" />
                    <Text variant="caption" tabular color={colors.muted}>{formatDateIST(i.occurredAt)}</Text>
                  </View>
                  <Text variant="body">{i.summary}</Text>
                  {i.followUpAt ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <Text variant="caption" color={i.followUpDone ? colors.muted : colors.warning}>{i.followUpDone ? 'Follow-up done' : `Follow up by ${formatDateIST(i.followUpAt)}`}</Text>
                      <Button label={i.followUpDone ? 'Reopen' : 'Mark done'} variant="ghost" size="sm" onPress={() => toggleDone(i)} />
                    </View>
                  ) : null}
                </Card>
              ))}
            </Async>
            <Button label="Delete company" icon="delete-outline" variant="danger" full onPress={() => { setDelErr(null); setDelOpen(true); }} />
          </>
        ) : null}
      </Async>

      <Sheet visible={stageOpen} onClose={() => setStageOpen(false)} title="Outreach stage">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <ChipRow>{STAGES.map((s) => <Chip key={s.value} label={s.label} selected={newStage === s.value} onPress={() => setNewStage(s.value)} />)}</ChipRow>
          <TextField label="Note (optional)" value={stageNote} onChangeText={setStageNote} multiline maxLength={300} />
          {stageErr ? <Banner tone="error" message={stageErr} /> : null}
          <Button label="Update stage" full loading={savingStage} onPress={() => saveStage()} />
        </View>
      </Sheet>
      <Sheet visible={logOpen} onClose={() => setLogOpen(false)} title="Log interaction">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <ChipRow>{TYPES.map((t) => <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />)}</ChipRow>
          <DateTimeFields label="When" date={od} time={ot} onDate={setOd} onTime={setOt} error={logErr.occurredAt} />
          <TextField label="What happened" value={summary} onChangeText={setSummary} multiline maxLength={2000} error={logErr.summary} />
          <DateTimeFields label="Follow up by (optional)" date={fd} time="" onDate={setFd} onTime={() => {}} withTime={false} error={logErr.followUpAt} />
          {logBanner ? <Banner tone="error" message={logBanner} /> : null}
          <Button label="Save" full loading={savingLog} onPress={() => saveLog()} />
        </View>
      </Sheet>
      <ConfirmSheet visible={delOpen} onClose={() => setDelOpen(false)} title="Delete this company?" message="Its interaction log is deleted too. Drives stay as they are." confirmLabel="Delete" danger error={delErr}
        onConfirm={async () => { try { await m.remove(id); setDelOpen(false); toast.show('Company deleted', 'success'); back(); } catch (e) { setDelErr(errMessage(e)); } }} />
    </OpsPage>
  );
}
