/**
 * Coding question UI shared by tests (attempt) and practice problems.
 * Tabs: Problem | Code. Code tab: language, plain editor, Run (samples or custom input), Submit code, results.
 * Hidden test cases are masked: only counts are ever shown.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, CodeBlock, Icon, Select, SegmentedTabs, Text, TextField, useIsOnline } from '@/ui';
import { colors } from '@/theme';
import { isCodeUnavailable, pendingSubmissionOf } from '@/api/tests';
import type { CodeAnswer, CodeSubmission, RunResponse, RunResultItem, SampleCase, SubmitCodeResponse } from '@/api/testsTypes';
import { CodeEditor } from './CodeEditor';
import { fmtMarks, MarkdownLite, netMessage, sp, VERDICT_LABEL, VerdictBadge } from './kit';

export interface CodingProblem {
  body: string;
  constraints?: string;
  languages: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode?: Record<string, string>;
  samples: SampleCase[];
  hiddenCount?: number;
}
export interface CodingRunner {
  run(language: string, code: string, stdin?: string): Promise<RunResponse>;
  submit(language: string, code: string): Promise<SubmitCodeResponse>;
}

export const LANGUAGE_LABEL: Record<string, string> = { python3: 'Python 3', java: 'Java', cpp: 'C++', c: 'C', javascript: 'JavaScript' };
export const langLabel = (l: string) => LANGUAGE_LABEL[l] ?? l;

/** Program output is untrusted and can be huge or missing: cap what is rendered and never throw on null. */
const clip = (s: string | null | undefined, n = 4000) => {
  const t = typeof s === 'string' ? s : '';
  return t.length > n ? `${t.slice(0, n)}\n... (output truncated, ${t.length - n} more characters)` : t;
};

interface Props {
  problem: CodingProblem;
  value: CodeAnswer;
  onChange: (v: CodeAnswer) => void;
  runner: CodingRunner;
  readOnly?: boolean;
  /** server says code execution is off: Run/Submit are disabled, code is still saved */
  execDisabled?: boolean;
  best?: { passed: number; total: number; verdict: string } | null;
  judgePending?: boolean;
  /** called after a code submission is stored (judged or queued) with the code that was sent */
  onSubmitted?: (code: string, sub: CodeSubmission | null) => void;
  /** flush pending autosave before run/submit so the server and the editor agree */
  beforeSend?: () => Promise<void> | void;
  /** code last sent to the judge (to show "edited since last submission") */
  lastSubmittedCode?: string;
}

export function starterFor(p: Pick<CodingProblem, 'starterCode'>, lang: string): string {
  return p.starterCode?.[lang] ?? '';
}

