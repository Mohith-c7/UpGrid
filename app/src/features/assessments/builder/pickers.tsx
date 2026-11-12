import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Banner, Button, Chip, Icon, SearchBar, SegmentedControl, Sheet, Skeleton, Text, TextField } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { api, errMessage } from '@/api/client';
import { questionListPath, uniqueById, useQuestions, type Page, type QuestionSummary, type SectionQuestion } from '@/api/assessments';
import { useStudents } from '@/features/officer/data';
import { DIFF_LABEL, DifficultyBadge, NumberField, TYPE_LABEL, parseNum } from '../kit';

export const toSectionQuestion = (q: QuestionSummary): SectionQuestion => ({
  questionId: q.id, type: q.type, title: q.title, marks: q.marks, negativeMarks: q.negativeMarks ?? 0, difficulty: q.difficulty,
});

const TYPE_CHIPS = [{ value: '', label: 'All' }, { value: 'mcq_single', label: 'MCQ single' }, { value: 'mcq_multi', label: 'MCQ multi' }, { value: 'coding', label: 'Coding' }, { value: 'numeric', label: 'Numeric' }, { value: 'short_text', label: 'Short text' }];

/** Pick questions from the bank (multi-select). */
export function BankPickerSheet({ visible, onClose, excluded, onAdd }: { visible: boolean; onClose: () => void; excluded: Set<string>; onAdd: (qs: QuestionSummary[]) => void }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [type, setType] = useState(''); const [diff, setDiff] = useState('');
  const [sel, setSel] = useState<Map<string, QuestionSummary>>(new Map());
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!visible) { setSel(new Map()); } }, [visible]);
  const query = useQuestions({ q: dq || undefined, type: type || undefined, difficulty: diff || undefined, status: 'active' }, visible);
  const items = useMemo(() => uniqueById(query.data?.pages.flatMap((p) => p.items) ?? []), [query.data]);
  const toggle = (it: QuestionSummary) => setSel((m) => { const n = new Map(m); if (n.has(it.id)) n.delete(it.id); else n.set(it.id, it); return n; });
  const addBtn = (
    <Button label={sel.size ? `Add ${sel.size} selected` : 'Select questions to add'} icon="playlist-add" full disabled={sel.size === 0} onPress={() => { onAdd([...sel.values()]); onClose(); }} />
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Add from question bank">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {addBtn}
        <SearchBar value={q} onChangeText={setQ} placeholder="Search questions" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPE_CHIPS.map((t) => <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />)}
        </View>
        <SegmentedControl value={diff} onChange={setDiff} options={[{ value: '', label: 'Any' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
        {query.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} height={72} radius={12} />)
          : query.isError ? <Banner tone="error" message={errMessage(query.error)} action={{ label: 'Retry', onPress: () => { void query.refetch(); } }} />
          : items.length === 0 ? <Banner tone="info" message={dq || type || diff ? 'No active questions match.' : 'The question bank has no active questions yet.'} />
          : items.map((it) => {
            const used = excluded.has(it.id); const on = sel.has(it.id);
            return (
              <Pressable key={it.id} disabled={used} onPress={() => toggle(it)} accessibilityRole="checkbox" accessibilityState={{ checked: on || used, disabled: used }}
                accessibilityLabel={`${it.title}. ${TYPE_LABEL[it.type]}. ${DIFF_LABEL[it.difficulty]}. ${it.marks} marks${used ? '. Already in this test' : ''}`}
                style={{ flexDirection: 'row', gap: 10, minHeight: MIN_TOUCH + 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: used ? 0.55 : 1, alignItems: 'flex-start' }}>
                <Icon name={on || used ? 'check-box' : 'check-box-outline-blank'} size={26} color={on ? colors.primary : colors.muted} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text variant="body" numberOfLines={3} style={{ fontWeight: '500' }}>{it.title}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Badge label={TYPE_LABEL[it.type]} tone="info" /><DifficultyBadge d={it.difficulty} />
                    {used ? <Badge label="Added" tone="neutral" icon="check" /> : null}
                  </View>
                  <Text variant="caption" color={colors.muted} tabular numberOfLines={1}>{[it.topic, `${it.marks} marks`].filter(Boolean).join(' · ')}</Text>
                </View>
              </Pressable>
            );
          })}
        {query.hasNextPage ? <Button label="Load more" variant="secondary" full loading={query.isFetchingNextPage} onPress={() => { void query.fetchNextPage(); }} /> : null}
        {items.length > 6 ? addBtn : null}
      </View>
    </Sheet>
  );
}

