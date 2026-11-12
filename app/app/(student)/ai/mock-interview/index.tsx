import React from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, Checkbox, Chip, EmptyState, ErrorState, SectionHeader, Select, SegmentedControl, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { confirm, Page, sp } from '@/features/student/me/kit';
import { errMessage } from '@/api/client';
import { flatten, useDrives } from '@/api/hooks';
import { aiKeys, flattenPages, useDeleteMock, useMockHistory, useStartMock } from '@/api/ai';
import type { Difficulty, InterviewType, MockHistoryItem } from '@/api/aiTypes';
import { AiErrorBanner, AiGate, AI_ROUTES, QuotaMeter, TYPE_LABEL } from '@/features/ai/kit';
import { timeAgo } from '@/lib/format';

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const COUNTS = [3, 5, 7, 10];

export default function MockInterviewHome() {
  const router = useRouter();
  return (
    <Page title="Mock interview" scroll={false} keyboard onBack={() => (router.canGoBack() ? router.back() : router.replace(AI_ROUTES.hub as never))}>
      <AiGate>{(status) => <Body quota={status.quota} consent={status.consent.granted} />}</AiGate>
    </Page>
  );
}

function Body({ quota, consent }: { quota: any; consent: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const start = useStartMock();
  const hist = useMockHistory(true);
  const del = useDeleteMock();
  const drives = useDrives({ status: 'open', limit: 20 });
  const items = flattenPages(hist.data);

  const [role, setRole] = React.useState('');
  const [type, setType] = React.useState<InterviewType>('technical');
  const [difficulty, setDifficulty] = React.useState<Difficulty>('medium');
  const [num, setNum] = React.useState(5);
  const [personalise, setPersonalise] = React.useState(consent);
  const [driveId, setDriveId] = React.useState('');
  const roleOk = role.trim().length >= 2 && role.trim().length <= 80;
  const out = !!quota && quota.remaining <= 0;

  const driveOptions = React.useMemo(
    () => [{ value: '', label: 'No specific drive' }, ...flatten(drives.data).map((d) => ({ value: d.id, label: `${d.company.name} - ${d.role}` }))],
    [drives.data],
  );

  const submit = async () => {
    try {
      const r = await start.mutateAsync({
        role: role.trim(), type, difficulty, numQuestions: num, driveId: driveId || undefined, personalise: consent && personalise,
      });
      qc.setQueryData(aiKeys.mock(r.interview.id), { interview: r.interview, turns: [{ index: r.question.index, question: r.question.text, answer: null, feedback: null }], report: null });
      router.push(`/(student)/ai/mock-interview/${r.interview.id}` as never);
    } catch {
      /* rendered below */
    }
  };

  const remove = (it: MockHistoryItem) =>
    confirm('Delete this mock interview?', `${it.role} will be permanently deleted.`, 'Delete', async () => {
      try { await del.mutateAsync(it.id); toast.show('Mock interview deleted', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
    });

  const header = (
    <View style={{ gap: sp.xl, paddingBottom: sp.xl }}>
      <Card tinted>
        <View style={{ gap: sp.md }}>
          <Text variant="body" color={colors.textSecondary}>Answer questions one at a time and get feedback after each. Scores are advisory practice only.</Text>
          <QuotaMeter quota={quota} />
        </View>
      </Card>
      <Card>
        <View style={{ gap: sp.lg }}>
          <TextField label="Role" value={role} onChangeText={setRole} maxLength={80} placeholder="e.g. Software Engineer" helper="Type a role or choose a drive below" />
          <Select label="Practise for a drive (optional)" value={driveId} onChange={(v) => {
            setDriveId(v);
            const d = flatten(drives.data).find((x) => x.id === v);
            if (d && !role.trim()) setRole(d.role.slice(0, 80));
          }} options={driveOptions} />
          <View style={{ gap: sp.sm }}>
            <Text variant="caption" color={colors.muted}>Interview type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {(Object.keys(TYPE_LABEL) as InterviewType[]).map((t) => <Chip key={t} label={TYPE_LABEL[t]} selected={type === t} onPress={() => setType(t)} />)}
            </View>
          </View>
          <View style={{ gap: sp.sm }}>
            <Text variant="caption" color={colors.muted}>Difficulty</Text>
            <SegmentedControl value={difficulty} onChange={(v) => setDifficulty(v as Difficulty)} options={(Object.keys(DIFF_LABEL) as Difficulty[]).map((d) => ({ value: d, label: DIFF_LABEL[d] }))} />
          </View>
          <View style={{ gap: sp.sm }}>
            <Text variant="caption" color={colors.muted}>Number of questions</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {COUNTS.map((n) => <Chip key={n} label={String(n)} selected={num === n} onPress={() => setNum(n)} />)}
            </View>
          </View>
          {consent ? (
            <Checkbox checked={personalise} onChange={setPersonalise}><Text variant="body">Personalise with my skills</Text></Checkbox>
          ) : (
            <Banner tone="info" message="Personalisation is off, so questions use the role only. You can turn it on in AI privacy." action={{ label: 'AI privacy', onPress: () => router.push(AI_ROUTES.consent as never) }} />
          )}
          {start.isError ? <AiErrorBanner error={start.error} onRetry={submit} onConsent={() => router.push(AI_ROUTES.consent as never)} /> : null}
          <Button label="Start interview" icon="play-arrow" full loading={start.isPending} disabled={!roleOk || out} onPress={submit} />
          {out ? <Text variant="caption" color={colors.muted} align="center">Daily AI limit reached. Try again after 5:30 AM IST.</Text> : null}
        </View>
      </Card>
      <SectionHeader title="Past interviews" />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: sp.xxxl, gap: sp.md }}
        keyboardShouldPersistTaps="handled"
        refreshing={hist.isRefetching}
        onRefresh={() => void hist.refetch()}
        onEndReached={() => { if (hist.hasNextPage && !hist.isFetchingNextPage) void hist.fetchNextPage(); }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          hist.isLoading ? <Skeleton height={84} radius={14} /> : hist.isError ? <ErrorState message={errMessage(hist.error)} onRetry={() => void hist.refetch()} /> : (
            <EmptyState icon="record-voice-over" title="No interviews yet" message="Finished and in-progress practice sessions show up here." />
          )
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/(student)/ai/mock-interview/${item.id}` as never)} accessibilityLabel={`${item.role}, ${TYPE_LABEL[item.type]}`}>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead" numberOfLines={2}>{item.role}</Text>
              <Text variant="caption" color={colors.muted}>{`${TYPE_LABEL[item.type]}, ${DIFF_LABEL[item.difficulty]}`}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignItems: 'center' }}>
                {item.status === 'finished' ? <Badge label={item.overall != null ? `Score ${Math.round(item.overall)} / 100` : 'Finished'} tone="success" icon="check-circle" /> : <Badge label={`In progress ${item.answered}/${item.numQuestions}`} tone="warning" icon="timelapse" />}
              </View>
              <Text variant="caption" tabular color={colors.muted}>{timeAgo(item.createdAt)}</Text>
              <View style={{ flexDirection: 'row' }}><Button label="Delete" icon="delete-outline" variant="ghost" size="sm" onPress={() => remove(item)} /></View>
            </View>
          </Card>
        )}
      />
    </View>
  );
}
