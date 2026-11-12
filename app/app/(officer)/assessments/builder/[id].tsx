import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Banner, Button, EmptyState, ErrorState, HeaderAction, Skeleton, StepIndicator, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError, errMessage, getServerOffsetMs } from '@/api/client';
import { fetchAudience, usePublishAssessment, useSaveAssessment, useAssessment, type AudiencePreview } from '@/api/assessments';
import { useDrivesOfficer } from '@/features/officer/data';
import { ConfirmSheet, Frame, ROOT } from '@/features/assessments/kit';
import { fromAssessment, localProblems, newForm, STEPS, stepForPath, toBody, type BuilderForm } from '@/features/assessments/builder/model';
import { StepAudience, StepDetails, StepQuestions, StepReview, StepRules, StepSchedule, type DriveOption } from '@/features/assessments/builder/steps';

export default function Builder() {
  const { id, driveId } = useLocalSearchParams<{ id: string; driveId?: string }>();
  const isNew = id === 'new';
  const r = useRouter();
  const toast = useToast();
  const existing = useAssessment(isNew ? undefined : id);
  const save = useSaveAssessment();
  const publish = usePublishAssessment();
  const drivesQ = useDrivesOfficer();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = drivesQ;
  useEffect(() => { if (hasNextPage && !isFetchingNextPage && !drivesQ.isError && (drivesQ.data?.pages.length ?? 0) < 5) void fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage, drivesQ.data, drivesQ.isError]);

  const [f, setF] = useState<BuilderForm>(() => newForm(driveId ?? null));
  const [loaded, setLoaded] = useState(isNew);
  const [step, setStep] = useState(0);
  const [assessmentId, setAssessmentId] = useState<string | null>(isNew ? null : id);
  const savedSig = useRef<string>('');
  const fRef = useRef<BuilderForm>(f);
  const inflight = useRef<Promise<string | null> | null>(null);
  const bypass = useRef(false);
  const nav = useNavigation<any>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverLines, setServerLines] = useState<{ step: number; text: string }[]>([]);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewSig, setPreviewSig] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      if (existing.data.status !== 'draft') return;
      const nf = fromAssessment(existing.data);
      setF(nf); setLoaded(true); savedSig.current = JSON.stringify(toBody(nf));
    }
  }, [existing.data, loaded]);

  const drives: DriveOption[] = useMemo(() => {
    const items = (drivesQ.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.status !== 'draft' || d.id === f.driveId);
    const opts = items.map((d) => ({ value: d.id, label: `${d.company.name || 'Company'} · ${d.role}` }));
    if (f.driveId && !opts.some((o) => o.value === f.driveId)) opts.unshift({ value: f.driveId, label: existing.data?.drive ? `${existing.data.drive.company} · ${existing.data.drive.role}` : 'Selected drive' });
    return opts;
  }, [drivesQ.data, f.driveId, existing.data]);

  const patch = useCallback((p: Partial<BuilderForm>) => { setF((cur) => ({ ...cur, ...p })); setErrors({}); }, []);
  const body = useMemo(() => toBody(f), [f]);
  const sig = useMemo(() => JSON.stringify(body), [body]);
  const dirty = sig !== savedSig.current;
  fRef.current = f;
  const guardRef = useRef(false);
  guardRef.current = dirty && !!(f.title.trim() || assessmentId);
  // hardware back / swipe back also ask before dropping unsaved work
  useEffect(() => nav.addListener('beforeRemove', (ev: any) => {
    if (bypass.current || !guardRef.current) return;
    ev.preventDefault(); setLeaveOpen(true);
  }), [nav]);
  const audSig = JSON.stringify({ a: body.audience, d: body.driveId, p: body.practice });
  const nowMs = Date.now() + getServerOffsetMs();
  const problems = useMemo(() => localProblems(f, nowMs), [f]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNew && existing.data && existing.data.status !== 'draft') {
    return (
      <Frame title="Edit test" onBack={() => r.replace(`${ROOT}/${id}` as any)}>
        <EmptyState icon="lock" title="This test is no longer a draft" message="Published tests can only change a few settings. Open the test to edit those, or clone it to start a new draft."
          actionLabel="Open test" onAction={() => r.replace(`${ROOT}/${id}` as any)} />
      </Frame>
    );
  }
  if (!isNew && (existing.isLoading || existing.isError || !loaded)) {
    return (
      <Frame title="Edit test">
        {existing.isError ? <ErrorState message={errMessage(existing.error)} onRetry={() => { void existing.refetch(); }} />
          : <><Skeleton height={32} /><Skeleton height={200} radius={14} /><Skeleton height={140} radius={14} /></>}
      </Frame>
    );
  }

  /** Create or update the draft. Returns the id, or null when the server rejected it. */
  const saveDraft = (quiet = false): Promise<string | null> => {
    // one save at a time: a double tap or Save + Next must not create two drafts
    if (inflight.current) return inflight.current;
    const p = doSave(quiet).finally(() => { inflight.current = null; });
    inflight.current = p;
    return p;
  };
  const doSave = async (quiet: boolean): Promise<string | null> => {
    if (!f.title.trim()) { setErrors({ title: 'Add a title before saving.' }); setStep(0); toast.show('Add a title first', 'error'); return null; }
    try {
      const a = await save.mutateAsync({ id: assessmentId ?? undefined, body });
      setAssessmentId(a.id);
      savedSig.current = sig;
      // adopt server-assigned section ids by position so later saves update instead of recreating
      if (a.sections?.length === f.sections.length) {
        const adopt = (cur: BuilderForm): BuilderForm => ({ ...cur, sections: cur.sections.map((s, i) => ({ ...s, id: a.sections[i]?.id ?? s.id, questions: s.questions.map((q, k) => ({ ...q, id: a.sections[i]?.questions?.[k]?.id ?? q.id })) })) });
        const cur = fRef.current;
        // when nothing changed during the save, the adopted form is also the saved baseline (no false "unsaved changes")
        if (JSON.stringify(toBody(cur)) === sig) savedSig.current = JSON.stringify(toBody(adopt(cur)));
        setF(adopt);
      }
      if (!quiet) toast.show('Draft saved', 'success');
      return a.id;
    } catch (e) {
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) {
        setErrors(e.fields);
        setServerLines(Object.entries(e.fields).map(([k, v]) => ({ step: stepForPath(k), text: `${k}: ${v}` })));
        setStep(5);
        toast.show('The server rejected some fields', 'error');
      } else toast.show(errMessage(e), 'error');
      return null;
    }
  };

  const next = async () => {
    if (step === 0) {
      if (!f.title.trim()) { setErrors({ title: 'Add a title to continue.' }); return; }
      const dur = Number(f.duration);
      if (!Number.isInteger(dur) || dur < 1 || dur > 600) { setErrors({ durationMinutes: 'Duration must be 1 to 600 minutes.' }); return; }
    }
    if (dirty || !assessmentId) { const sid = await saveDraft(true); if (!sid) return; }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const runPreviewAudience = async () => {
    setPreviewBusy(true); setPreviewErr(null);
    try {
      const sid = await saveDraft(true);
      if (!sid) { setPreviewErr('Save the draft first (add a title).'); return; }
      setPreview(await fetchAudience(sid)); setPreviewSig(audSig);
    } catch (e) { setPreviewErr(errMessage(e)); } finally { setPreviewBusy(false); }
  };

  const openPreview = async () => {
    const sid = await saveDraft(true);
    if (sid) r.push(`${ROOT}/${sid}/preview` as any);
  };

  const doPublish = async () => {
    setServerLines([]);
    const sid = await saveDraft(true);
    if (!sid) { setPublishOpen(false); return; }
    try {
      const res = await publish.mutateAsync(sid);
      setPublishOpen(false);
      toast.show(res.replayed ? 'Already published' : `Published to ${res.audienceCount} student${res.audienceCount === 1 ? '' : 's'}`, 'success');
      bypass.current = true;
      r.replace(`${ROOT}/${sid}` as any);
    } catch (e) {
      setPublishOpen(false);
      if (e instanceof ApiError && e.code === 'NOT_PUBLISHABLE') {
        const fl = e.fields ?? {};
        const lines = Object.keys(fl).length ? Object.entries(fl).map(([k, v]) => ({ step: stepForPath(k), text: `${k}: ${v}` })) : [{ step: 5, text: e.message }];
        setServerLines(lines); setStep(5);
        toast.show('Not ready to publish. See the list below.', 'error');
      } else toast.show(errMessage(e), 'error');
    }
  };

  const leave = () => { bypass.current = true; if (r.canGoBack()) r.back(); else r.replace(ROOT as any); };
  const onBack = () => { if (dirty && (f.title.trim() || assessmentId)) setLeaveOpen(true); else leave(); };

  const last = step === STEPS.length - 1;
  const footer = (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Button label="Back" variant="secondary" full disabled={step === 0} onPress={() => setStep((s) => Math.max(0, s - 1))} /></View>
      <View style={{ flex: 2 }}>
        {last
          ? <Button label="Publish test" icon="publish" full loading={publish.isPending} disabled={problems.length > 0} onPress={() => setPublishOpen(true)} />
          : <Button label="Next" full loading={save.isPending} onPress={next} />}
      </View>
    </View>
  );

  return (
    <Frame title={isNew && !assessmentId ? 'New test' : 'Edit draft'} onBack={onBack} keyboard footer={footer}
      right={<HeaderAction icon="save" label="Save draft" onPress={() => { void saveDraft(); }} />}>
      <StepIndicator steps={STEPS} current={step} />
      {dirty ? <Text variant="caption" color={colors.muted}>Unsaved changes. Next saves your draft automatically.</Text> : assessmentId ? <Text variant="caption" color={colors.muted}>Draft saved.</Text> : null}

      {step === 0 ? <StepDetails f={f} patch={patch} drives={drives} errors={errors} /> : null}
      {step === 1 ? <StepQuestions f={f} patch={patch} /> : null}
      {step === 2 ? <StepRules f={f} patch={patch} errors={errors} /> : null}
      {step === 3 ? <StepAudience f={f} patch={patch} drives={drives} preview={preview} previewBusy={previewBusy} previewError={previewErr} stale={!!preview && previewSig !== audSig} onPreview={runPreviewAudience} /> : null}
      {step === 4 ? <StepSchedule f={f} patch={patch} errors={errors} /> : null}
      {step === 5 ? <StepReview f={f} problems={problems} serverLines={serverLines} drives={drives} onJump={setStep} onPreview={openPreview} /> : null}

      <ConfirmSheet visible={publishOpen} onClose={() => setPublishOpen(false)} title="Publish this test?" confirmLabel={publish.isPending ? 'Publishing...' : 'Publish'}
        message={f.practice ? 'Students will find this practice set under Practice.' : 'The audience is notified now and gets reminders before it opens. Questions are frozen at this point; later bank edits will not change this test.'}
        onConfirm={doPublish} disabled={publish.isPending}>
        {preview && !f.practice ? <Banner tone="info" message={`Audience preview: ${preview.count} student${preview.count === 1 ? '' : 's'}.`} /> : null}
      </ConfirmSheet>
      <ConfirmSheet visible={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave without saving?" confirmLabel="Save draft and leave" message="You have changes that are not saved yet."
        onConfirm={async () => { const sid = await saveDraft(true); if (sid) { setLeaveOpen(false); leave(); } }}>
        <Button label="Discard changes" variant="danger" full onPress={() => { setLeaveOpen(false); savedSig.current = sig; leave(); }} />
      </ConfirmSheet>
    </Frame>
  );
}
