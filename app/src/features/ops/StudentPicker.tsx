import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, SearchBar, Sheet, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { searchStudentsForCohort } from '@/api/ops';
import { PickRow } from './kit';

export interface PickedStudent { id: string; name: string; sub?: string }

/** Search students by name / registration number and pick one (or several). */
export function StudentPicker({ visible, onClose, onPick, multiple, title = 'Find a student' }: {
  visible: boolean; onClose: () => void; onPick: (s: PickedStudent[]) => void; multiple?: boolean; title?: string;
}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [sel, setSel] = useState<Map<string, PickedStudent>>(new Map());
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!visible) { setQ(''); setSel(new Map()); } }, [visible]);
  const res = useQuery({ queryKey: ['ops', 'student-search', dq], enabled: visible && dq.length >= 2, queryFn: () => searchStudentsForCohort(dq) });
  const toggle = (s: PickedStudent) => {
    if (!multiple) { onPick([s]); return; }
    setSel((m) => { const n = new Map(m); if (n.has(s.id)) n.delete(s.id); else n.set(s.id, s); return n; });
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Name or registration number" />
        {dq.length < 2 ? <Text variant="caption" color={colors.muted}>Type at least 2 characters.</Text> : null}
        {res.isLoading ? <><Skeleton height={56} radius={12} /><Skeleton height={56} radius={12} /></> : null}
        {res.isError ? <Banner tone="error" message={errMessage(res.error)} action={{ label: 'Retry', onPress: () => void res.refetch() }} /> : null}
        {res.data && res.data.items.length === 0 ? <Text variant="body" color={colors.muted}>No students match "{dq}".</Text> : null}
        {res.data?.items.map((s) => {
          const sub = [s.registrationNumber, s.department, s.batchYear ? `Batch ${s.batchYear}` : null].filter(Boolean).join(' · ');
          return <PickRow key={s.id} label={s.name} sub={sub} selected={sel.has(s.id)} onPress={() => toggle({ id: s.id, name: s.name, sub })} />;
        })}
        {multiple ? <Button label={sel.size ? `Add ${sel.size} selected` : 'Select students to add'} full disabled={sel.size === 0} onPress={() => onPick([...sel.values()])} /> : null}
      </View>
    </Sheet>
  );
}
