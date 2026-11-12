import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorState, HeaderAction, Icon, ListRow, SearchBar, SegmentedControl, Sheet, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { uniqueById, useQuestionAction, useQuestions, type QuestionFilters, type QuestionSummary } from '@/api/assessments';
import { useFeature } from '@/config/features';
import { McqGenerateSheet } from '@/features/ai';
import { ImportSheet } from '@/features/assessments/ImportSheet';
import { ConfirmSheet, DIFF_LABEL, DifficultyBadge, ListFrame, MoreFooter, Pill, ROOT, TYPE_ICON, TYPE_LABEL } from '@/features/assessments/kit';
import { useOnce } from '@/features/officer/components/common';

const TYPES = [
  { value: '', label: 'All types' }, { value: 'mcq_single', label: 'MCQ single' }, { value: 'mcq_multi', label: 'MCQ multi' },
  { value: 'coding', label: 'Coding' }, { value: 'numeric', label: 'Numeric' }, { value: 'short_text', label: 'Short text' },
];
const DIFFS = [{ value: '', label: 'Any' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];
const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }];

export default function QuestionBank() {
  const r = useRouter();
  const toast = useToast();
  const ai = useFeature('ai');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [type, setType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [practice, setPractice] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [actionFor, setActionFor] = useState<QuestionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuestionSummary | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const filters: QuestionFilters = { q: dq || undefined, type: type || undefined, difficulty: difficulty || undefined, topic: topic.trim() || undefined, tag: tag.trim().toLowerCase() || undefined, status, practice: practice || undefined };
  const query = useQuestions(filters);
  const items = useMemo(() => uniqueById(query.data?.pages.flatMap((p) => p.items) ?? []), [query.data]);
  const act = useQuestionAction();
  const activeCount = [type, difficulty, topic.trim(), tag.trim(), status !== 'active' ? status : '', practice ? 'p' : ''].filter(Boolean).length;

  const [runAction, busy] = useOnce(async (item: QuestionSummary, action: 'archive' | 'unarchive' | 'duplicate') => {
    try {
      const res = await act.mutateAsync({ id: item.id, action });
      setActionFor(null);
      toast.show(action === 'duplicate' ? 'Duplicated. Opening the copy.' : action === 'archive' ? 'Archived' : 'Restored', 'success');
      if (action === 'duplicate' && res) r.push(`${ROOT}/questions/${res.id}` as any);
    } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [doDelete, deleting] = useOnce(async () => {
    if (!confirmDelete) return;
    try {
      await act.mutateAsync({ id: confirmDelete.id, action: 'delete' });
      setConfirmDelete(null); toast.show('Question deleted', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUESTION_IN_USE') toast.show('This question is used in a test. Archive it instead.', 'error');
      else toast.show(errMessage(e), 'error');
      setConfirmDelete(null);
    }
  });

  return (
    <ListFrame
      title="Question bank"
      right={(
        <View style={{ flexDirection: 'row' }}>
          {ai ? <HeaderAction icon="auto-awesome" label="Generate with AI" onPress={() => setAiOpen(true)} /> : null}
          <HeaderAction icon="upload-file" label="Import questions" onPress={() => setImportOpen(true)} />
        </View>
      )}
      footer={<Button label="New question" icon="add" full onPress={() => r.push(`${ROOT}/questions/new` as any)} />}
    >
      <FlatList
        data={query.isLoading || query.isError ? [] : items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => { void query.refetch(); }}
        ListHeaderComponent={(
          <View style={{ gap: 12, marginBottom: 4 }}>
            <SearchBar value={q} onChangeText={setQ} placeholder="Search questions" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button label={activeCount ? `Filters (${activeCount})` : 'Filters'} icon="filter-list" variant="secondary" size="sm" onPress={() => setFiltersOpen(true)} />
              {type ? <Chip label={TYPES.find((t) => t.value === type)?.label ?? type} selected onPress={() => setType('')} /> : null}
              {difficulty ? <Chip label={DIFF_LABEL[difficulty as keyof typeof DIFF_LABEL] ?? difficulty} selected onPress={() => setDifficulty('')} /> : null}
              {status !== 'active' ? <Chip label={status === 'archived' ? 'Archived' : 'All statuses'} selected onPress={() => setStatus('active')} /> : null}
              {topic.trim() ? <Chip label={`Topic: ${topic.trim()}`} selected onPress={() => setTopic('')} /> : null}
              {tag.trim() ? <Chip label={`Tag: ${tag.trim()}`} selected onPress={() => setTag('')} /> : null}
              {practice ? <Chip label="Practice" selected onPress={() => setPractice(false)} /> : null}
            </View>
          </View>
        )}
        renderItem={({ item }) => (
          <Card padding={0}>
            <Pressable
              onPress={() => r.push(`${ROOT}/questions/${item.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${TYPE_LABEL[item.type]}. ${DIFF_LABEL[item.difficulty] ?? item.difficulty}. ${item.marks} marks${item.status === 'archived' ? '. Archived' : ''}`}
              style={({ pressed }) => ({ padding: 14, paddingBottom: 8, gap: 8, minHeight: MIN_TOUCH, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
            >
              <Text variant="subhead" numberOfLines={3}>{item.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Badge label={TYPE_LABEL[item.type]} tone="info" icon={TYPE_ICON[item.type]} />
                <DifficultyBadge d={item.difficulty} />
                {item.status === 'archived' ? <Badge label="Archived" tone="neutral" icon="inventory-2" /> : null}
                {item.practice ? <Badge label="Practice" tone="neutral" /> : null}
              </View>
              <Text variant="caption" color={colors.muted} numberOfLines={2}>{[item.topic, item.tags?.length ? item.tags.map((t) => `#${t}`).join(' ') : null].filter(Boolean).join('  ')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
                <Pill icon="stars" text={`${item.marks} marks${item.negativeMarks ? `, -${item.negativeMarks}` : ''}`} />
                <Pill icon="description" text={`Used in ${item.usedIn ?? 0}`} />
                {item.testCaseCounts ? <Pill icon="rule" text={`${item.testCaseCounts.sample} sample, ${item.testCaseCounts.hidden} hidden`} /> : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => setActionFor(item)}
              accessibilityRole="button"
              accessibilityLabel={`Actions for ${item.title}`}
              style={({ pressed }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: pressed ? colors.pressed : 'transparent', borderBottomLeftRadius: 14, borderBottomRightRadius: 14 })}
            >
              <Icon name="more-horiz" size={22} color={colors.primary} />
              <Text variant="button" color={colors.primary}>Actions</Text>
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={150} radius={14} />)}</View>
          ) : query.isError ? (
            <ErrorState message={errMessage(query.error)} onRetry={() => { void query.refetch(); }} />
          ) : (
            <EmptyState icon="library-books" title={dq || activeCount ? 'No questions match' : 'Your question bank is empty'}
              message={dq || activeCount ? 'Try clearing the search or filters.' : 'Add questions one by one, import a CSV or JSON file, or generate drafts with AI.'}
              actionLabel={dq || activeCount ? undefined : 'Import questions'} onAction={dq || activeCount ? undefined : () => setImportOpen(true)} />
          )
        }
        ListFooterComponent={items.length ? (
          <MoreFooter hasMore={query.hasNextPage} loading={query.isFetchingNextPage} error={query.isFetchNextPageError}
            onMore={() => { void query.fetchNextPage(); }} onRetry={() => { void query.fetchNextPage(); }} />
        ) : undefined}
      />

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter questions">
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />)}
          </View>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Difficulty</Text>
          <SegmentedControl value={difficulty} onChange={setDifficulty} options={DIFFS} />
          <TextField label="Topic" value={topic} onChangeText={setTopic} placeholder="For example Arrays" />
          <TextField label="Tag" value={tag} onChangeText={setTag} placeholder="For example aptitude" autoCapitalize="none" />
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Status</Text>
          <SegmentedControl value={status} onChange={(v) => setStatus(v as any)} options={STATUSES} />
          <Chip label="Practice questions only" selected={practice} onPress={() => setPractice((p) => !p)} />
          <Button label="Show results" full onPress={() => setFiltersOpen(false)} />
          <Button label="Clear all filters" variant="ghost" full onPress={() => { setType(''); setDifficulty(''); setTopic(''); setTag(''); setStatus('active'); setPractice(false); }} />
        </View>
      </Sheet>

      <Sheet visible={!!actionFor} onClose={() => setActionFor(null)} title={actionFor?.title ?? ''}>
        {actionFor ? (
          <View style={{ paddingBottom: 12 }}>
            <ListRow icon="edit" title="Edit question" onPress={() => { const id = actionFor.id; setActionFor(null); r.push(`${ROOT}/questions/${id}` as any); }} />
            <ListRow icon="content-copy" title="Duplicate" subtitle="Creates a copy you can edit" onPress={() => { if (!busy) void runAction(actionFor, 'duplicate'); }} />
            {actionFor.status === 'archived'
              ? <ListRow icon="unarchive" title="Restore from archive" onPress={() => { if (!busy) void runAction(actionFor, 'unarchive'); }} />
              : <ListRow icon="inventory-2" title="Archive" subtitle="Hides it from new tests. Published tests keep their copy." onPress={() => { if (!busy) void runAction(actionFor, 'archive'); }} />}
            <ListRow icon="delete-outline" title="Delete" subtitle="Only possible when no test uses it" onPress={() => { setConfirmDelete(actionFor); setActionFor(null); }} last />
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet visible={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this question?" tone="danger" confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        message="This cannot be undone. If a test uses it, archive it instead." onConfirm={() => doDelete()} disabled={deleting}>
        {confirmDelete ? <Banner tone="warning" message={confirmDelete.title} /> : null}
      </ConfirmSheet>

      <ImportSheet visible={importOpen} onClose={() => setImportOpen(false)} />
      {ai ? <McqGenerateSheet visible={aiOpen} onClose={() => setAiOpen(false)} onImported={(res) => { void query.refetch(); toast.show(`${res.imported.length} question${res.imported.length === 1 ? '' : 's'} added to the bank`, 'success'); }} /> : null}
    </ListFrame>
  );
}
