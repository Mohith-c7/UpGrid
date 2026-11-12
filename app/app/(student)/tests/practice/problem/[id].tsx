import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Badge, Banner, EmptyState, ErrorState, Header, OfflineBanner, Screen, Skeleton, Text } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { ApiError } from '@/api/client';
import { runPracticeCode, submitPracticeCode, usePracticeProblem } from '@/api/tests';
import type { CodeAnswer, CodeSubmission, PracticeProblem } from '@/api/testsTypes';
import { TestsGate } from '@/features/tests/Gate';
import { CodingPanel, starterFor, type CodingRunner } from '@/features/tests/CodingPanel';
import { netMessage, sp } from '@/features/tests/kit';
import { readJson, writeJson } from '@/features/tests/store';

interface Draft { language: string; buffers: Record<string, string>; lastSubmitted?: string }
const DIFF_TONE = { easy: 'success', medium: 'warning', hard: 'error' } as const;

function Editor({ problem }: { problem: PracticeProblem }) {
  const navigation = useNavigation<any>();
  const key = `practice-${problem.id}`;
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState<CodeAnswer>({ language: problem.languages[0], code: '' });
  const [lastSubmitted, setLastSubmitted] = useState<string | undefined>(problem.lastSubmission?.code);
  const [solved, setSolved] = useState(problem.solved);
  const buffers = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bypass = useRef(false);

  // Restore the on-device draft (never lose code), else the last submission, else the starter.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return; // a background refetch gives `problem` a new identity: never overwrite what is being typed
    let live = true;
    (async () => {
      const d = await readJson<Draft>(key);
      if (!live) return;
      restored.current = true;
      const last = problem.lastSubmission;
      const lang = d?.language && problem.languages.includes(d.language) ? d.language : last && problem.languages.includes(last.language) ? last.language : problem.languages[0];
      buffers.current = { ...(d?.buffers ?? {}) };
      if (last && buffers.current[last.language] === undefined) buffers.current[last.language] = last.code;
      const code = buffers.current[lang] ?? starterFor(problem, lang);
      if (d?.lastSubmitted !== undefined) setLastSubmitted(d.lastSubmitted);
      setValue({ language: lang, code });
      setReady(true);
    })();
    return () => { live = false; };
  }, [key, problem]);

  const save = useCallback((v: CodeAnswer, ls: string | undefined) => {
    buffers.current[v.language] = v.code;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => writeJson(key, { language: v.language, buffers: buffers.current, lastSubmitted: ls } satisfies Draft), 600);
  }, [key]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (v: CodeAnswer) => { setValue(v); save(v, lastSubmitted); };

  const starter = starterFor(problem, value.language);
  const dirty = ready && value.code.trim() !== '' && value.code.trim() !== starter.trim() && value.code !== (lastSubmitted ?? '');
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (bypass.current || !dirtyRef.current) return;
      e.preventDefault();
      // flush the draft right now
      writeJson(key, { language: value.language, buffers: { ...buffers.current, [value.language]: value.code }, lastSubmitted } satisfies Draft);
      Alert.alert('Code not submitted', 'Your code is saved as a draft on this device, but it has not been submitted for checking. Leave anyway?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { bypass.current = true; navigation.dispatch(e.data.action); } },
      ]);
    });
    return unsub;
  }, [navigation, key, value, lastSubmitted]);

  const runner: CodingRunner = useMemo(() => ({
    run: (language, code, stdin) => runPracticeCode(problem.id, { language, code, stdin: stdin ? stdin : undefined }),
    submit: (language, code) => submitPracticeCode(problem.id, { language, code }),
  }), [problem.id]);

  const onSubmitted = (code: string, sub: CodeSubmission | null) => {
    setLastSubmitted(code);
    writeJson(key, { language: value.language, buffers: { ...buffers.current, [value.language]: code }, lastSubmitted: code } satisfies Draft);
    if (sub && sub.status === 'judged' && sub.total > 0 && sub.passed === sub.total) setSolved(true);
  };

  if (!ready) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}><Skeleton height={48} /><Skeleton height={200} /></View>;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, gap: sp.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="none">
      <OfflineBanner />
      <View style={{ gap: sp.sm }}>
        <Text variant="title">{problem.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          <Badge label={problem.difficulty ? problem.difficulty[0].toUpperCase() + problem.difficulty.slice(1) : 'Unrated'} tone={DIFF_TONE[problem.difficulty] ?? 'neutral'} icon={false} />
          {solved ? <Badge label="Solved" tone="success" icon="check-circle" /> : null}
        </View>
        {problem.topic || problem.tags?.length ? <Text variant="caption" color={colors.muted}>{[problem.topic, ...(problem.tags ?? [])].filter(Boolean).join('  |  ')}</Text> : null}
      </View>
      <Banner tone="info" icon="save" message="Your code is kept as a draft on this device while you work. Practice is not graded and has no rank." />
      <CodingPanel
        problem={{ body: problem.body, constraints: problem.constraints, languages: problem.languages, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, starterCode: problem.starterCode, samples: problem.samples, hiddenCount: problem.hiddenCount }}
        value={value}
        onChange={onChange}
        runner={runner}
        lastSubmittedCode={lastSubmitted}
        onSubmitted={onSubmitted}
      />
    </ScrollView>
  );
}

function Body({ id }: { id: string }) {
  const router = useRouter();
  const q = usePracticeProblem(id);
  if (q.isLoading) return <View style={{ padding: SCREEN_PADDING, gap: sp.md }}><Skeleton height={48} /><Skeleton height={160} /><Skeleton height={100} /></View>;
  if (q.isError || !q.data) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return (
      <View style={{ padding: SCREEN_PADDING }}>
        {nf ? <EmptyState icon="code-off" title="Problem not found" message="It may have been removed." actionLabel="Back to practice" onAction={() => router.replace('/(student)/tests/practice' as never)} /> : <ErrorState title="Could not load this problem" message={netMessage(q.error)} onRetry={() => void q.refetch()} />}
      </View>
    );
  }
  return <Editor problem={q.data} />;
}

export default function PracticeProblemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  return (
    <Screen padded={false} edges={['bottom']} keyboard>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="Practice problem" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/tests/practice' as never))} />
      <View style={{ flex: 1 }}>
        <TestsGate needCode>
          <Body id={String(id)} />
        </TestsGate>
      </View>
    </Screen>
  );
}
