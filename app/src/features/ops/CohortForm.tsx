import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, SegmentedControl, Select, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { previewCohort } from '@/api/ops';
import type { CohortFilter, CohortPreview } from '@/api/opsTypes';
import { useDrivesOfficer } from '@/features/officer/data';
import { Group, useOnce } from './kit';

export interface FilterForm {
  departments: string; batches: string; minCgpa: string; maxCgpa: string; maxActiveBacklogs: string; verified: 'any' | 'yes' | 'no';
  placement: '' | 'placed' | 'unplaced' | 'offered'; appliedToDriveId: string; notAppliedToDriveId: string; registrationPrefix: string;
}
export const EMPTY_FILTER: FilterForm = { departments: '', batches: '', minCgpa: '', maxCgpa: '', maxActiveBacklogs: '', verified: 'any', placement: '', appliedToDriveId: '', notAppliedToDriveId: '', registrationPrefix: '' };

export function filterToForm(f?: CohortFilter | null): FilterForm {
  if (!f) return EMPTY_FILTER;
  return {
    departments: (f.departments ?? []).join(', '), batches: (f.batches ?? []).join(', '), minCgpa: f.minCgpa != null ? String(f.minCgpa) : '',
    maxCgpa: f.maxCgpa != null ? String(f.maxCgpa) : '', maxActiveBacklogs: f.maxActiveBacklogs != null ? String(f.maxActiveBacklogs) : '',
    verified: f.verified === true ? 'yes' : f.verified === false ? 'no' : 'any', placement: f.placement ?? '',
    appliedToDriveId: f.appliedToDriveId ?? '', notAppliedToDriveId: f.notAppliedToDriveId ?? '', registrationPrefix: f.registrationPrefix ?? '',
  };
}
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export function formToFilter(f: FilterForm): CohortFilter {
  const o: CohortFilter = {};
  if (list(f.departments).length) o.departments = list(f.departments);
  if (list(f.batches).length) o.batches = list(f.batches).map(Number);
  if (f.minCgpa.trim()) o.minCgpa = Number(f.minCgpa);
  if (f.maxCgpa.trim()) o.maxCgpa = Number(f.maxCgpa);
  if (f.maxActiveBacklogs.trim()) o.maxActiveBacklogs = Number(f.maxActiveBacklogs);
  if (f.verified !== 'any') o.verified = f.verified === 'yes';
  if (f.placement) o.placement = f.placement;
  if (f.appliedToDriveId) o.appliedToDriveId = f.appliedToDriveId;
  if (f.notAppliedToDriveId) o.notAppliedToDriveId = f.notAppliedToDriveId;
  if (f.registrationPrefix.trim()) o.registrationPrefix = f.registrationPrefix.trim();
  return o;
}
export function filterErrors(f: FilterForm): Record<string, string> {
  const e: Record<string, string> = {};
  const isNum = (s: string, lo: number, hi: number) => { const n = Number(s); return Number.isFinite(n) && n >= lo && n <= hi; };
  if (f.minCgpa.trim() && !isNum(f.minCgpa, 0, 10)) e.minCgpa = '0 to 10';
  if (f.maxCgpa.trim() && !isNum(f.maxCgpa, 0, 10)) e.maxCgpa = '0 to 10';
  if (f.minCgpa.trim() && f.maxCgpa.trim() && Number(f.minCgpa) > Number(f.maxCgpa)) e.maxCgpa = 'Must be at least the minimum';
  if (f.maxActiveBacklogs.trim() && !isNum(f.maxActiveBacklogs, 0, 50)) e.maxActiveBacklogs = '0 to 50';
  if (list(f.batches).some((b) => !/^\d{4}$/.test(b))) e.batches = 'Use 4-digit years separated by commas';
  return e;
}

