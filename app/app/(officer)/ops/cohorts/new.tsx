import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, SegmentedControl, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useCohortMutations } from '@/api/ops';
import { DynamicFilterForm, EMPTY_FILTER, filterErrors, formToFilter } from '@/features/ops/CohortForm';
import { Group, OpsPage, useBack, useGo, useOnce } from '@/features/ops/kit';
import { StudentPicker, type PickedStudent } from '@/features/ops/StudentPicker';

export default function NewCohort() {
  const toast = useToast();
  const back = useBack('/(officer)/ops/cohorts');
  const go = useGo();
  const m = useCohortMutations();
  const [kind, setKind] = useState<'dynamic' | 'fixed'>('dynamic');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [students, setStudents] = useState<PickedStudent[]>([]);
  const [pick, setPick] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const [save, busy] = useOnce(async () => {
    const e: Record<string, string> = kind === 'dynamic' ? filterErrors(filter) : {};
    if (name.trim().length < 2) e.name = 'Enter a name of at least 2 characters';
    setErrs(e); setBanner(null);
    if (Object.keys(e).length) return;
    try {
      const r = await m.create({ name: name.trim(), description: desc.trim() || undefined, kind, filter: kind === 'dynamic' ? formToFilter(filter) : undefined, studentIds: kind === 'fixed' ? students.map((s) => s.id) : undefined });
      toast.show('Cohort created', 'success');
      if (r.cohort?.id) go(`/(officer)/ops/cohorts/${r.cohort.id}`); else back();
    } catch (x) { setErrs(fieldErrors(x)); setBanner(errMessage(x)); }
  });

  return (
    <OpsPage title="New cohort" keyboard footer={<Button label="Create cohort" full loading={busy} onPress={() => save()} />}>
      <Group>
        <SegmentedControl value={kind} onChange={(v) => setKind(v as 'dynamic' | 'fixed')} options={[{ value: 'dynamic', label: 'From filters' }, { value: 'fixed', label: 'Hand picked' }]} />
        <Text variant="caption" color={colors.muted}>{kind === 'dynamic' ? 'Members update automatically as student data changes.' : 'Members stay exactly as you choose.'}</Text>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={80} error={errs.name} />
        <TextField label="Description (optional)" value={desc} onChangeText={setDesc} multiline maxLength={300} error={errs.description} />
      </Group>
      {kind === 'dynamic' ? <DynamicFilterForm value={filter} onChange={setFilter} errors={errs} /> : (
        <Group title={`Students (${students.length})`}>
          {students.length === 0 ? <Text variant="body" color={colors.muted}>No students chosen yet. You can add more later.</Text> : students.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}><Text variant="body">{s.name}</Text>{s.sub ? <Text variant="caption" color={colors.muted}>{s.sub}</Text> : null}</View>
              <Button label="Remove" variant="ghost" size="sm" onPress={() => setStudents((l) => l.filter((x) => x.id !== s.id))} />
            </View>
          ))}
          <Button label="Add students" icon="person-add" variant="secondary" full onPress={() => setPick(true)} />
        </Group>
      )}
      {banner ? <Banner tone="error" message={banner} /> : null}
      <StudentPicker visible={pick} multiple onClose={() => setPick(false)} title="Add students" onPick={(s) => { setStudents((l) => [...l, ...s.filter((x) => !l.some((y) => y.id === x.id))]); setPick(false); }} />
    </OpsPage>
  );
}
