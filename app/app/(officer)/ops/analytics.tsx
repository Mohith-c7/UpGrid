import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, Chip, HeaderAction, KeyValueList, MetricRow, SegmentedControl, SegmentedTabs, Select, StatTile, Text, TextField, useToast } from '@/ui';
import { Sheet } from '@/ui';
import { colors } from '@/theme';
import { formatDateTimeIST } from '@/lib/format';
import {
  fetchAnalyticsExport, fetchReportPack, useAnalyticsDashboard, useAnalyticsDrives, useAnalyticsFunnel, useAnalyticsPlacement,
  useAnalyticsReminders, useAnalyticsWorkload,
} from '@/api/ops';
import type { ExportDataset, OpsFilters, ReportPack } from '@/api/opsTypes';
import { Async, BarRow, ChipRow, Group, isDate, lpa, num, OpsPage, pct, stamp, todayIst, addDaysIst, useOnce, useShareFile } from '@/features/ops/kit';

const DATASETS: { value: ExportDataset; label: string }[] = [
  { value: 'drives', label: 'Drives' }, { value: 'branches', label: 'Branches' }, { value: 'batches', label: 'Batches' },
  { value: 'companies', label: 'Companies' }, { value: 'funnel', label: 'Funnel' }, { value: 'students', label: 'Students (aggregate-safe)' },
];

function reportText(p: ReportPack): string {
  const k = p.dashboard.kpis;
  const L: string[] = [];
  L.push(`${p.meta.tenantName ?? 'Placement'} report`, `Generated ${formatDateTimeIST(p.meta.generatedAt)}`, '');
  L.push('Key numbers', `Students: ${k.students}`, `Applications: ${k.applications}`);
  L.push(`Selected: ${k.selected.students} students (${k.selected.applications} applications)`);
  L.push(`Offers issued: ${k.offers.students} students (${k.offers.applications} applications)`);
  L.push(`Offers accepted: ${k.accepted.students} students (${k.accepted.applications} applications)`);
  L.push(`Joined: ${k.joined.students} students (${k.joined.applications} applications)`);
  L.push(`Placed: ${p.placement.totals.placedStudents} of ${p.placement.totals.students} (${pct(p.placement.totals.placedPct)})`);
  L.push(`CTC highest/average/median (LPA): ${num(p.placement.ctc.highestLpa)} / ${num(p.placement.ctc.averageLpa)} / ${num(p.placement.ctc.medianLpa)}`, '', 'Funnel');
  p.funnel.stages.forEach((s) => L.push(`${s.label}: ${s.count} (${pct(s.pctOfApplied)} of applied)`));
  L.push(`Rejected: ${p.funnel.rejected}`, `Withdrawn: ${p.funnel.withdrawn}`, '', 'Branches');
  p.placement.byBranch.forEach((b) => L.push(`${b.department}: ${b.placed}/${b.students} placed (${pct(b.placedPct)})`));
  L.push('', 'Drives');
  p.drives.forEach((d) => L.push(`${d.company} - ${d.role} [${d.status}]: eligible ${d.eligibleCount}, applied ${d.applied}, selected ${d.selected}, offers ${d.offers}, accepted ${d.accepted}, joined ${d.joined}`));
  L.push('', 'Reminders', `Delivery rate: ${pct(p.reminders.deliveryRatePct)}`);
  return L.join('\n');
}

