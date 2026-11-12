import React, { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, Card, Header, Icon, OfflineBanner, Screen, Sheet, StepIndicator, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { spacing } from '../layout';
import { useOnce } from '../components/common';
import { FocusedStatusBar } from '../components/FocusedStatusBar';
import {
  createDrive, eligibleCount, errFields, errMessage, getServerTime, publishDrive, updateDrive, useDrive, useInvalidateOfficer,
} from '../data';
import { EMPTY_DRAFT, type DriveDraft } from '../types';
import { STEP_TITLES, validateAll, validateStep } from '../validation';
import { CompStep, CompanyStep, EligibilityStep, JdStep, QuestionsStep, RoleStep, RoundsStep, TimelineStep } from './steps';
import { EligiblePanel, PreviewSheet, ReviewStep } from './review';
import { QueryBoundary } from '../components/common';

type Save = 'idle' | 'saving' | 'saved' | 'error';
const LAST = 8;

const humanKey = (k: string) => {
  const last = k.split('.').slice(-1)[0] || k;
  const t = last.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** Specific text for a failed draft save: server field errors when present, else the error message. */
function describeSaveError(e: unknown): string {
  if ((e as { code?: string } | null)?.code === 'LOGO_PUBLIC_URL_NOT_CONFIGURED') return 'Logo upload is not set up on the server yet (no public file address). Remove the logo to keep saving, or ask the admin to configure R2_PUBLIC_BASE_URL.';
  const f = errFields(e);
  if (f && Object.keys(f).length) {
    const parts = Object.entries(f).slice(0, 3).map(([k, v]) => `${humanKey(k)}: ${v}`);
    const more = Object.keys(f).length - parts.length;
    return parts.join('. ') + (more > 0 ? ` (+${more} more)` : '');
  }
  return errMessage(e);
}

export function DriveStepper({ draftId }: { draftId?: string }) {
  const r = useRouter();
  const nav = useNavigation<any>();
  const toast = useToast();
  const invalidate = useInvalidateOfficer();
  const existing = useDrive(draftId);

  const [d, setD] = useState<DriveDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(!draftId);
  const [step, setStep] = useState(0);
  const [showErr, setShowErr] = useState(false);
  const [save, setSave] = useState<Save>('idle');
  const [saveErr, setSaveErrState] = useState<string | null>(null);
  const saveErrRef = useRef<string | null>(null);
  const setSaveErr = (m: string | null) => { saveErrRef.current = m; setSaveErrState(m); };
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [leave, setLeave] = useState<any>(null);
  const [gate, setGate] = useState<string[]>([]);
  const [savedN, setSavedN] = useState(0);
  const [offset, setOffset] = useState(0);
  const idRef = useRef<string | undefined>(draftId);
  const dRef = useRef(d); dRef.current = d;
  const allowLeave = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const scrollKey = useRef(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [kbd, setKbd] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKbd(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbd(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // hydrate from server draft once
  useEffect(() => { if (draftId && existing.data && !ready) { setD(existing.data); setReady(true); } }, [draftId, existing.data, ready]);
  // server clock offset so the "future deadline" check uses server time
  useEffect(() => { getServerTime().then((t) => setOffset(new Date(t.now).getTime() - Date.now())).catch(() => {}); }, []);

  const now = () => Date.now() + offset;
  const set = useCallback((p: Partial<DriveDraft>) => { setD((x) => ({ ...x, ...p })); setDirty(true); setSave('idle'); }, []);

  /** Serialised save so autosave and manual save never create two drafts. */
  const saveNow = useCallback((): Promise<boolean> => {
    const run = async () => {
      const cur = dRef.current;
      if (cur.companyName.trim().length < 2) return false; // nothing meaningful to persist yet
      setSave('saving');
      try {
        if (idRef.current) await updateDrive(idRef.current, cur);
        else { const c = await createDrive(cur); idRef.current = c.id; }
        setSaveErr(null); setSave('saved'); setSavedN((n) => n + 1); if (dRef.current === cur) setDirty(false); return true;
      } catch (e) { setSaveErr(describeSaveError(e)); setSave('error'); return false; }
    };
    const p = chain.current.then(run, run);
    chain.current = p.catch(() => {});
    return p as Promise<boolean>;
  }, []);

  // debounced autosave
  useEffect(() => {
    if (!dirty || !ready) return;
    const t = setTimeout(() => { saveNow(); }, 2000);
    return () => clearTimeout(t);
  }, [d, dirty, ready, saveNow]);

  // unsaved-changes guard (nav back, hardware back, swipe)
  useEffect(() => nav.addListener('beforeRemove', (ev: any) => {
    if (allowLeave.current || !dirty) return;
    ev.preventDefault(); setLeave(ev.data.action);
  }), [nav, dirty]);
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) { setShowErr(false); setStep((s) => s - 1); return true; } // autosave keeps edits, so going back a step never loses work
      return false;
    });
    return () => h.remove();
  }, [step]);

  const errors = useMemo(() => validateStep(step, d, now()), [step, d, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => validateAll(d, now()), [d, offset, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const elig = useQuery({
    queryKey: ['officer', 'stepper-eligible', idRef.current, savedN],
    enabled: (step === 4 || step === LAST) && !!idRef.current && save === 'saved',
    queryFn: () => eligibleCount(idRef.current!),
  });

  // serialised so a double tap cannot skip a step
  const [goNext] = useOnce(async () => {
    if (Object.keys(errors).length) { setShowErr(true); scrollRef.current?.scrollTo({ y: 0, animated: false }); return; }
    setShowErr(false);
    if (dirty) await saveNow();
    scrollKey.current++;
    setStep((s) => Math.min(LAST, s + 1));
  });
  const goBack = () => { setShowErr(false); setStep((s) => Math.max(0, s - 1)); };
  const goTo = (s: number) => { setShowErr(true); setStep(s); };

  const [publish, publishing] = useOnce(async () => {
    setGate([]);
    if (all.length) { setShowErr(true); setGate(all.flatMap((s) => Object.values(s.errors).map((m) => `${STEP_TITLES[s.step]}: ${m}`))); return; }
    const ok = await saveNow();
    if (!ok || !idRef.current) { toast.show?.(saveErrRef.current ? `Could not save the draft. ${saveErrRef.current}` : 'Could not save the draft. Check your connection and try again.', 'error'); return; }
    try {
      await publishDrive(idRef.current);
      invalidate(); allowLeave.current = true; toast.show?.('Drive published', 'success');
      r.replace(`/(officer)/drive/${idRef.current}`);
    } catch (e) {
      const f = errFields(e);
      setGate(f && Object.keys(f).length ? Object.values(f) : [errMessage(e)]);
    }
  });

  const [saveLeave, savingLeave] = useOnce(async () => {
    const ok = await saveNow();
    if (!ok && dRef.current.companyName.trim().length >= 2) { toast.show?.('Could not save. Try again or discard.', 'error'); return; }
    allowLeave.current = true; invalidate(); const a = leave; setLeave(null); nav.dispatch(a);
  });
  const discard = () => { allowLeave.current = true; if (idRef.current) invalidate(); const a = leave; setLeave(null); nav.dispatch(a); };

  const stepProps = { d, set, e: showErr ? errors : {}, serverOffsetMs: offset };
  const body = [
    <CompanyStep {...stepProps} />, <RoleStep {...stepProps} />, <JdStep {...stepProps} />, <CompStep {...stepProps} />,
    <View style={{ gap: spacing[4] }}><EligibilityStep {...stepProps} /><EligiblePanel saved={!!idRef.current && save === 'saved'} loading={elig.isFetching} error={elig.isError} data={elig.data} onRetry={() => (save === 'saved' ? elig.refetch() : saveNow())} /></View>,
    <QuestionsStep {...stepProps} />, <RoundsStep {...stepProps} />, <TimelineStep {...stepProps} />,
    <ReviewStep d={d} goTo={goTo} errorsByStep={all}
      eligible={<EligiblePanel saved={!!idRef.current && save === 'saved'} loading={elig.isFetching} error={elig.isError} data={elig.data} onRetry={() => (save === 'saved' ? elig.refetch() : saveNow())} />} />,
  ][step];

  const STEP_HINT = [
    'Which company is hiring?', 'What is the role and where is it?', 'Describe the job for students.', 'Share the pay. Fixed amount is required.',
    'Who may apply? Leave a rule empty to skip it.', 'Optional extra questions for applicants.', 'List the selection rounds in order.', 'Set the deadline and a contact for students.', 'Check everything, then publish.',
  ];
  const saveStatus = save === 'saving' ? { icon: 'sync' as const, text: 'Saving draft…', color: colors.muted }
    : save === 'saved' ? { icon: 'cloud-done' as const, text: 'Draft saved', color: colors.success }
    : save === 'error' ? { icon: 'cloud-off' as const, text: 'Not saved', color: colors.error }
    : dirty ? { icon: 'edit' as const, text: 'Unsaved changes', color: colors.muted } : null;

  const goBackOut = () => (r.canGoBack() ? r.back() : r.replace('/(officer)/(tabs)/drives'));

  if (draftId && !ready) {
    return (
      <Screen padded={false} edges={['bottom']}>
        <FocusedStatusBar />
        <Header variant="bar" title="Edit draft" onBack={goBackOut} />
        <View style={{ padding: 16, gap: 12 }}>
          <OfflineBanner />
          <QueryBoundary isLoading={existing.isLoading} isError={existing.isError} error={existing.error} onRetry={() => existing.refetch()} skeletonRows={3} skeletonHeight={140}>
            <View />
          </QueryBoundary>
        </View>
      </Screen>
    );
  }

  const footer = step === LAST ? (
    <>
      <Button label="Publish drive" icon="publish" full loading={publishing} onPress={() => publish()} />
      {!kbd ? <Button label="Preview as student" variant="secondary" full onPress={() => setPreview(true)} /> : null}
      {!kbd ? <Button label="Back" variant="ghost" full onPress={goBack} /> : null}
    </>
  ) : (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {step > 0 && !kbd ? <View style={{ flex: 1 }}><Button label="Back" variant="secondary" full onPress={goBack} /></View> : null}
      <View style={{ flex: 2 }}><Button label="Next" full onPress={goNext} /></View>
    </View>
  );

  return (
    <Screen padded={false} edges={['bottom']} keyboard footer={footer}>
      <FocusedStatusBar />
      <Header variant="bar" title={d.companyName.trim() ? d.companyName.trim() : 'New drive'} subtitle="Drive details" onBack={goBackOut} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        <OfflineBanner />
        <StepIndicator steps={STEP_TITLES} current={step} />
        {saveStatus ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLiveRegion="polite">
            <Icon name={saveStatus.icon} size={18} color={saveStatus.color} />
            <Text variant="caption" color={saveStatus.color} style={{ fontWeight: '500' }}>{saveStatus.text}</Text>
          </View>
        ) : null}
        {save === 'error' ? (
          <Banner tone="error" title="Draft not saved" message={`${saveErr ?? 'Check your connection.'} Your edits are still here. We will retry on the next change.`}
            action={{ label: 'Retry save', onPress: () => { void saveNow(); } }} />
        ) : null}
      </View>
      <ScrollBody key={step} scrollRef={scrollRef}>
        {showErr && Object.keys(errors).length > 0 && step !== LAST ? (
          <Banner tone="error" title="Check the highlighted fields" message={`${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? 'field needs' : 'fields need'} attention before you can continue.`} />
        ) : null}
        <View style={{ gap: 2 }}>
          <Text variant="title">{STEP_TITLES[step]}</Text>
          <Text variant="caption" color={colors.muted}>{STEP_HINT[step]}</Text>
        </View>
        {step === LAST ? body : <Card style={{ gap: spacing[4] }}>{body}</Card>}
        {gate.length > 0 && <Banner tone="error" title="Cannot publish yet" message={gate.join('. ')} />}
      </ScrollBody>

      <PreviewSheet d={d} visible={preview} onClose={() => setPreview(false)} />
      <Sheet visible={!!leave} onClose={() => setLeave(null)} title="Unsaved changes">
        <View style={{ gap: spacing[3], paddingBottom: 8 }}>
          <Text variant="body">Your latest edits are not saved to the draft yet.</Text>
          <Button label="Save draft and leave" full loading={savingLeave} onPress={() => saveLeave()} />
          <Button label="Discard changes" variant="danger" full onPress={discard} />
          <Button label="Keep editing" variant="secondary" full onPress={() => setLeave(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function ScrollBody({ children, scrollRef }: { children: React.ReactNode; scrollRef: React.RefObject<ComponentRef<typeof ScrollView> | null> }) {
  return (
    <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ gap: spacing[4], padding: 16, paddingBottom: 32 }}>
      {children}
    </ScrollView>
  );
}
