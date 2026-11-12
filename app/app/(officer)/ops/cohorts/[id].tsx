import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, ListRow, SectionHeader, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useCohort, useCohortMembers, useCohortMutations } from '@/api/ops';
import { DynamicFilterForm, filterErrors, filterToForm, formToFilter } from '@/features/ops/CohortForm';
import { Async, ConfirmSheet, Group, LoadMore, OpsPage, useBack, useOnce } from '@/features/ops/kit';
import { useUnsavedGuard } from '@/features/student/me/kit';
import { StudentPicker } from '@/features/ops/StudentPicker';

export default function CohortDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const back = useBack('/(officer)/ops/cohorts');
  const q = useCohort(id);
  const members = useCohortMembers(id);
  const m = useCohortMutations();
  const c = q.data;
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [filter, setFilter] = useState(filterToForm(null));
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  useUnsavedGuard(dirty);

  useEffect(() => { if (c && !dirty) { setName(c.name); setDesc(c.description ?? ''); setFilter(filterToForm(c.filter)); } }, [c, dirty]);
  const rows = (members.data?.pages ?? []).flatMap((p) => p.items);
  const total = members.data?.pages[0]?.total ?? c?.memberCount ?? 0;

  const [save, saving] = useOnce(async () => {
    const e: Record<string, string> = c?.kind === 'dynamic' ? filterErrors(filter) : {};
    if (name.trim().length < 2) e.name = 'Enter a name of at least 2 characters';
    setErrs(e); setBanner(null);
    if (Object.keys(e).length) return;
    try {
      await m.update(id, { name: name.trim(), description: desc.trim(), filter: c?.kind === 'dynamic' ? formToFilter(filter) : undefined });
      setDirty(false); void members.refetch(); toast.show('Cohort saved', 'success');
    } catch (x) { setErrs(fieldErrors(x)); setBanner(errMessage(x)); }
  });
  const [removeOne, removing] = useOnce(async (sid: string) => {
    try { await m.members(id, { remove: [sid] }); void members.refetch(); void q.refetch(); toast.show('Removed from cohort', 'success'); } catch (x) { toast.show(errMessage(x), 'error'); }
  });

  return (
    <OpsPage title={c?.name ?? 'Cohort'} back="/(officer)/ops/cohorts" keyboard onRefresh={() => { setDirty(false); void q.refetch(); void members.refetch(); }} refreshing={q.isRefetching}
      footer={c && dirty ? <Button label="Save changes" full loading={saving} onPress={() => save()} /> : undefined}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {c ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge label={c.kind === 'dynamic' ? 'From filters' : 'Hand picked'} tone="info" />
              <Text variant="caption" tabular color={colors.muted}>{total} {total === 1 ? 'student' : 'students'}</Text>
            </View>
            <Group>
              <TextField label="Name" value={name} onChangeText={(t) => { setName(t); setDirty(true); }} maxLength={80} error={errs.name} />
              <TextField label="Description" value={desc} onChangeText={(t) => { setDesc(t); setDirty(true); }} multiline maxLength={300} />
            </Group>
            {banner ? <Banner tone="error" message={banner} /> : null}
            {c.kind === 'dynamic' ? <DynamicFilterForm value={filter} onChange={(f) => { setFilter(f); setDirty(true); }} errors={errs} /> : null}

            <SectionHeader title="Members" action={c.kind === 'fixed' ? { label: 'Add', onPress: () => setPick(true) } : undefined} />
            <Async isLoading={members.isLoading} isError={members.isError} error={members.error} onRetry={() => void members.refetch()} isEmpty={rows.length === 0}
              empty={{ icon: 'groups', title: 'No members', message: c.kind === 'fixed' ? 'Add students to this cohort.' : 'No student matches these filters right now.', actionLabel: c.kind === 'fixed' ? 'Add students' : undefined, onAction: c.kind === 'fixed' ? () => setPick(true) : undefined }} rows={3} rowHeight={64}>
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16 }}>
                {rows.map((s, i) => (
                  <ListRow key={s.id} title={s.name} subtitle={[s.registrationNumber, s.department, s.batchYear ? `Batch ${s.batchYear}` : null, s.cgpa != null ? `CGPA ${Number(s.cgpa).toFixed(2)}` : null].filter(Boolean).join(' · ')}
                    right={c.kind === 'fixed' ? <Button label="Remove" variant="ghost" size="sm" disabled={removing} onPress={() => removeOne(s.id)} /> : undefined} last={i === rows.length - 1} />
                ))}
              </View>
              <LoadMore hasNext={members.hasNextPage} loading={members.isFetchingNextPage} onPress={() => void members.fetchNextPage()} />
            </Async>
            <Button label="Delete cohort" icon="delete-outline" variant="danger" full onPress={() => { setDelErr(null); setDelOpen(true); }} />
          </>
        ) : null}
      </Async>
      <StudentPicker visible={pick} multiple onClose={() => setPick(false)} title="Add students"
        onPick={async (s) => { setPick(false); try { await m.members(id, { add: s.map((x) => x.id) }); void members.refetch(); void q.refetch(); toast.show(`${s.length} added`, 'success'); } catch (x) { toast.show(errMessage(x), 'error'); } }} />
      <ConfirmSheet visible={delOpen} onClose={() => setDelOpen(false)} title="Delete cohort?" message="Students are not affected. A cohort used by a scheduled announcement cannot be deleted." confirmLabel="Delete" danger error={delErr}
        onConfirm={async () => { try { await m.remove(id); setDelOpen(false); toast.show('Cohort deleted', 'success'); back(); } catch (x) { setDelErr(errMessage(x)); } }} />
    </OpsPage>
  );
}
