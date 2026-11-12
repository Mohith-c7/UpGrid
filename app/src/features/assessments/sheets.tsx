import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Banner, Button, Icon, Sheet, SegmentedControl, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { ApiError, errMessage } from '@/api/client';
import { useAssessmentPreview, useFixKey, useRegrade, type Assessment, type PreviewQuestion } from '@/api/assessments';
import { NumberField, ToggleRow, parseNum, errorLines, ErrorList, TYPE_LABEL } from './kit';

/* ---------------- regrade ---------------- */
export function RegradeSheet({ assessmentId, visible, onClose, defaultReason, hasCoding, onDone }: {
  assessmentId: string; visible: boolean; onClose: () => void; defaultReason?: string; hasCoding?: boolean; onDone?: (r: { regraded: number; changed: number; rejudgeQueued: number }) => void;
}) {
  const toast = useToast();
  const regrade = useRegrade();
  const [reason, setReason] = useState(''); const [rejudge, setRejudge] = useState(false);
  const [confirm, setConfirm] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ regraded: number; changed: number; rejudgeQueued: number } | null>(null);
  useEffect(() => { if (visible) { setReason(defaultReason ?? ''); setRejudge(false); setConfirm(false); setErr(null); setResult(null); } }, [visible, defaultReason]);
  const rErr = reason.trim().length < 3 ? 'Enter a reason (at least 3 characters).' : reason.trim().length > 300 ? 'Keep the reason within 300 characters.' : null;
  const run = async () => {
    setErr(null);
    try {
      const res = await regrade.mutateAsync({ id: assessmentId, reason: reason.trim(), rejudge: hasCoding ? rejudge : undefined });
      setResult(res); setConfirm(false); onDone?.(res);
    } catch (e) { setErr(errMessage(e)); setConfirm(false); }
  };
  return (
    <Sheet visible={visible} onClose={() => { if (!regrade.isPending) onClose(); }} title="Regrade this test">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {result ? (
          <>
            <Banner tone="success" title="Regrade complete" message={`${result.regraded} attempt${result.regraded === 1 ? '' : 's'} recomputed, ${result.changed} score${result.changed === 1 ? '' : 's'} changed.${result.rejudgeQueued ? ` ${result.rejudgeQueued} coding submissions queued for re-judging; scores update when judging finishes.` : ''}`} />
            <Button label="Done" full onPress={onClose} />
          </>
        ) : confirm ? (
          <>
            <Banner tone="warning" title="Recompute all scores?" message="Every submitted attempt is graded again from the stored answers using the current answer key. Manual score overrides are kept. This is recorded in the audit log." />
            {err ? <Banner tone="error" message={err} /> : null}
            <Button label="Regrade now" full loading={regrade.isPending} onPress={run} />
            <Button label="Back" variant="secondary" full onPress={() => setConfirm(false)} />
          </>
        ) : (
          <>
            <Text variant="body">Use this after correcting an answer key. Scores of every submitted attempt are recomputed from the stored answers.</Text>
            {err ? <Banner tone="error" message={err} /> : null}
            <TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="For example Question 7 key corrected from B to C" error={reason ? rErr : null} />
            {hasCoding ? <ToggleRow label="Re-run coding judging" hint="Sends every coding submission back to the judge. Results show as pending until it finishes." value={rejudge} onChange={setRejudge} /> : null}
            <Button label="Review and regrade" full disabled={!!rErr} onPress={() => setConfirm(true)} />
          </>
        )}
      </View>
    </Sheet>
  );
}

