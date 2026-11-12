import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Keyboard, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { Banner, Button, ErrorState, Icon, OfflineBanner, Screen, Skeleton, TestTimerBar, Text, Chip } from '@/ui';
import { colors, SCREEN_PADDING } from '@/theme';
import { ApiError } from '@/api/client';
import { runAttemptCode, submitAttemptCode, tk, useTestsFeatures } from '@/api/tests';
import type { AnswerValue } from '@/api/testsTypes';
import { useAttemptSession } from '@/features/tests/useAttemptSession';
import { QuestionView } from '@/features/tests/QuestionView';
import { NavButton, PaletteSheet, SaveIndicator, SubmitSheet } from '@/features/tests/RunnerParts';
import type { CodingRunner } from '@/features/tests/CodingPanel';
import { fmtClock, netMessage, plural, sp } from '@/features/tests/kit';

export default function AttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const id = String(attemptId ?? '');
  const router = useRouter();
  const focused = useIsFocused();
  // Never gate the runner itself on config: an attempt in progress must stay usable. Only an explicit "off" disables Run/Submit code.
  const feats = useTestsFeatures();
  const execDisabled = !feats.loading && !feats.failed && !feats.codeExecution;

  const qc = useQueryClient();
  const s = useAttemptSession(id);
  const { flush } = s;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

  /* The soft keyboard takes most of a 360dp-wide phone: while it is up (code editor, numeric and text answers) the footer hides. */
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  /* result navigation once the attempt is final; the lists must not keep showing "In progress" */
  useEffect(() => {
    if (!s.finished) return;
    void qc.invalidateQueries({ queryKey: tk.all });
    router.replace(`/(student)/tests/result/${id}` as never);
  }, [s.finished, id, router, qc]);

  /* Android back: confirm instead of silently leaving */
  const leave = useCallback(async () => {
    await flush();
    if (router.canGoBack()) router.back();
    else router.replace('/(student)/tests' as never);
  }, [flush, router]);
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Leave the test screen?',
        'Your timer keeps running and your answers are saved. You can come back from My tests until time runs out.',
        [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', onPress: () => void leave() }],
      );
      return true;
    });
    return () => sub.remove();
  }, [focused, leave]);

  const runner: CodingRunner | undefined = useMemo(() => {
    const q = s.curQuestion;
    if (!q) return undefined;
    return {
      run: (language, code, stdin) => runAttemptCode(id, { questionId: q.id, language, code, stdin: stdin ? stdin : undefined }),
      submit: (language, code) => submitAttemptCode(id, q.id, { language, code }),
    };
  }, [id, s.curQuestion]);

  if (s.phase === 'loading') {
    return (
      <Screen padded>
        <View style={{ gap: sp.md }}>
          <Skeleton height={56} />
          <Skeleton height={28} width="60%" />
          <Skeleton height={140} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }
  if (s.phase === 'error' || !s.meta || !s.assessment) {
    const gone = s.loadError instanceof ApiError && s.loadError.status === 404;
    return (
      <Screen padded>
        <ErrorState
          title={gone ? 'Attempt not found' : 'Could not open the test'}
          message={gone ? 'This attempt does not exist or is not yours.' : netMessage(s.loadError, 'Check your connection and try again. Your timer is still running on the server.')}
          onRetry={gone ? () => router.replace('/(student)/tests' as never) : s.reload}
        />
        {/* the runner has no header and no swipe-back, so a failed load needs its own way out */}
        <Button label="Back to my tests" variant="ghost" full onPress={() => router.replace('/(student)/tests' as never)} />
      </Screen>
    );
  }

  const q = s.curQuestion;
  const sec = s.curSection;
  const meta = s.meta;
  const readOnly = s.locked || s.submitting || (q ? s.sectionClosed(q.sectionId) : false);
  const sectionMs = sec?.deadlineAt ? Math.max(0, Date.parse(sec.deadlineAt) - s.serverNow) : null;
  const lastInSection = !!q && !!sec && s.questions.filter((x) => x.sectionId === sec.id).slice(-1)[0]?.id === q.id;
  const canEnterNext = s.isSequential && !!s.nextUnopened && lastInSection;
  const hasNext = s.curIndex >= 0 && s.curIndex < s.navigable.length - 1;
  const proctor = s.assessment.proctoring ?? ({ enabled: false } as typeof s.assessment.proctoring);
  const showSections = s.sections.length > 1;

  const confirmEnterNext = () => {
    Alert.alert(
      `Open "${s.nextUnopened?.title}"?`,
      'You will not be able to return to earlier sections once the next one is open.',
      [{ text: 'Not yet', style: 'cancel' }, { text: 'Open next section', onPress: () => void s.enterNext() }],
    );
  };

  const answerFor = q ? s.answers[q.id] : undefined;
  const totalQuestions = s.summary.total || s.questions.length; // counts questions of sections not opened yet too
  const position = q ? `Question ${q.number} of ${totalQuestions || '-'}` : '';

  const footer = (
    <View style={{ gap: sp.xs }}>
      <View style={{ flexDirection: 'row', gap: sp.xs }}>
        <NavButton icon="chevron-left" label="Previous" onPress={s.goPrev} disabled={s.curIndex <= 0} />
        <NavButton icon={answerFor?.flagged ? 'flag' : 'outlined-flag'} label={answerFor?.flagged ? 'Marked' : 'Mark'} active={!!answerFor?.flagged} a11y={answerFor?.flagged ? 'Remove review mark' : 'Mark for review'} onPress={() => q && s.toggleFlag(q.id)} disabled={!q || readOnly} />
        <NavButton icon="grid-view" label="Questions" onPress={() => setPaletteOpen(true)} />
        {canEnterNext ? (
          <NavButton icon="skip-next" label="Next section" onPress={confirmEnterNext} disabled={s.entering || s.timeUp} />
        ) : (
          <NavButton icon="chevron-right" label="Next" onPress={s.goNext} disabled={!hasNext} />
        )}
      </View>
    </View>
  );

  return (
    <Screen scroll={false} padded={false} footer={kbOpen ? undefined : footer} edges={['top', 'bottom']} keyboard>
      {focused ? <StatusBar style="dark" /> : null}
      <TestTimerBar remainingMs={s.remainingMs} totalMs={s.totalMs} />
      <View style={{ paddingHorizontal: SCREEN_PADDING, paddingVertical: sp.sm, flexDirection: 'row', alignItems: 'center', gap: sp.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <SaveIndicator status={s.saveStatus} pending={s.pendingCount} note={s.saveNote} />
        <Button label="Submit" size="sm" variant="secondary" icon="send" onPress={() => setSubmitOpen(true)} disabled={s.timeUp} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SCREEN_PADDING, paddingBottom: sp.xxxl, gap: sp.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={q?.type === 'coding' ? 'none' : 'on-drag'}>
        <OfflineBanner />
        {s.timeUp ? (
          <Banner
            tone="warning"
            title="Time is up"
            message={s.submitError ? `Submitting your answers failed: ${s.submitError} Retrying automatically.` : 'Submitting your answers now...'}
            icon="timer-off"
          />
        ) : null}
        {s.saveNote ? <Banner tone="warning" message={s.saveNote} /> : null}

        {proctor.enabled ? (
          s.warnings > 0 || s.leftCount > 0 ? (
            <Banner
              tone="warning"
              icon="visibility"
              title={s.warnings > 0 ? `Warning ${s.warnings}${s.maxWarnings ? ` of ${s.maxWarnings}` : ''}` : 'You left the test screen'}
              message={`Leaving the test screen is recorded for the placement cell. You left ${plural(s.leftCount, 'time')} in this session.${proctor.autoSubmit && s.maxWarnings ? ` The test is submitted automatically at ${s.maxWarnings} warnings.` : ''}`}
            />
          ) : (
            <Banner tone="info" icon="visibility" message="Proctoring is on: switching apps or leaving this screen is recorded. Nothing else on your phone is monitored." />
          )
        ) : null}

        {showSections ? (
          <View style={{ gap: sp.sm }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
              {s.sections.map((x) => {
                const closed = s.isSequential && x.locked;
                const unopened = s.isSequential && !x.enteredAt;
                const selected = sec?.id === x.id;
                return (
                  <Chip
                    key={x.id}
                    label={x.title}
                    icon={closed ? 'lock' : unopened ? 'lock-clock' : undefined}
                    selected={selected}
                    onPress={closed || unopened ? undefined : () => s.goSection(x.id)}
                  />
                );
              })}
            </ScrollView>
            {sectionMs !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="hourglass-bottom" size={20} color={sectionMs < 300000 ? colors.coralText : colors.muted} />
                <Text variant="caption" tabular color={sectionMs < 300000 ? colors.coralText : colors.muted} style={{ fontWeight: '600' }}>
                  {sectionMs > 0 ? `Section time left ${fmtClock(sectionMs)}` : 'Section time is over'}
                </Text>
              </View>
            ) : null}
            {s.isSequential ? (
              <Text variant="caption" color={colors.muted}>Sections open one after another. Once you move on you cannot go back.</Text>
            ) : null}
          </View>
        ) : null}
        {s.sectionError ? <Banner tone="error" message={s.sectionError} /> : null}
        {readOnly && !s.timeUp && q && s.sectionClosed(q.sectionId) ? (
          <Banner tone="info" icon="lock" message="This section is closed. Your answers are final." />
        ) : null}
        {s.isSequential && sec && sectionMs === 0 && !s.nextUnopened ? (
          <Banner tone="info" message="Time for the last section is over. Submit your test." action={{ label: 'Submit', onPress: () => setSubmitOpen(true) }} />
        ) : null}

        {q ? (
          <QuestionView
            key={q.id}
            q={q}
            position={position}
            value={answerFor?.answer as AnswerValue | undefined}
            onChange={(v) => s.setAnswer(q.id, v)}
            readOnly={readOnly}
            negativeMarking={s.assessment.negativeMarking}
            runner={runner}
            execDisabled={execDisabled}
            codeSummary={s.codeInfo[q.id]}
            lastSubmittedCode={s.submittedCode[q.id]}
            beforeSend={async () => { await s.flush(); }}
            onCodeSubmitted={(code, sub) => s.noteCodeSubmitted(q.id, code, sub)}
          />
        ) : (
          <Banner tone="info" message="No questions are open yet." />
        )}
        <Text variant="caption" color={colors.muted}>{`Attempt ${meta.attemptNo}. The countdown follows the server clock, not your phone clock.`}</Text>
      </ScrollView>

      <PaletteSheet visible={paletteOpen} onClose={() => setPaletteOpen(false)} s={s} onPick={s.goTo} />
      <SubmitSheet visible={submitOpen} onClose={() => setSubmitOpen(false)} s={s} onConfirm={() => void s.submit()} />
    </Screen>
  );
}
