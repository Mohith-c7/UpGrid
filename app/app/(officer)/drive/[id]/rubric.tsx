import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, SectionHeader, SegmentedTabs, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRounds, useRubric, useSaveRubric } from '@/api/pipeline';
import { Boundary, confirm, Page, sp, useOnce } from '@/features/pipeline/kit';
import { useUnsavedGuard } from '@/features/student/me/kit';

interface Row { key: number; label: string; description: string }
const MAX_ITEMS = 12;

export default function RubricEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<string>('drive');
  const rounds = useRounds(driveId);
  const q = useRubric(driveId, scope === 'drive' ? null : scope);
  const save = useSaveRubric(driveId);
  const uid = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const guard = useUnsavedGuard(dirty);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));

  useEffect(() => {
    if (!q.data) return;
    setRows((q.data.rubric?.items ?? []).map((i) => ({ key: uid.current++, label: i.label, description: i.description ?? '' })));
    setDirty(false); setErrors({}); setFormError(null);
  }, [q.data, scope]);

  const edit = (key: number, patch: Partial<Row>) => { setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x))); setDirty(true); setErrors((e) => ({ ...e, [key]: '' })); };
  const move = (i: number, d: -1 | 1) => { setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); };
  const remove = (key: number) => { setRows((r) => r.filter((x) => x.key !== key)); setDirty(true); };
  const add = () => { setRows((r) => [...r, { key: uid.current++, label: '', description: '' }]); setDirty(true); };
  const changeScope = (v: string) => {
    if (v === scope) return;
    if (dirty) confirm('Discard changes?', 'You have unsaved rubric changes.', 'Discard', () => { setDirty(false); setScope(v); });
    else setScope(v);
  };

  const [doSave, saving] = useOnce(async () => {
    const errs: Record<number, string> = {};
    rows.forEach((r) => {
      const l = r.label.trim();
      if (l.length < 2 || l.length > 80) errs[r.key] = 'Label must be 2 to 80 characters';
      else if (r.description.trim().length > 300) errs[r.key] = 'Description can be at most 300 characters';
    });
    setErrors(errs);
    if (rows.length < 1) { setFormError('Add at least one criterion.'); return; }
    if (Object.keys(errs).length) { setFormError('Fix the highlighted criteria.'); return; }
    setFormError(null);
    try {
      await save.mutateAsync({ roundId: scope === 'drive' ? null : scope, items: rows.map((r) => ({ label: r.label.trim(), description: r.description.trim() || null })) });
      guard.allowLeave(); setDirty(false);
      toast.show('Rubric saved', 'success');
    } catch (e) { setFormError(pipeError(e)); }
  });

  const tabs = [{ value: 'drive', label: 'Whole drive' }, ...[...(rounds.data ?? [])].sort((a, b) => a.seq - b.seq).map((r) => ({ value: r.id, label: `R${r.seq} ${r.name}` }))];
  const inherited = scope !== 'drive' && q.data && q.data.rubric && q.data.rubric.roundId === null;

  return (
    <Page title="Scoring rubric" onBack={back} keyboard onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={<Button label="Save rubric" full loading={saving} disabled={!dirty && !!q.data?.rubric} onPress={() => doSave()} />}>
      <Text variant="body" color={colors.textSecondary}>Interviewers rate each criterion from 1 to 5. A round rubric overrides the drive rubric for that round. Editing creates a new version.</Text>
      <SegmentedTabs value={scope} onChange={changeScope} options={tabs} />
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={140}>
        {inherited ? <Banner tone="info" message="This round uses the drive rubric. Saving creates a rubric just for this round." /> : null}
        {q.data?.rubric ? <Text variant="caption" color={colors.muted} tabular>{`Version ${q.data.rubric.version}`}</Text> : <Banner tone="warning" message="No rubric yet. Recruiters cannot submit scorecards until you add one." />}
        {rows.map((r, i) => (
          <Card key={r.key}>
            <View style={{ gap: sp.md }}>
              <Text variant="overline" color={colors.muted}>{`Criterion ${i + 1}`}</Text>
              <TextField label="Label" value={r.label} onChangeText={(t) => edit(r.key, { label: t })} maxLength={80} error={errors[r.key] || null} placeholder="e.g. Problem solving" />
              <TextField label="What good looks like (optional)" value={r.description} onChangeText={(t) => edit(r.key, { description: t })} multiline maxLength={300} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Button label="Up" icon="arrow-upward" size="sm" variant="secondary" disabled={i === 0} onPress={() => move(i, -1)} />
                <Button label="Down" icon="arrow-downward" size="sm" variant="secondary" disabled={i === rows.length - 1} onPress={() => move(i, 1)} />
                <Button label="Remove" icon="delete-outline" size="sm" variant="danger" onPress={() => remove(r.key)} />
              </View>
            </View>
          </Card>
        ))}
        <Button label="Add criterion" icon="add" variant="secondary" full disabled={rows.length >= MAX_ITEMS} onPress={add} />
        {rows.length >= MAX_ITEMS ? <Text variant="caption" color={colors.muted}>At most 12 criteria.</Text> : null}
        {formError ? <Banner tone="error" message={formError} /> : null}
      </Boundary>
    </Page>
  );
}