export default function Analytics() {
  const toast = useToast();
  const share = useShareFile();
  const [tab, setTab] = useState('overview');
  const [draft, setDraft] = useState({ batch: '', department: '', from: '', to: '' });
  const [applied, setApplied] = useState<OpsFilters>({});
  const [filterErr, setFilterErr] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dataset, setDataset] = useState<ExportDataset>('drives');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');

  const dash = useAnalyticsDashboard(applied);
  const place = useAnalyticsPlacement(applied);
  const funnel = useAnalyticsFunnel(applied);
  const drives = useAnalyticsDrives(applied);
  const rem = useAnalyticsReminders(applied);
  const work = useAnalyticsWorkload(applied);

  const apply = () => {
    if (draft.batch && !/^\d{4}$/.test(draft.batch)) return setFilterErr('Batch must be a 4-digit year');
    if (draft.from && !isDate(draft.from)) return setFilterErr('From date must be YYYY-MM-DD');
    if (draft.to && !isDate(draft.to)) return setFilterErr('To date must be YYYY-MM-DD');
    if (draft.from && draft.to && draft.from > draft.to) return setFilterErr('From date must be before the To date');
    setFilterErr(null);
    setApplied({ batch: draft.batch || undefined, department: draft.department.trim() || undefined, from: draft.from || undefined, to: draft.to || undefined });
  };
  const preset = (days: number | null) => {
    const t = todayIst();
    setDraft((d) => ({ ...d, from: days == null ? '' : addDaysIst(t, -days), to: days == null ? '' : t }));
  };
  const clear = () => { setDraft({ batch: '', department: '', from: '', to: '' }); setApplied({}); setFilterErr(null); };
  const activeFilters = Object.values(applied).filter(Boolean).length;

  const refresh = () => { [dash, place, funnel, drives, rem, work].forEach((q) => void q.refetch()); };
  const refreshing = [dash, place, funnel, drives, rem, work].some((q) => q.isRefetching);

  const [doExport, exporting] = useOnce(async () => {
    await share(() => fetchAnalyticsExport(dataset, format, applied), `analytics-${dataset}-${stamp()}.${format}`, format === 'csv' ? 'text/csv' : 'application/json', 'Export analytics');
    setExportOpen(false);
  });
  const [doPack, packing] = useOnce(async () => {
    try {
      const pack = await fetchReportPack(applied);
      await share(async () => reportText(pack), `placement-report-${stamp()}.txt`, 'text/plain', 'Placement report');
    } catch (e) { toast.show((e as Error).message || 'Could not build the report.', 'error'); }
  });
  const [doPackJson, packingJson] = useOnce(async () => {
    await share(async () => JSON.stringify(await fetchReportPack(applied), null, 2), `placement-report-${stamp()}.json`, 'application/json', 'Report pack (JSON)');
  });

  const k = dash.data?.kpis;
  const maxApplied = Math.max(1, ...(funnel.data?.stages.map((s) => s.count) ?? [1]));
  const maxBranch = Math.max(1, ...(place.data?.byBranch.map((b) => b.students) ?? [1]));
  const maxBand = Math.max(1, ...(place.data?.ctcBands.map((b) => b.count) ?? [1]));
  const maxRem = Math.max(1, ...(rem.data?.byKind.map((b) => b.total) ?? [1]));

  const driveList = useMemo(() => drives.data?.items ?? [], [drives.data]);

  return (
    <OpsPage title="Analytics" onRefresh={refresh} refreshing={refreshing}
      right={<HeaderAction icon="ios-share" label="Export and report" onPress={() => setExportOpen(true)} />}>
      <Group title={activeFilters ? `Filters (${activeFilters} applied)` : 'Filters'}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 120 }}><TextField label="Batch year" value={draft.batch} onChangeText={(t) => setDraft((d) => ({ ...d, batch: t.replace(/\D/g, '') }))} keyboardType="number-pad" maxLength={4} placeholder="2026" /></View>
          <View style={{ flex: 2, minWidth: 160 }}><TextField label="Department" value={draft.department} onChangeText={(t) => setDraft((d) => ({ ...d, department: t }))} placeholder="Computer Science" maxLength={80} /></View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}><TextField label="Applications from" value={draft.from} onChangeText={(t) => setDraft((d) => ({ ...d, from: t }))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} /></View>
          <View style={{ flex: 1, minWidth: 140 }}><TextField label="Applications to" value={draft.to} onChangeText={(t) => setDraft((d) => ({ ...d, to: t }))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} /></View>
        </View>
        <ChipRow>
          <Chip label="Last 30 days" onPress={() => preset(30)} />
          <Chip label="Last 90 days" onPress={() => preset(90)} />
          <Chip label="All time" onPress={() => preset(null)} />
        </ChipRow>
        {filterErr ? <Banner tone="error" message={filterErr} /> : null}
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140 }}><Button label="Apply filters" full onPress={apply} /></View>
          {activeFilters ? <View style={{ flex: 1, minWidth: 140 }}><Button label="Clear" variant="secondary" full onPress={clear} /></View> : null}
        </View>
        <Text variant="caption" color={colors.muted}>Dates filter by application time. Student counts are not date-filtered.</Text>
      </Group>

      <SegmentedTabs value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'Overview' }, { value: 'funnel', label: 'Funnel' }, { value: 'drives', label: 'Drives' },
        { value: 'reminders', label: 'Reminders' }, { value: 'workload', label: 'Workload' },
      ]} />

      {tab === 'overview' ? (
        <>
          <Async isLoading={dash.isLoading} isError={dash.isError} error={dash.error} onRetry={() => void dash.refetch()} rows={4} rowHeight={96}>
            {k ? (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <StatTile label="Students" value={k.students} icon="school" />
                  <StatTile label="Applications" value={k.applications} icon="assignment" />
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <StatTile label="Placed" value={place.data ? pct(place.data.totals.placedPct) : '—'} icon="work-outline" hint={place.data ? `${place.data.totals.placedStudents} students` : undefined} />
                  <StatTile label="Applied of eligible" value={pct(k.eligibleVsApplied.appliedOfEligiblePct)} icon="how-to-reg" hint={`${k.eligibleVsApplied.appliedSlots} of ${k.eligibleVsApplied.eligibleSlots}`} />
                </View>
                <Group title="Outcomes (counted separately)">
                  <Text variant="caption" color={colors.muted}>Each stage is its own number. A student reaches a stage at any time, so stages are not added together.</Text>
                  <MetricRow label="Selected" value={`${k.selected.students} students`} hint={`${k.selected.applications} applications`} />
                  <MetricRow label="Offers issued" value={`${k.offers.students} students`} hint={`${k.offers.applications} applications`} />
                  <MetricRow label="Offers accepted" value={`${k.accepted.students} students`} hint={`${k.accepted.applications} applications`} />
                  <MetricRow label="Joined" value={`${k.joined.students} students`} hint={`${k.joined.applications} applications`} last />
                </Group>
                <Group title="Students and drives">
                  <MetricRow label="Profiles complete" value={pct(k.profileCompletePct)} />
                  <MetricRow label="Average profile completion" value={pct(k.avgProfileCompletionPct)} />
                  <MetricRow label="Verified academics" value={pct(k.verifiedPct)} />
                  <MetricRow label="Open drives" value={k.drivesOpen} />
                  <MetricRow label="Closed drives" value={k.drivesClosed} />
                  <MetricRow label="Draft drives" value={k.drivesDraft} last />
                </Group>
                <Text variant="caption" color={colors.muted}>Updated {formatDateTimeIST(dash.data?.generatedAt)}</Text>
              </>
            ) : null}
          </Async>

          <Async isLoading={place.isLoading} isError={place.isError} error={place.error} onRetry={() => void place.refetch()} rows={2}>
            {place.data ? (
              <>
                <Group title="Package (accepted annual CTC)">
                  <KeyValueList items={[
                    { label: 'Highest', value: lpa(place.data.ctc.highestLpa) }, { label: 'Average', value: lpa(place.data.ctc.averageLpa) },
                    { label: 'Median', value: lpa(place.data.ctc.medianLpa) }, { label: 'Placed students counted', value: String(place.data.ctc.count) },
                  ]} inline />
                  {place.data.ctcBands.map((b) => <BarRow key={b.label} label={`${b.label} LPA`} value={b.count} max={maxBand} />)}
                </Group>
                <Group title="By branch">
                  {place.data.byBranch.length === 0 ? <Text variant="body" color={colors.muted}>No branch data for these filters.</Text> : place.data.byBranch.map((b) => (
                    <View key={b.department} style={{ gap: 4 }}>
                      <BarRow label={b.department ?? 'Unknown'} value={b.students} max={maxBranch} text={`${b.placed} of ${b.students} placed (${pct(b.placedPct)})`} />
                      <Text variant="caption" color={colors.muted} tabular>Average {lpa(b.avgLpa)} · Highest {lpa(b.highestLpa)}</Text>
                    </View>
                  ))}
                </Group>
                <Group title="By batch">
                  {place.data.byBatch.length === 0 ? <Text variant="body" color={colors.muted}>No batch data for these filters.</Text> : place.data.byBatch.map((b) => (
                    <MetricRow key={String(b.batchYear)} label={`Batch ${b.batchYear}`} value={`${b.placed}/${b.students} (${pct(b.placedPct)})`} />
                  ))}
                </Group>
                <Group title="Top hiring companies">
                  {place.data.byCompany.length === 0 ? <Text variant="body" color={colors.muted}>No hires recorded yet.</Text> : place.data.byCompany.slice(0, 10).map((c, i, a) => (
                    <MetricRow key={c.company} label={c.company} value={`${c.hires} hired`} hint={`Average ${lpa(c.avgLpa)}`} last={i === a.length - 1} />
                  ))}
                </Group>
              </>
            ) : null}
          </Async>
        </>
      ) : null}

      {tab === 'funnel' ? (
        <Async isLoading={funnel.isLoading} isError={funnel.isError} error={funnel.error} onRetry={() => void funnel.refetch()} rows={3}>
          {funnel.data ? (
            <Group title="Application funnel">
              <Text variant="caption" color={colors.muted}>Counts applications that reached each stage at any time.</Text>
              {funnel.data.stages.map((s) => <BarRow key={s.key} label={s.label} value={s.count} max={maxApplied} text={`${s.count} (${pct(s.pctOfApplied)})`} />)}
              <MetricRow label="Rejected" value={funnel.data.rejected} />
              <MetricRow label="Withdrawn" value={funnel.data.withdrawn} last />
            </Group>
          ) : null}
        </Async>
      ) : null}

      {tab === 'drives' ? (
        <Async isLoading={drives.isLoading} isError={drives.isError} error={drives.error} onRetry={() => void drives.refetch()} isEmpty={driveList.length === 0}
          empty={{ icon: 'work-outline', title: 'No drives for these filters', message: 'Publish a drive or widen the filters.' }}>
          {driveList.map((d) => (
            <Group key={d.id} title={`${d.company} · ${d.role}`}>
              <Text variant="caption" color={colors.muted}>Status: {d.status}{d.deadline ? ` · Deadline ${formatDateTimeIST(d.deadline)}` : ''}</Text>
              <BarRow label="Applied of eligible" value={d.applied} max={Math.max(1, d.eligibleCount)} text={`${d.applied} of ${d.eligibleCount} (${pct(d.appliedOfEligiblePct)})`} />
              <KeyValueList inline items={[
                { label: 'Selected', value: String(d.selected) }, { label: 'Offers', value: String(d.offers) },
                { label: 'Accepted', value: String(d.accepted) }, { label: 'Joined', value: String(d.joined) },
                { label: 'Missed deadline (est.)', value: String(d.deadlineMissEstimate) },
                { label: 'Median time to apply', value: d.medianHoursToApply == null ? '—' : `${d.medianHoursToApply} h` },
                { label: 'Drive completeness', value: `${d.completenessScore}%` },
              ]} />
              {d.completenessGaps.length ? <Text variant="caption" color={colors.warning}>Missing: {d.completenessGaps.join(', ')}</Text> : null}
            </Group>
          ))}
        </Async>
      ) : null}

      {tab === 'reminders' ? (
        <Async isLoading={rem.isLoading} isError={rem.isError} error={rem.error} onRetry={() => void rem.refetch()}>
          {rem.data ? (
            <Group title="Reminder effectiveness">
              <MetricRow label="Delivery rate" value={pct(rem.data.deliveryRatePct)} />
              <MetricRow label="Devices registered for push" value={rem.data.pushDevices} last />
              {rem.data.byKind.map((b) => (
                <View key={b.kind} style={{ gap: 4 }}>
                  <BarRow label={KIND[b.kind] ?? b.kind} value={b.sent} max={maxRem} text={`${b.sent} sent of ${b.total}`} />
                  <Text variant="caption" color={colors.muted} tabular>Pending {b.pending} · Skipped {b.skipped} · Cancelled {b.cancelled}</Text>
                </View>
              ))}
              {rem.data.byKind.length === 0 ? <Text variant="body" color={colors.muted}>No reminders have been scheduled yet.</Text> : null}
            </Group>
          ) : null}
        </Async>
      ) : null}

      {tab === 'workload' ? (
        <Async isLoading={work.isLoading} isError={work.isError} error={work.error} onRetry={() => void work.refetch()}>
          {work.data ? (
            <>
              <Group title="Waiting for someone">
                <MetricRow label="Applications awaiting screening" value={work.data.unassigned.applicationsAwaitingScreening} />
                <MetricRow label="Documents pending" value={work.data.unassigned.documentsPending} />
                <MetricRow label="Open support tickets" value={work.data.unassigned.openTickets} last />
              </Group>
              <Group title="Officers (last 30 days)">
                {work.data.officers.length === 0 ? <Text variant="body" color={colors.muted}>No officer activity yet.</Text> : work.data.officers.map((o, i, a) => (
                  <MetricRow key={o.id} label={o.name} value={`${o.statusChanges30d} changes`} hint={`${o.drivesCreated} drives created · ${o.pendingDocuments} docs pending${o.openTickets != null ? ` · ${o.openTickets} tickets` : ''}`} last={i === a.length - 1} />
                ))}
              </Group>
            </>
          ) : null}
        </Async>
      ) : null}

      <Sheet visible={exportOpen} onClose={() => setExportOpen(false)} title="Export and report">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Select label="Dataset" value={dataset} onChange={(v) => setDataset(v as ExportDataset)} options={DATASETS} />
          <SegmentedControl value={format} onChange={(v) => setFormat(v as 'csv' | 'json')} options={[{ value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }]} />
          <Text variant="caption" color={colors.muted}>Uses the filters above. Student exports have no phone or email. Exports are recorded in the audit log.</Text>
          <Button label="Export and share" icon="ios-share" full loading={exporting} onPress={() => doExport()} />
          <Text variant="subhead">Report pack</Text>
          <Text variant="caption" color={colors.muted}>A summary of every section above. Shared as a text file or full JSON data.</Text>
          <Button label="Share report summary" icon="description" variant="secondary" full loading={packing} onPress={() => doPack()} />
          <Button label="Share report data (JSON)" icon="data-object" variant="secondary" full loading={packingJson} onPress={() => doPackJson()} />
        </View>
      </Sheet>
    </OpsPage>
  );
}

const KIND: Record<string, string> = { t60: '60 minutes before', t30: '30 minutes before', t15: '15 minutes before', sched60: 'Interview or test, 60 minutes' };