export function CodingPanel({ problem, value, onChange, runner, readOnly, execDisabled, best, judgePending, onSubmitted, beforeSend, lastSubmittedCode }: Props) {
  const online = useIsOnline();
  const [tab, setTab] = useState<'problem' | 'code'>('problem');
  const buffers = useRef<Record<string, string>>({});
  buffers.current[value.language] = value.code;

  const [busy, setBusy] = useState<null | 'run' | 'submit'>(null);
  const busyRef = useRef(false); // state lags one render behind: a double tap must not start two judge calls
  const [useStdin, setUseStdin] = useState(false);
  const [stdin, setStdin] = useState('');
  const [runOut, setRunOut] = useState<RunResponse['run'] | null>(null);
  const [subOut, setSubOut] = useState<CodeSubmission | null>(null);
  const [queued, setQueued] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bestLocal, setBestLocal] = useState<{ passed: number; total: number; verdict: string } | null>(best ?? null);
  useEffect(() => { if (best) setBestLocal(best); }, [best]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const langOptions = useMemo(() => problem.languages.map((l) => ({ value: l, label: langLabel(l) })), [problem.languages]);
  const starter = starterFor(problem, value.language);
  const empty = value.code.trim() === '';
  const edited = !empty && value.code !== (lastSubmittedCode ?? '') && value.code.trim() !== starter.trim();

  const switchLang = (l: string) => {
    if (l === value.language) return;
    buffers.current[value.language] = value.code;
    const next = buffers.current[l] ?? starterFor(problem, l);
    onChange({ language: l, code: next });
    setRunOut(null);
    setSubOut(null);
  };

  const reset = () => {
    onChange({ language: value.language, code: starter });
  };

  const clearNotices = () => { setError(null); setQueued(false); setQueuedId(null); setUnavailable(false); };

  const doRun = async () => {
    if (busyRef.current || busy || empty) return;
    busyRef.current = true;
    clearNotices();
    setBusy('run');
    try {
      await beforeSend?.();
      const r = await runner.run(value.language, value.code, useStdin ? stdin : undefined);
      if (alive.current) { setRunOut(r.run); setSubOut(null); }
    } catch (e) {
      if (!alive.current) return;
      if (isCodeUnavailable(e)) setUnavailable(true);
      else setError(netMessage(e, 'Could not run your code.'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const doSubmit = async () => {
    if (busyRef.current || busy || empty) return;
    busyRef.current = true;
    clearNotices();
    setBusy('submit');
    const sent = value.code;
    try {
      await beforeSend?.();
      const r = await runner.submit(value.language, sent);
      if (!alive.current) return;
      setSubOut(r.submission);
      setRunOut(null);
      if (r.submission.status === 'pending_judge') setQueued(true);
      else setBestLocal(r.submission.best);
      onSubmitted?.(sent, r.submission);
    } catch (e) {
      if (!alive.current) return;
      if (isCodeUnavailable(e)) {
        // The server stored the submission as pending_judge; a worker evaluates it later.
        setQueued(true);
        setQueuedId(pendingSubmissionOf(e)?.id ?? null);
        onSubmitted?.(sent, null);
      } else setError(netMessage(e, 'Could not submit your code.'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const disabledReason = execDisabled
    ? 'Running code is switched off right now. Your code is still saved.'
    : !online
      ? 'You are offline. Running and submitting code needs a connection. Your edits stay on this device.'
      : null;

  return (
    <View style={{ gap: sp.md }}>
      <SegmentedTabs
        value={tab}
        onChange={(v) => setTab(v as 'problem' | 'code')}
        options={[{ value: 'problem', label: 'Problem' }, { value: 'code', label: 'Code' }]}
      />

      {tab === 'problem' ? (
        <View style={{ gap: sp.lg }}>
          <MarkdownLite text={problem.body} />
          {problem.constraints ? (
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">Constraints</Text>
              <MarkdownLite text={problem.constraints} />
            </View>
          ) : null}
          <Card tinted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: sp.xl, rowGap: sp.xs }}>
              <Text variant="caption" tabular>{`Time limit: ${problem.timeLimitMs} ms`}</Text>
              <Text variant="caption" tabular>{`Memory: ${problem.memoryLimitMb} MB`}</Text>
              <Text variant="caption">{`Languages: ${problem.languages.map(langLabel).join(', ')}`}</Text>
            </View>
          </Card>
          <View style={{ gap: sp.md }}>
            <Text variant="subhead">{problem.samples.length === 1 ? 'Sample test case' : 'Sample test cases'}</Text>
            {problem.samples.length === 0 ? (
              <Text variant="body" color={colors.muted}>No samples are shown for this problem.</Text>
            ) : (
              problem.samples.map((s, i) => (
                <Card key={s.id}>
                  <View style={{ gap: sp.sm }}>
                    <Text variant="caption" style={{ fontWeight: '700' }}>{`Sample ${i + 1}`}</Text>
                    <CodeBlock label="Input" code={s.input === '' ? '(empty)' : s.input} />
                    <CodeBlock label="Expected output" code={s.expectedOutput === '' ? '(empty)' : s.expectedOutput} />
                    {s.explanation ? <Text variant="caption" color={colors.muted}>{s.explanation}</Text> : null}
                  </View>
                </Card>
              ))
            )}
            {problem.hiddenCount ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Icon name="lock-outline" size={20} color={colors.muted} />
                <Text variant="caption" color={colors.muted} style={{ flex: 1, minWidth: 0 }}>
                  {`${problem.hiddenCount} hidden test ${problem.hiddenCount === 1 ? 'case' : 'cases'} are used when you submit. Their inputs and outputs are not shown.`}
                </Text>
              </View>
            ) : null}
          </View>
          <Button label="Open the editor" icon="code" variant="secondary" full onPress={() => setTab('code')} />
        </View>
      ) : (
        <View style={{ gap: sp.lg }}>
          {readOnly || busy !== null ? (
            <Text variant="caption" color={colors.muted}>{`Language: ${langLabel(value.language)}`}</Text>
          ) : (
            <Select label="Language" value={value.language} onChange={switchLang} options={langOptions} />
          )}
          <CodeEditor value={value.code} onChange={(t) => onChange({ language: value.language, code: t })} readOnly={readOnly} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignItems: 'center' }}>
            {!readOnly && starter && value.code !== starter ? (
              <Button label="Reset to starter" variant="ghost" size="sm" icon="restart-alt" onPress={reset} />
            ) : null}
            <Button
              label={useStdin ? 'Use sample cases' : 'Use custom input'}
              variant="ghost"
              size="sm"
              icon={useStdin ? 'list-alt' : 'edit-note'}
              onPress={() => setUseStdin((v) => !v)}
            />
          </View>
          {useStdin ? (
            <TextField label="Custom input (stdin)" value={stdin} onChangeText={setStdin} multiline maxLength={10000} helper="Runs your code on this input only. No pass or fail is shown." />
          ) : null}

          {judgePending ? (
            <Banner tone="info" title="Evaluation pending" message="An earlier submission is queued and will be evaluated automatically." />
          ) : null}
          {disabledReason ? <Banner tone="warning" message={disabledReason} icon={execDisabled ? 'block' : 'cloud-off'} /> : null}
          {unavailable ? (
            <Banner tone="warning" title="Code runner unavailable" message="Runs are not available right now. Your code is saved. Try again in a minute, or submit it for evaluation later." />
          ) : null}
          {queued ? (
            <Banner tone="info" title="Queued, will be evaluated" message={`The code runner is busy. Your code was stored and will be evaluated automatically. You can keep working; the score updates once it is judged.${queuedId ? ` Reference: ${queuedId.slice(-8)}.` : ''}`} />
          ) : null}
          {error ? <Banner tone="error" message={error} /> : null}

          {bestLocal ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="emoji-events" size={20} color={colors.primary} />
              <Text variant="caption" tabular style={{ flex: 1, minWidth: 0 }}>
                {`Best so far: ${bestLocal.passed} of ${bestLocal.total} tests passed (${VERDICT_LABEL[bestLocal.verdict] ?? bestLocal.verdict})`}
              </Text>
            </View>
          ) : null}
          {edited ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="edit" size={20} color={colors.warning} />
              <Text variant="caption" color={colors.warning} style={{ flex: 1, minWidth: 0 }}>{lastSubmittedCode ? 'Edited since your last submission.' : 'Not submitted for evaluation yet.'}</Text>
            </View>
          ) : null}

          {!readOnly ? (
            <View style={{ gap: sp.sm }}>
              <Button
                label="Run"
                icon="play-arrow"
                variant="secondary"
                full
                loading={busy === 'run'}
                disabled={busy !== null || empty || !!execDisabled || !online}
                onPress={doRun}
              />
              <Button
                label="Submit code"
                icon="publish"
                full
                loading={busy === 'submit'}
                disabled={busy !== null || empty || !!execDisabled || !online}
                onPress={doSubmit}
              />
              <Text variant="caption" color={colors.muted}>
                Run tries your code on the samples. Submit code checks every test case, including hidden ones, and keeps your best result.
              </Text>
            </View>
          ) : null}

          {busy ? (
            <Text variant="body" color={colors.muted} accessibilityLiveRegion="polite">
              {busy === 'run' ? 'Running your code...' : 'Judging your code against all test cases...'}
            </Text>
          ) : null}

          {runOut ? <RunPanel run={runOut} /> : null}
          {subOut ? <SubmissionPanel sub={subOut} /> : null}
        </View>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- results */
const mb = (kb: number | null | undefined) => (typeof kb === 'number' && Number.isFinite(kb) ? `${(kb / 1024).toFixed(1)} MB` : '- MB');

function CaseResult({ r, label, custom }: { r: RunResultItem; label: string; custom: boolean }) {
  const ok = r.passed === true || (!custom && r.verdict === 'accepted');
  const showDetail = custom || !ok;
  return (
    <Card>
      <View style={{ gap: sp.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.sm, flexWrap: 'wrap' }}>
          <Text variant="subhead">{label}</Text>
          {custom ? null : <VerdictBadge verdict={ok ? 'accepted' : String(r.verdict)} />}
        </View>
        <Text variant="caption" tabular color={colors.muted}>{`${r.timeMs} ms, ${mb(r.memoryKb)}${custom && r.verdict !== 'accepted' ? `, ${VERDICT_LABEL[r.verdict] ?? r.verdict}` : ''}`}</Text>
        {showDetail && r.input !== undefined ? <CodeBlock label="Input" code={r.input === '' ? '(empty)' : clip(r.input)} /> : null}
        {showDetail && r.expectedOutput !== undefined ? <CodeBlock label="Expected output" code={r.expectedOutput === '' ? '(empty)' : clip(r.expectedOutput)} /> : null}
        {(showDetail || r.stdout) ? <CodeBlock label="Your output (stdout)" code={!r.stdout ? '(empty)' : clip(r.stdout)} /> : null}
        {r.stderr ? <CodeBlock label="Errors (stderr)" code={clip(r.stderr)} /> : null}
      </View>
    </Card>
  );
}

function RunPanel({ run }: { run: RunResponse['run'] }) {
  const custom = run.mode === 'custom';
  const passed = (run.results ?? []).filter((r) => r.passed === true).length;
  return (
    <View style={{ gap: sp.md }} accessibilityLiveRegion="polite">
      <Text variant="heading">{custom ? 'Output for your input' : 'Sample run'}</Text>
      {!run.compile.ok ? (
        <View style={{ gap: sp.sm }}>
          <Banner tone="error" title="Compile error" message="Your code did not compile. Fix the errors below and run again." />
          <CodeBlock code={clip(run.compile.output || 'No compiler output.')} />
        </View>
      ) : (
        <>
          {!custom ? (
            <Banner
              tone={passed === run.results.length && run.results.length > 0 ? 'success' : 'warning'}
              message={`${passed} of ${run.results.length} sample ${run.results.length === 1 ? 'case' : 'cases'} passed.`}
              icon={passed === run.results.length && run.results.length > 0 ? 'check-circle' : 'error-outline'}
            />
          ) : null}
          {run.results.map((r, i) => (
            <CaseResult key={r.id ?? i} r={r} custom={custom} label={custom ? 'Custom input' : `Sample ${i + 1}`} />
          ))}
        </>
      )}
    </View>
  );
}

function SubmissionPanel({ sub }: { sub: CodeSubmission }) {
  if (sub.status === 'pending_judge') return null;
  const hiddenFail = Math.max(0, sub.hiddenTotal - sub.hiddenPassed);
  return (
    <View style={{ gap: sp.md }} accessibilityLiveRegion="polite">
      <Text variant="heading">Submission result</Text>
      <Card tinted>
        <View style={{ gap: sp.sm }}>
          <VerdictBadge verdict={String(sub.verdict)} />
          <Text variant="subhead" tabular>{`${sub.passed} of ${sub.total} test cases passed`}</Text>
          <Text variant="body" tabular>{`Score ${fmtMarks(sub.score)} of ${fmtMarks(sub.maxScore)}`}</Text>
          {sub.improved ? <Text variant="caption" color={colors.success} style={{ fontWeight: '600' }}>New best result. This one is kept for grading.</Text> : (
            <Text variant="caption" color={colors.muted}>{`Best kept for grading: ${sub.best.passed} of ${sub.best.total} tests.`}</Text>
          )}
        </View>
      </Card>
      {sub.compileOutput ? <CodeBlock label="Compiler output" code={clip(sub.compileOutput)} /> : null}
      {sub.samples.map((s, i) => {
        const ok = s.verdict === 'accepted';
        return (
          <Card key={s.id}>
            <View style={{ gap: sp.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.sm, flexWrap: 'wrap' }}>
                <Text variant="subhead">{`Sample ${i + 1}`}</Text>
                <VerdictBadge verdict={String(s.verdict)} />
              </View>
              <Text variant="caption" tabular color={colors.muted}>{`${s.timeMs} ms`}</Text>
              {!ok ? (
                <>
                  <CodeBlock label="Input" code={s.input === '' ? '(empty)' : clip(s.input)} />
                  <CodeBlock label="Expected output" code={s.expectedOutput === '' ? '(empty)' : clip(s.expectedOutput)} />
                  <CodeBlock label="Your output" code={s.stdout === '' ? '(empty)' : clip(s.stdout)} />
                </>
              ) : null}
            </View>
          </Card>
        );
      })}
      {sub.hiddenTotal > 0 ? (
        <Card>
          <View style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="lock-outline" size={20} color={colors.muted} />
              <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>Hidden test cases</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="check-circle" size={20} color={colors.success} />
              <Text variant="body" tabular style={{ flex: 1, minWidth: 0 }}>{`${sub.hiddenPassed} passed`}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name={hiddenFail > 0 ? 'cancel' : 'check-circle'} size={20} color={hiddenFail > 0 ? colors.error : colors.success} />
              <Text variant="body" tabular style={{ flex: 1, minWidth: 0 }}>{`${hiddenFail} failed`}</Text>
            </View>
            <Text variant="caption" color={colors.muted}>Inputs and outputs of hidden tests are never shown.</Text>
          </View>
        </Card>
      ) : null}
    </View>
  );
}
