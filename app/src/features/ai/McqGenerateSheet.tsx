import React from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, Icon, Sheet, SegmentedControl, Text, TextField } from '@/ui';
import { colors, MIN_TOUCH, spacing } from '@/theme';
import { ApiError } from '@/api/client';
import { useDiscardMcqDraft, useGenerateMcqs, useImportMcqDrafts, useUpdateMcqDraft } from '@/api/ai';
import type { Difficulty, McqDraft, McqImportResult } from '@/api/aiTypes';
import { AiErrorBanner } from './kit';

export interface McqGenerateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called after the officer imports drafts into the question bank (nothing is published automatically). */
  onImported?: (result: McqImportResult) => void;
  defaultTopic?: string;
  defaultTags?: string[];
}

const COUNTS = [3, 5, 8, 10];
const DIFFS = [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];
const LETTERS = ['A', 'B', 'C', 'D'];

/** Bottom sheet: generate MCQ drafts for a topic, edit them, then import the chosen ones to the question bank. */
export function McqGenerateSheet({ visible, onClose, onImported, defaultTopic, defaultTags }: McqGenerateSheetProps) {
  const gen = useGenerateMcqs();
  const upd = useUpdateMcqDraft();
  const disc = useDiscardMcqDraft();
  const imp = useImportMcqDrafts();

  const [topic, setTopic] = React.useState(defaultTopic ?? '');
  const [tags, setTags] = React.useState((defaultTags ?? []).join(', '));
  const [difficulty, setDifficulty] = React.useState<Difficulty>('medium');
  const [count, setCount] = React.useState(5);
  const [drafts, setDrafts] = React.useState<McqDraft[]>([]);
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [result, setResult] = React.useState<McqImportResult | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  const topicOk = topic.trim().length >= 2 && topic.trim().length <= 120;

  const generate = async () => {
    setError(null); setResult(null);
    try {
      const r = await gen.mutateAsync({ topic: topic.trim(), difficulty, count, tags: tagList.length ? tagList : undefined });
      setDrafts(r.items);
      setDirty(new Set());
      setPicked(new Set(r.items.map((d) => d.id)));
    } catch (e) { setError(e); }
  };
  const edit = (id: string, p: Partial<McqDraft>) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)));
    setDirty((s) => new Set(s).add(id));
  };
  const setOption = (d: McqDraft, i: number, v: string) => edit(d.id, { options: d.options.map((o, j) => (j === i ? v : o)) });
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const discard = async (id: string) => {
    setError(null);
    try {
      await disc.mutateAsync(id);
      setDrafts((ds) => ds.filter((d) => d.id !== id));
      setPicked((s) => { const n = new Set(s); n.delete(id); return n; });
    } catch (e) { setError(e); }
  };

  const valid = (d: McqDraft) => d.stem.trim().length > 0 && d.options.length === 4 && d.options.every((o) => o.trim().length > 0);
  const chosen = drafts.filter((d) => picked.has(d.id));
  const canImport = chosen.length > 0 && chosen.every(valid);

  const doImport = async () => {
    setError(null);
    try {
      for (const d of chosen.filter((x) => dirty.has(x.id))) {
        await upd.mutateAsync({ id: d.id, stem: d.stem.trim(), options: d.options.map((o) => o.trim()), correctIndex: d.correctIndex, explanation: d.explanation });
      }
      setDirty(new Set());
      const r = await imp.mutateAsync(chosen.map((d) => d.id));
      setResult(r);
      const done = new Set(r.imported.map((x) => x.draftId));
      setDrafts((ds) => ds.filter((d) => !done.has(d.id)));
      setPicked((s) => { const n = new Set(s); done.forEach((x) => n.delete(x)); return n; });
      onImported?.(r);
    } catch (e) { setError(e); }
  };

  const notLinked = error instanceof ApiError && error.code === 'QUESTION_BANK_NOT_LINKED';

  return (
    <Sheet visible={visible} onClose={onClose} title="Generate MCQs with AI">
      <View style={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <TextField label="Topic" value={topic} onChangeText={setTopic} maxLength={120} placeholder="e.g. SQL joins" />
        <TextField label="Tags (optional)" value={tags} onChangeText={setTags} placeholder="sql, databases" helper="Separate with commas, up to 8" />
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color={colors.muted}>Difficulty</Text>
          <SegmentedControl value={difficulty} onChange={(v) => setDifficulty(v as Difficulty)} options={DIFFS} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color={colors.muted}>How many</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {COUNTS.map((n) => <Chip key={n} label={String(n)} selected={count === n} onPress={() => setCount(n)} />)}
          </View>
        </View>

        {error && !notLinked ? <AiErrorBanner error={error} onRetry={drafts.length ? undefined : generate} /> : null}
        {notLinked ? <Banner tone="warning" title="Question bank not connected" message="Drafts are saved, but importing needs the assessments question bank to be linked by an admin." /> : null}
        <Button label={drafts.length ? 'Generate more' : 'Generate drafts'} icon="auto-awesome" variant={drafts.length ? 'secondary' : 'primary'} full loading={gen.isPending} disabled={!topicOk} onPress={generate} />

        {result ? (
          <Banner
            tone={result.imported.length ? 'success' : 'warning'}
            title={`${result.imported.length} imported`}
            message={result.skipped.length ? `${result.skipped.length} skipped: ${result.skipped.map((s) => s.reason).join('; ')}` : 'Imported questions are in your question bank as unpublished questions.'}
          />
        ) : null}

        {drafts.length ? <Banner tone="warning" title="Drafts: check every answer" message="AI can pick the wrong correct option. Verify each question before importing." /> : null}

        {drafts.map((d, n) => {
          const on = picked.has(d.id);
          return (
            <Card key={d.id}>
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' }}>
                  <Pressable
                    onPress={() => toggle(d.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Select question ${n + 1} for import`}
                    style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}
                  >
                    <Icon name={on ? 'check-box' : 'check-box-outline-blank'} size={24} color={on ? colors.primary : colors.subtle} />
                    <Text variant="overline" color={colors.muted}>{`Question ${n + 1}`}</Text>
                  </Pressable>
                  <Badge label="Draft" tone="warning" />
                </View>
                <TextField label="Question" value={d.stem} onChangeText={(v) => edit(d.id, { stem: v })} multiline />
                {d.options.map((o, i) => (
                  <TextField key={i} label={`Option ${LETTERS[i]}`} value={o} onChangeText={(v) => setOption(d, i, v)} />
                ))}
                <View style={{ gap: spacing.sm }}>
                  <Text variant="caption" color={colors.muted}>Correct option</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {LETTERS.map((l, i) => <Chip key={l} label={l} selected={d.correctIndex === i} onPress={() => edit(d.id, { correctIndex: i })} />)}
                  </View>
                </View>
                <TextField label="Explanation" value={d.explanation} onChangeText={(v) => edit(d.id, { explanation: v })} multiline />
                <Button label="Discard" variant="ghost" icon="delete-outline" size="sm" onPress={() => discard(d.id)} />
              </View>
            </Card>
          );
        })}

        {drafts.length ? (
          <Button label={`Import ${chosen.length} to question bank`} icon="playlist-add" full loading={imp.isPending || upd.isPending} disabled={!canImport} onPress={doImport} />
        ) : null}
      </View>
    </Sheet>
  );
}