/** Auto-pick N random active questions by topic and difficulty. Nothing is added until the officer confirms the preview. */
export function AutoPickSheet({ visible, onClose, excluded, onAdd }: { visible: boolean; onClose: () => void; excluded: Set<string>; onAdd: (qs: QuestionSummary[]) => void }) {
  const [topic, setTopic] = useState(''); const [diff, setDiff] = useState(''); const [type, setType] = useState(''); const [count, setCount] = useState('5');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<QuestionSummary[] | null>(null); const [pool, setPool] = useState(0);
  useEffect(() => { if (!visible) { setPicked(null); setErr(null); } }, [visible]);
  const n = parseNum(count);
  const countErr = n === null || !Number.isInteger(n) || n < 1 || n > 50 ? 'Enter a whole number from 1 to 50.' : null;

  const run = async () => {
    if (countErr || busy) return;
    setBusy(true); setErr(null);
    try {
      const all: QuestionSummary[] = []; let cursor: string | undefined; let pages = 0;
      do {
        const p: Page<QuestionSummary> = await api.get(questionListPath({ topic: topic.trim() || undefined, difficulty: diff || undefined, type: type || undefined, status: 'active' }, cursor, 50));
        all.push(...p.items); cursor = p.nextCursor ?? undefined; pages++;
      } while (cursor && pages < 6);
      const avail = uniqueById(all).filter((x) => !excluded.has(x.id));
      setPool(avail.length);
      const a = [...avail];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      setPicked(a.slice(0, n!));
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Auto-pick questions">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        <Text variant="caption" color={colors.muted}>Random active questions that match. Questions already in this test are skipped. You can review the picks before adding.</Text>
        <TextField label="Topic (optional)" value={topic} onChangeText={(t) => { setTopic(t); setPicked(null); }} placeholder="For example Arrays" />
        <View style={{ gap: 6 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Difficulty</Text>
          <SegmentedControl value={diff} onChange={(v) => { setDiff(v); setPicked(null); }} options={[{ value: '', label: 'Any' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPE_CHIPS.map((t) => <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => { setType(t.value); setPicked(null); }} />)}
        </View>
        <NumberField label="How many" integer value={count} onChange={(t) => { setCount(t); setPicked(null); }} error={countErr} />
        {err ? <Banner tone="error" message={err} /> : null}
        <Button label={picked ? 'Pick again' : 'Pick questions'} icon="shuffle" variant={picked ? 'secondary' : 'primary'} full loading={busy} disabled={!!countErr} onPress={run} />
        {picked ? (
          picked.length === 0 ? <Banner tone="warning" message="No matching questions are available. Change the topic or difficulty, or add questions to the bank." />
          : (
            <>
              {picked.length < (n ?? 0) ? <Banner tone="warning" message={`Only ${pool} matching question${pool === 1 ? '' : 's'} available, so ${picked.length} picked.`} /> : null}
              {picked.map((it) => (
                <View key={it.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
                  <Text variant="body" numberOfLines={2} style={{ fontWeight: '500' }}>{it.title}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><Badge label={TYPE_LABEL[it.type]} tone="info" /><DifficultyBadge d={it.difficulty} /><Badge label={`${it.marks} marks`} tone="neutral" /></View>
                </View>
              ))}
              <Button label={`Add ${picked.length} question${picked.length === 1 ? '' : 's'}`} icon="playlist-add" full onPress={() => { onAdd(picked); onClose(); }} />
            </>
          )
        ) : null}
      </View>
    </Sheet>
  );
}

/** Edit marks / negative marks of one question inside the test. */
export function MarksSheet({ q, onClose, onSave }: { q: SectionQuestion | null; onClose: () => void; onSave: (marks: number, neg: number) => void }) {
  const [m, setM] = useState(''); const [ng, setNg] = useState('');
  useEffect(() => { if (q) { setM(String(q.marks)); setNg(String(q.negativeMarks)); } }, [q]);
  const mv = parseNum(m); const nv = ng.trim() === '' ? 0 : parseNum(ng);
  const mErr = mv === null || mv < 0.25 || mv > 100 ? 'Marks must be 0.25 to 100.' : null;
  const nErr = nv === null || nv < 0 || (mv !== null && nv > mv) ? 'Negative marks must be 0 up to the marks.' : null;
  return (
    <Sheet visible={!!q} onClose={onClose} title="Marks for this question">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        <Text variant="caption" color={colors.muted} numberOfLines={3}>{q?.title}</Text>
        <NumberField label="Marks" value={m} onChange={setM} error={mErr} />
        <NumberField label="Negative marks" value={ng} onChange={setNg} error={nErr} helper="Only applies when negative marking is on for the test." />
        <Button label="Save" full disabled={!!mErr || !!nErr} onPress={() => { onSave(mv!, nv ?? 0); onClose(); }} />
      </View>
    </Sheet>
  );
}

/** Search students and pick a set. */
export function StudentPickerSheet({ visible, onClose, selected, onDone }: { visible: boolean; onClose: () => void; selected: Record<string, string>; onDone: (picked: Record<string, string>) => void }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [sel, setSel] = useState<Record<string, string>>(selected);
  useEffect(() => { if (visible) setSel(selected); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const query = useStudents({ q: dq || undefined });
  const items = useMemo(() => uniqueById(query.data?.pages.flatMap((p) => p.items) ?? []), [query.data]);
  const count = Object.keys(sel).length;
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose students">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        <Button label={`Use ${count} selected`} full disabled={count === 0} onPress={() => { onDone(sel); onClose(); }} />
        <SearchBar value={q} onChangeText={setQ} placeholder="Search by name, email or reg. no." />
        {query.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} height={56} radius={12} />)
          : query.isError ? <Banner tone="error" message={errMessage(query.error)} action={{ label: 'Retry', onPress: () => { void query.refetch(); } }} />
          : items.length === 0 ? <Banner tone="info" message="No students found." />
          : items.map((s) => {
            const on = !!sel[s.id];
            return (
              <Pressable key={s.id} onPress={() => setSel((m) => { const n = { ...m }; if (n[s.id]) delete n[s.id]; else n[s.id] = s.name; return n; })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${s.name}. ${s.department ?? ''}`}
                style={{ flexDirection: 'row', gap: 10, minHeight: MIN_TOUCH + 8, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Icon name={on ? 'check-box' : 'check-box-outline-blank'} size={26} color={on ? colors.primary : colors.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '500' }}>{s.name}</Text>
                  <Text variant="caption" color={colors.muted} numberOfLines={1}>{[s.department, s.email].filter(Boolean).join(' · ')}</Text>
                </View>
              </Pressable>
            );
          })}
        {query.hasNextPage ? <Button label="Load more" variant="secondary" full loading={query.isFetchingNextPage} onPress={() => { void query.fetchNextPage(); }} /> : null}
      </View>
    </Sheet>
  );
}
