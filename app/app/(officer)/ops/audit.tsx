import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, Chip, HeaderAction, Select, Sheet, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { fetchAuditExport, flattenPages, useAudit, useAuditActions } from '@/api/ops';
import type { AuditEntry, AuditFilters } from '@/api/opsTypes';
import { Async, ChipRow, DateTimeFields, isDate, istToIso, LoadMore, OpsPage, stamp, useOnce, useShareFile } from '@/features/ops/kit';
import { formatDateTimeIST } from '@/lib/format';

const GROUPS = ['policy', 'restriction', 'appeal', 'cohort', 'announcement', 'company', 'document', 'settings', 'analytics', 'audit'];
const EMPTY = { action: '', entityType: '', q: '', from: '', to: '' };

function MetaLines({ meta }: { meta: AuditEntry['meta'] }) {
  const entries = Object.entries(meta ?? {});
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 2, paddingTop: 4 }}>
      {entries.map(([k, v]) => {
        const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
        return <Text key={k} variant="caption" color={colors.textSecondary} selectable>{`${k}: ${text}`}</Text>;
      })}
    </View>
  );
}

export default function AuditLog() {
  const share = useShareFile();
  const actions = useAuditActions();
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState<AuditFilters>({});
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useAudit(applied);
  const items = flattenPages(list.data);
  const count = Object.values(applied).filter(Boolean).length;

  const apply = () => {
    if (draft.from && !isDate(draft.from)) return setErr('From date must be YYYY-MM-DD');
    if (draft.to && !isDate(draft.to)) return setErr('To date must be YYYY-MM-DD');
    if (draft.from && draft.to && draft.from > draft.to) return setErr('From date must be before the To date');
    setErr(null);
    setApplied({
      action: draft.action || undefined, entityType: draft.entityType.trim() || undefined, q: draft.q.trim() || undefined,
      from: draft.from ? istToIso(draft.from, '00:00') ?? undefined : undefined, to: draft.to ? istToIso(draft.to, '23:59') ?? undefined : undefined,
    });
    setOpen(false);
  };
  const [doExport, exporting] = useOnce(async (format: 'csv' | 'json') => {
    await share(() => fetchAuditExport(applied, format), `audit-log-${stamp()}.${format}`, format === 'csv' ? 'text/csv' : 'application/json', 'Export audit log');
  });
  const actionOpts = [{ value: '', label: 'Any action' }, ...GROUPS.map((g) => ({ value: `${g}.*`, label: `${g} (all)` })), ...(actions.data ?? []).map((a) => ({ value: a, label: a }))];

  return (
    <OpsPage title="Audit log" back="/(officer)/ops" onRefresh={() => void list.refetch()} refreshing={list.isRefetching}
      right={<HeaderAction icon="filter-list" label="Filters" onPress={() => setOpen(true)} badge={count || undefined} />}>
      <Banner tone="info" message="Passwords, tokens and codes are hidden. Emails and phone numbers are partly masked." />
      {count ? (
        <ChipRow>
          {applied.action ? <Chip label={`Action: ${applied.action}`} /> : null}{applied.entityType ? <Chip label={`Type: ${applied.entityType}`} /> : null}
          {applied.q ? <Chip label={`Search: ${applied.q}`} /> : null}{applied.from ? <Chip label="From date" /> : null}{applied.to ? <Chip label="To date" /> : null}
          <Chip label="Clear all" onPress={() => { setApplied({}); setDraft(EMPTY); }} />
        </ChipRow>
      ) : null}
      <Async isLoading={list.isLoading} isError={list.isError} error={list.error} onRetry={() => void list.refetch()} isEmpty={items.length === 0}
        empty={{ icon: 'history', title: 'No entries', message: count ? 'Nothing matches these filters.' : 'Changes made by officers are recorded here.' }} rowHeight={84}>
        {items.map((e) => {
          const isOpen = expanded === e.id;
          return (
            <Card key={e.id} onPress={() => setExpanded(isOpen ? null : e.id)} accessibilityLabel={`${e.action} by ${e.actorName ?? 'system'}`} style={{ gap: 4 }}>
              <Text variant="subhead">{e.action}</Text>
              <Text variant="caption" color={colors.muted}>{e.actorName ?? 'System'} · {formatDateTimeIST(e.createdAt)}</Text>
              {e.entityType ? <Text variant="caption" color={colors.muted} selectable>{e.entityType}{e.entityId ? ` ${e.entityId}` : ''}</Text> : null}
              {isOpen ? <MetaLines meta={e.meta} /> : <Text variant="caption" color={colors.primary}>{e.meta && Object.keys(e.meta).length ? 'Show details' : ''}</Text>}
            </Card>
          );
        })}
        <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
      </Async>
      <View style={{ gap: 12 }}>
        <Text variant="caption" color={colors.muted}>Exports use the filters above (up to 5000 rows) and are recorded in this log.</Text>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}><Button label="Export CSV" icon="ios-share" variant="secondary" full loading={exporting} onPress={() => doExport('csv')} /></View>
          <View style={{ flex: 1, minWidth: 140 }}><Button label="Export JSON" icon="ios-share" variant="secondary" full loading={exporting} onPress={() => doExport('json')} /></View>
        </View>
      </View>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Filter audit log">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Select label="Action" value={draft.action} onChange={(v) => setDraft((d) => ({ ...d, action: v }))} options={actionOpts} />
          {actions.isError ? <Text variant="caption" color={colors.warning}>Could not load the list of actions. Groups still work.</Text> : null}
          <TextField label="Record type (optional)" value={draft.entityType} onChangeText={(t) => setDraft((d) => ({ ...d, entityType: t }))} placeholder="policy_version" maxLength={60} autoCapitalize="none" />
          <TextField label="Search" value={draft.q} onChangeText={(t) => setDraft((d) => ({ ...d, q: t }))} maxLength={100} />
          <DateTimeFields label="From" date={draft.from} time="" onDate={(t) => setDraft((d) => ({ ...d, from: t }))} onTime={() => {}} withTime={false} />
          <DateTimeFields label="To" date={draft.to} time="" onDate={(t) => setDraft((d) => ({ ...d, to: t }))} onTime={() => {}} withTime={false} />
          {err ? <Banner tone="error" message={err} /> : null}
          <Button label="Apply filters" full onPress={apply} />
          <Button label="Reset" variant="secondary" full onPress={() => { setDraft(EMPTY); setApplied({}); setOpen(false); setErr(null); }} />
        </View>
      </Sheet>
    </OpsPage>
  );
}