/* ---------------- answer key fix ---------------- */
export function KeyFixSheet({ a, aqId, onClose, onSaved }: { a: Assessment; aqId: string | null; onClose: () => void; onSaved: (reason: string) => void }) {
  const toast = useToast();
  const fix = useFixKey();
  const prev = useAssessmentPreview(aqId ? a.id : undefined, 0);
  const q: PreviewQuestion | undefined = prev.data?.questions.find((x) => x.id === aqId);
  const [reason, setReason] = useState(''); const [single, setSingle] = useState<string | null>(null); const [multi, setMulti] = useState<string[]>([]);
  const [numV, setNumV] = useState(''); const [numT, setNumT] = useState('0'); const [acc, setAcc] = useState(''); const [mode, setMode] = useState<'exact' | 'regex'>('exact'); const [cs, setCs] = useState(false);
  const [marks, setMarks] = useState(''); const [neg, setNeg] = useState(''); const [expl, setExpl] = useState('');
  const [changeKey, setChangeKey] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => { if (aqId) { setReason(''); setSingle(null); setMulti([]); setNumV(''); setNumT('0'); setAcc(''); setMode('exact'); setCs(false); setExpl(''); setLines([]); setChangeKey(true); } }, [aqId]);
  useEffect(() => { if (q) { setMarks(String(q.marks)); setNeg(String(q.negativeMarks ?? 0)); } }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rErr = reason.trim().length < 3 ? 'Enter a reason (3 to 300 characters).' : null;
  const buildAnswer = (): { ok: boolean; answer?: unknown; msg?: string } => {
    if (!q || !changeKey || q.type === 'coding') return { ok: true };
    if (q.type === 'mcq_single') return single ? { ok: true, answer: { correct: single } } : { ok: false, msg: 'Choose the correct option.' };
    if (q.type === 'mcq_multi') return multi.length ? { ok: true, answer: { correct: multi } } : { ok: false, msg: 'Choose at least one correct option.' };
    if (q.type === 'numeric') { const v = parseNum(numV); const t = numT.trim() === '' ? 0 : parseNum(numT); return v === null || t === null || t < 0 ? { ok: false, msg: 'Enter the value and a tolerance of 0 or more.' } : { ok: true, answer: { value: v, tolerance: t } }; }
    const accepted = acc.split('\n').map((s) => s.trim()).filter(Boolean);
    return accepted.length ? { ok: true, answer: { accepted, mode, caseSensitive: cs } } : { ok: false, msg: 'Enter at least one accepted answer.' };
  };
  const submit = async () => {
    setLines([]);
    const built = buildAnswer();
    if (!built.ok) { setLines([built.msg!]); return; }
    const m = parseNum(marks); const n = neg.trim() === '' ? 0 : parseNum(neg);
    if (m === null || m < 0 || n === null || n < 0 || n > m) { setLines(['Marks must be a number and negative marks cannot exceed marks.']); return; }
    try {
      const body: any = { reason: reason.trim() };
      if (built.answer !== undefined) body.answer = built.answer;
      if (q && (m !== q.marks || n !== (q.negativeMarks ?? 0))) { body.marks = m; body.negativeMarks = n; }
      if (expl.trim()) body.explanation = expl.trim();
      if (!body.answer && body.marks === undefined && !body.explanation) { setLines(['Nothing to change. Update the answer, marks or explanation.']); return; }
      const res = await fix.mutateAsync({ id: a.id, aqId: aqId!, body });
      toast.show(res.needsRegrade ? 'Key updated. Regrade to apply it to submitted attempts.' : 'Key updated', 'success');
      onSaved(reason.trim());
    } catch (e) { setLines(e instanceof ApiError && e.fields ? errorLines(e) : [errMessage(e)]); }
  };

  return (
    <Sheet visible={!!aqId} onClose={onClose} title="Fix answer key">
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {prev.isLoading ? <><Skeleton height={56} /><Skeleton height={120} radius={12} /></>
          : prev.isError ? <Banner tone="error" message={errMessage(prev.error)} action={{ label: 'Retry', onPress: () => { void prev.refetch(); } }} />
          : !q ? <Banner tone="warning" message="This question could not be found in the test." />
          : (
            <>
              <Text variant="subhead" numberOfLines={3}>{q.number}. {q.title}</Text>
              <Text variant="caption" color={colors.muted}>{TYPE_LABEL[q.type]}. Submitted attempts keep their old score until you regrade.</Text>
              <ErrorList title="Could not update" lines={lines} />
              <TextField label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} multiline maxLength={300} error={reason ? rErr : null} />
              {q.type !== 'coding' ? <ToggleRow label="Change the correct answer" value={changeKey} onChange={setChangeKey} /> : null}
              {changeKey && (q.type === 'mcq_single' || q.type === 'mcq_multi') ? (
                <View>
                  {(q.options ?? []).map((o) => {
                    const on = q.type === 'mcq_single' ? single === o.id : multi.includes(o.id);
                    return (
                      <Pressable key={o.id} onPress={() => (q.type === 'mcq_single' ? setSingle(o.id) : setMulti((m) => (m.includes(o.id) ? m.filter((x) => x !== o.id) : [...m, o.id])))}
                        accessibilityRole={q.type === 'mcq_single' ? 'radio' : 'checkbox'} accessibilityState={{ checked: on, selected: on }} accessibilityLabel={`Option ${o.id.toUpperCase()}: ${o.text}`}
                        style={{ minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 }}>
                        <Icon name={q.type === 'mcq_single' ? (on ? 'radio-button-checked' : 'radio-button-unchecked') : (on ? 'check-box' : 'check-box-outline-blank')} size={26} color={on ? colors.primary : colors.muted} />
                        <Text variant="body" style={{ flex: 1 }}><Text variant="body" style={{ fontWeight: '700' }}>{o.id.toUpperCase()}. </Text>{o.text}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {changeKey && q.type === 'numeric' ? (<><NumberField label="Correct value" value={numV} onChange={setNumV} /><NumberField label="Tolerance" value={numT} onChange={setNumT} /></>) : null}
              {changeKey && q.type === 'short_text' ? (
                <>
                  <TextField label="Accepted answers (one per line)" value={acc} onChangeText={setAcc} multiline autoCapitalize="none" />
                  <SegmentedControl value={mode} onChange={(v) => setMode(v as any)} options={[{ value: 'exact', label: 'Exact' }, { value: 'regex', label: 'Pattern' }]} />
                  <ToggleRow label="Case sensitive" value={cs} onChange={setCs} />
                </>
              ) : null}
              {q.type === 'coding' ? <Banner tone="info" message="Coding answers are judged by test cases, so there is no key to change. You can still adjust marks and re-run judging when you regrade." /> : null}
              <NumberField label="Marks" value={marks} onChange={setMarks} />
              <NumberField label="Negative marks" value={neg} onChange={setNeg} />
              <TextField label="Explanation (optional)" value={expl} onChangeText={setExpl} multiline />
              <Button label="Update key" full loading={fix.isPending} disabled={!!rErr} onPress={submit} />
            </>
          )}
      </View>
    </Sheet>
  );
}