/** Filter fields for a dynamic cohort with a live "who matches" preview. */
export function DynamicFilterForm({ value, onChange, errors }: { value: FilterForm; onChange: (f: FilterForm) => void; errors: Record<string, string> }) {
  const drives = useDrivesOfficer();
  const driveOpts = useMemo(() => [{ value: '', label: 'Any' }, ...(drives.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.status !== 'draft').map((d) => ({ value: d.id, label: `${d.company.name} · ${d.role}` }))], [drives.data]);
  const set = <K extends keyof FilterForm>(k: K, v: FilterForm[K]) => onChange({ ...value, [k]: v });
  const [pv, setPv] = useState<CohortPreview | null>(null);
  const [pvErr, setPvErr] = useState<string | null>(null);
  useEffect(() => { setPv(null); setPvErr(null); }, [value]);
  const [preview, busy] = useOnce(async () => {
    setPvErr(null);
    if (Object.keys(filterErrors(value)).length) { setPvErr('Fix the highlighted fields first.'); return; }
    try { setPv(await previewCohort({ kind: 'dynamic', filter: formToFilter(value) })); } catch (e) { setPvErr(errMessage(e)); }
  });
  return (
    <Group title="Who is included">
      <Text variant="caption" color={colors.muted}>All filled fields must match. Leave a field empty to ignore it.</Text>
      <TextField label="Departments" value={value.departments} onChangeText={(t) => set('departments', t)} placeholder="Computer Science, Mechanical" helper="Separate with commas" />
      <TextField label="Batch years" value={value.batches} onChangeText={(t) => set('batches', t)} placeholder="2026, 2027" error={errors.batches} />
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 130 }}><TextField label="Min CGPA" value={value.minCgpa} onChangeText={(t) => set('minCgpa', t)} keyboardType="decimal-pad" error={errors.minCgpa} /></View>
        <View style={{ flex: 1, minWidth: 130 }}><TextField label="Max CGPA" value={value.maxCgpa} onChangeText={(t) => set('maxCgpa', t)} keyboardType="decimal-pad" error={errors.maxCgpa} /></View>
      </View>
      <TextField label="Max active backlogs" value={value.maxActiveBacklogs} onChangeText={(t) => set('maxActiveBacklogs', t.replace(/\D/g, ''))} keyboardType="number-pad" error={errors.maxActiveBacklogs} />
      <TextField label="Registration number starts with" value={value.registrationPrefix} onChangeText={(t) => set('registrationPrefix', t.toUpperCase())} maxLength={20} autoCapitalize="characters" />
      <View style={{ gap: 8 }}>
        <Text variant="caption" color={colors.muted}>Academics verified</Text>
        <SegmentedControl value={value.verified} onChange={(v) => set('verified', v as FilterForm['verified'])} options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Verified' }, { value: 'no', label: 'Not verified' }]} />
      </View>
      <View style={{ gap: 8 }}>
        <Text variant="caption" color={colors.muted}>Placement status</Text>
        <SegmentedControl value={value.placement || 'any'} onChange={(v) => set('placement', (v === 'any' ? '' : v) as FilterForm['placement'])} options={[{ value: 'any', label: 'Any' }, { value: 'placed', label: 'Placed' }, { value: 'unplaced', label: 'Unplaced' }, { value: 'offered', label: 'Offered' }]} />
      </View>
      <Select label="Applied to drive" value={value.appliedToDriveId} onChange={(v) => set('appliedToDriveId', v)} options={driveOpts} />
      <Select label="Has not applied to drive" value={value.notAppliedToDriveId} onChange={(v) => set('notAppliedToDriveId', v)} options={driveOpts} />
      {drives.isError ? <Banner tone="warning" message="Could not load drives for the two drive filters." action={{ label: 'Retry', onPress: () => void drives.refetch() }} /> : null}
      <Button label="Preview matching students" icon="visibility" variant="secondary" full loading={busy} onPress={() => preview()} />
      {pvErr ? <Banner tone="error" message={pvErr} /> : null}
      {pv ? (
        <View style={{ gap: 4 }}>
          <Text variant="subhead" tabular>{pv.count} {pv.count === 1 ? 'student matches' : 'students match'}</Text>
          {pv.sample.map((s) => <Text key={s.id} variant="caption" color={colors.textSecondary}>{`• ${s.name}${s.department ? ` · ${s.department}` : ''}${s.batchYear ? ` · ${s.batchYear}` : ''}`}</Text>)}
        </View>
      ) : null}
    </Group>
  );
}
