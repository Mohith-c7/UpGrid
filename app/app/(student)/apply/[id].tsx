import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Badge, Banner, Button, Card, CodeBlock, Countdown, EmptyState, ErrorState, Icon, KeyValueList, Screen, Skeleton, Text, useToast,
} from '@/ui';
import { colors, MIN_TOUCH, spacing } from '@/theme';
import { Page, useUnsavedGuard } from '@/features/student/me/kit';
import { ApiError, api, errMessage } from '@/api/client';
import { useApply, useApplyPreview, useDrive } from '@/api/hooks';
import { formatDateTimeIST } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/idempotency';
import type { Application, ApplyBody, ApplyReceipt, MappedField, Question, Verification } from '@/api/types';
import { CheckRow, Section } from '@/features/student/discover/blocks';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { ApplyGateBanner } from '@/features/studentExtras/ApplyGate';
import { applyGateCode, restrictionIdOf } from '@/api/studentExtras';
import type { ApplyGateCode } from '@/api/studentExtrasTypes';
import { friendlyError, isOfflineError, profileRouteFor, useNow } from '@/features/student/discover/helpers';
import {
  QuestionInput, isEmptyAnswer, toApiValue, validateAnswer, type AnswerValue,
} from '@/features/student/discover/questions';

const K_RESUME = '__resume';
const K_ACCEPT = '__accept';

const verBadge = (v: Verification): { label: string; tone: 'success' | 'neutral' | 'info' } =>
  v === 'verified' ? { label: 'Verified', tone: 'success' } : v === 'student_confirmed' ? { label: 'Self-confirmed', tone: 'info' } : { label: 'Unverified', tone: 'neutral' };

async function findApplicationId(driveId: string): Promise<string | null> {
  try {
    const r = await api.get<unknown>('/applications?limit=50');
    const arr = Array.isArray(r) ? r : (r as { items?: unknown } | null)?.items;
    if (!Array.isArray(arr)) return null;
    const hit = (arr as Application[]).find((a) => a.drive?.id === driveId && a.status !== 'withdrawn');
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

interface BannerState { tone: 'error' | 'warning'; title: string; message: string }
interface GateState { code: ApplyGateCode; message: string | null; restrictionId: string | null }

export default function ApplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const go = useCallback((p: string) => router.push(p as never), [router]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/opportunities' as never)), [router]);

  const driveQ = useDrive(id);
  const previewQ = useApplyPreview(id);
  const apply = useApply();

  /** ONE idempotency key per attempt; reused for every retry of this attempt. */
  const keyRef = useRef<string>('');
  if (!keyRef.current) keyRef.current = newIdempotencyKey();
  const lock = useRef(false);

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resumeSel, setResumeSel] = useState<string | null | undefined>(undefined);
  const [saveKeys, setSaveKeys] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [serverBlocked, setServerBlocked] = useState<'DEADLINE_PASSED' | 'NOT_ELIGIBLE' | null>(null);
  const [localExpired, setLocalExpired] = useState(false);
  const [receipt, setReceipt] = useState<ApplyReceipt['application'] | null>(null);

  // typed answers are lost on back: ask first (not once the application is submitted)
  const { allowLeave } = useUnsavedGuard(!receipt && (Object.keys(answers).length > 0 || accepted || resumeSel !== undefined));

  const p = previewQ.data;
  const driveElig = (driveQ.data?.eligibility?.status as string | undefined) ?? '';
  const previewGate = !p || p.canApply ? null : applyGateCode(p.blockedCode ?? '') ?? (driveElig === 'restricted' ? ('RESTRICTED' as ApplyGateCode) : null);
  const activeGate: GateState | null = gate ?? (previewGate ? { code: previewGate, message: p?.blockedReason ?? null, restrictionId: null } : null);
  const gateCodeNow = activeGate?.code ?? null;
  // coming back from the verify-email screen: re-run the preview so the gate clears by itself
  useFocusEffect(useCallback(() => {
    if (gateCodeNow === 'EMAIL_NOT_VERIFIED') { void previewQ.refetch(); setGate((g) => (g?.code === 'EMAIL_NOT_VERIFIED' ? null : g)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateCodeNow]));
  const offset = useMemo(() => {
    if (!p) return 0;
    const sn = Date.parse(p.serverNow);
    return Number.isNaN(sn) ? 0 : sn - previewQ.dataUpdatedAt;
  }, [p, previewQ.dataUpdatedAt]);
  const nowMs = useNow(offset, 1000);
  const deadlineMs = p ? Date.parse(p.deadline) : Number.POSITIVE_INFINITY;
  const deadlinePassed = !!p && (localExpired || serverBlocked === 'DEADLINE_PASSED' || nowMs >= deadlineMs);

  const questions: Question[] = p?.questionsToAsk ?? [];
  const resumeOptions = p?.resumeOptions ?? p?.resumes ?? [];
  const effectiveResume: string | null =
    resumeSel !== undefined ? resumeSel : (resumeOptions.find((r) => r.isDefault)?.id ?? resumeOptions[0]?.id ?? null);

  /* ------------------------------------------------------------ answers */
  const setAnswer = useCallback((q: Question, v: AnswerValue) => {
    setAnswers((a) => ({ ...a, [q.id]: v }));
    setErrors((e) => {
      if (!(q.id in e)) return e;
      const msg = validateAnswer(q, v);
      const c = { ...e };
      if (msg) c[q.id] = msg; else delete c[q.id];
      return c;
    });
  }, []);
  const blurAnswer = useCallback((q: Question) => {
    setErrors((e) => {
      const msg = validateAnswer(q, answers[q.id]);
      const c = { ...e };
      if (msg) c[q.id] = msg; else delete c[q.id];
      return c;
    });
  }, [answers]);

  /* ------------------------------------------------------------- submit */
  const handleError = useCallback(async (e: unknown) => {
    const gateCode = applyGateCode(e);
    if (gateCode) {
      setGate({ code: gateCode, message: e instanceof ApiError ? e.message : null, restrictionId: restrictionIdOf(e) });
      return;
    }
    if (e instanceof ApiError) {
      if (e.code === 'ALREADY_APPLIED') {
        toast.show('You have already applied to this drive.', 'info');
        const appId = id ? await findApplicationId(id) : null;
        allowLeave();
        router.replace((appId ? `/(student)/application/${appId}` : '/(student)/(tabs)/applications') as never);
        return;
      }
      if (e.code === 'DEADLINE_PASSED') {
        setServerBlocked('DEADLINE_PASSED');
        setBanner({ tone: 'error', title: 'Deadline passed', message: 'This drive closed before your application reached the server. Nothing was submitted.' });
        return;
      }
      if (e.code === 'NOT_ELIGIBLE') {
        setServerBlocked('NOT_ELIGIBLE');
        setBanner({ tone: 'error', title: 'Not eligible', message: e.message || 'Your profile does not meet this drive\'s criteria.' });
        return;
      }
      if (e.fields && Object.keys(e.fields).length > 0) {
        const next: Record<string, string> = {};
        const loose: string[] = [];
        for (const [k, v] of Object.entries(e.fields)) {
          const key = k.startsWith('answers.') ? k.slice(8) : k;
          if (questions.some((q) => q.id === key)) next[key] = v;
          else if (key === 'resumeId') next[K_RESUME] = v;
          else if (key === 'declarationsAccepted') next[K_ACCEPT] = v;
          else loose.push(v);
        }
        setErrors((prev) => ({ ...prev, ...next }));
        setBanner({
          tone: 'error',
          title: 'Please fix the highlighted fields',
          message: loose.length ? loose.join(' ') : 'The server could not accept some answers. Nothing was submitted.',
        });
        return;
      }
      if (e.isNetwork) {
        setBanner({
          tone: 'warning',
          title: 'Could not reach the server',
          message: 'Your answers are kept. Tap Submit again to retry. It is safe: you will not be applied twice.',
        });
        return;
      }
      setBanner({ tone: 'error', title: 'Could not submit', message: e.message });
      return;
    }
    setBanner({ tone: 'error', title: 'Could not submit', message: errMessage(e) });
  }, [id, questions, router, toast, allowLeave]);

  const submit = useCallback(async () => {
    if (lock.current || !p || !id) return;
    lock.current = true;
    setSubmitting(true);
    setBanner(null);
    setGate(null);
    try {
      if (Date.now() + offset >= Date.parse(p.deadline)) {
        setLocalExpired(true);
        return;
      }
      const errs: Record<string, string> = {};
      for (const q of questions) {
        const m = validateAnswer(q, answers[q.id]);
        if (m) errs[q.id] = m;
      }
      if (resumeOptions.length > 0 && !effectiveResume) errs[K_RESUME] = 'Choose a resume to send';
      if (!accepted) errs[K_ACCEPT] = 'Please confirm to continue';
      setErrors(errs);
      if (Object.keys(errs).length > 0) {
        const n = Object.keys(errs).length;
        setBanner({ tone: 'error', title: `Fix ${n} ${n === 1 ? 'item' : 'items'} to continue`, message: 'Highlighted fields need your attention.' });
        return;
      }
      const out: Record<string, unknown> = {};
      for (const q of questions) {
        const v = toApiValue(q, answers[q.id]);
        if (v !== undefined) out[q.id] = v;
      }
      const toSave = questions
        .filter((q) => q.saveToProfileKey && saveKeys[q.id] && !isEmptyAnswer(q, answers[q.id]))
        .map((q) => q.saveToProfileKey as string);
      const body: ApplyBody = {
        idempotencyKey: keyRef.current,
        resumeId: effectiveResume,
        answers: out,
        declarationsAccepted: true,
        ...(toSave.length ? { saveToProfile: toSave } : {}),
      };
      const r = await apply.mutateAsync({ driveId: id, body });
      setReceipt(r.application);
    } catch (e) {
      await handleError(e);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }, [p, id, offset, questions, answers, resumeOptions.length, effectiveResume, accepted, saveKeys, apply, handleError]);

  /* ------------------------------------------------------------ success */
  if (receipt) {
    const dd = driveQ.data;
    return (
      <Screen
        scroll
        padded
        footer={
          <>
            <Button label="View application" icon="description" full onPress={() => router.replace(`/(student)/application/${receipt.id}` as never)} />
            <Button label="Back to opportunities" variant="secondary" full onPress={() => router.replace('/(student)/(tabs)/opportunities' as never)} />
          </>
        }
      >
        <View style={{ gap: spacing.xl, paddingTop: spacing.xxl }}>
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={40} color={colors.success} />
            </View>
            <Text variant="title" align="center" accessibilityRole="header">Application submitted</Text>
            <Text variant="body" color={colors.muted} align="center">Keep your reference number. Updates from the placement cell appear under Applications.</Text>
          </View>
          <Card>
            <View style={{ gap: spacing.md }}>
              <CodeBlock label="Reference" code={receipt.reference} />
              <KeyValueList
                inline
                items={[
                  { label: 'Company', value: dd?.company.name ?? null },
                  { label: 'Role', value: dd?.role ?? null },
                  { label: 'Submitted', value: formatDateTimeIST(receipt.submittedAt) },
                ]}
              />
            </View>
          </Card>
        </View>
      </Screen>
    );
  }

  /* ----------------------------------------------------------- loading */
  if (previewQ.isLoading) {
    return (
      <Page title="Review and apply" onBack={back} scroll={false}>
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={84} radius={14} />
          <Skeleton height={220} radius={14} />
          <Skeleton height={120} radius={14} />
        </View>
      </Page>
    );
  }
  if (previewQ.isError || !p) {
    const code = previewQ.error instanceof ApiError ? previewQ.error.code : '';
    return (
      <Page title="Review and apply" onBack={back}>
        {code === 'ALREADY_APPLIED' ? (
          <EmptyState icon="check-circle" title="You already applied" message="Open your applications to see its status." actionLabel="View applications" onAction={() => go('/(student)/(tabs)/applications')} />
        ) : (
          <ErrorState
            message={isOfflineError(previewQ.error) ? "You're offline. Reconnect to review your application." : friendlyError(previewQ.error)}
            onRetry={() => void previewQ.refetch()}
          />
        )}
      </Page>
    );
  }

  /* -------------------------------------------------------------- form */
  const conflicts = p.conflicts ?? [];
  const missing = p.missingProfileFields ?? [];
  const mapped = p.mapped ?? [];
  const blocked = deadlinePassed || serverBlocked === 'NOT_ELIGIBLE' || !p.canApply;
  const company = driveQ.data?.company.name ?? 'the company';
  const role = driveQ.data?.role;

  let submitLabel = 'Submit application';
  if (deadlinePassed) submitLabel = 'Deadline passed';
  else if (serverBlocked === 'NOT_ELIGIBLE' || !p.canApply) submitLabel = 'Cannot apply';

  const footer = (
    <View style={{ gap: spacing.sm }}>
      {gate ? <ApplyGateBanner code={gate.code} message={gate.message} restrictionId={gate.restrictionId} onResolved={() => { setGate(null); void previewQ.refetch(); }} /> : null}
      {banner ? <Banner tone={banner.tone} title={banner.title} message={banner.message} /> : null}
      <Button label={submitLabel} icon={blocked ? undefined : 'send'} full loading={submitting} disabled={blocked || submitting} onPress={submit} />
    </View>
  );

  return (
    <Page title="Review and apply" subtitle={role ? `${company} · ${role}` : undefined} onBack={back} keyboard footer={footer} gap={spacing.xxl}>
      {!activeGate || activeGate.code !== 'EMAIL_NOT_VERIFIED' ? <VerifyEmailBanner /> : null}
      {/* Deadline */}
      <Card tinted={!deadlinePassed}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <Icon name={deadlinePassed ? 'lock-outline' : 'event'} size={24} color={deadlinePassed ? colors.error : colors.primary} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {deadlinePassed ? (
              <Text variant="subhead" color={colors.error}>Deadline passed</Text>
            ) : (
              <Countdown deadline={p.deadline} serverOffsetMs={offset} onExpire={() => setLocalExpired(true)} />
            )}
            <Text variant="caption" tabular color={colors.muted}>{`Deadline ${formatDateTimeIST(p.deadline)}`}</Text>
          </View>
        </View>
      </Card>

      {deadlinePassed ? (
        <Banner tone="error" title="Applications are closed" message="The deadline has passed, so this application can no longer be submitted." />
      ) : activeGate && !gate ? (
        <ApplyGateBanner code={activeGate.code} message={activeGate.message} restrictionId={activeGate.restrictionId} onResolved={() => void previewQ.refetch()} />
      ) : !p.canApply ? (
        <Banner
          tone="warning"
          title="You cannot apply yet"
          message={p.blockedReason ?? 'Your profile does not meet the requirements for this drive.'}
          action={{ label: 'Open my profile', onPress: () => go(profileRouteFor(missing[0]?.key)) }}
        />
      ) : null}

      {/* Things to fix first */}
      {conflicts.length > 0 || missing.length > 0 ? (
        <Section title="Fix before you apply" hint="These come from your profile, so you fix them there.">
          <View style={{ gap: spacing.sm }}>
            {conflicts.map((c) => (
              <Banner key={c.key} tone="warning" title={c.key.replace(/[_.]/g, ' ')} message={c.message} action={{ label: 'Fix in profile', onPress: () => go(profileRouteFor(c.key)) }} />
            ))}
            {missing.map((m) => (
              <Card key={m.key} onPress={() => go(profileRouteFor(m.key))} accessibilityLabel={`Add ${m.label} in profile`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Icon name="error-outline" size={22} color={colors.warning} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body" style={{ fontWeight: '600' }}>{m.label}</Text>
                    <Text variant="caption" color={colors.muted}>Missing from your profile</Text>
                  </View>
                  <Text variant="button" color={colors.primary}>Add</Text>
                </View>
              </Card>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Prefilled fields */}
      <Section title="Filled from your profile" hint={`Shared with ${company} if you apply. Edit these in Profile, not here.`}>
        {mapped.length === 0 ? (
          <Text variant="body" color={colors.muted}>No profile details are shared for this drive.</Text>
        ) : (
          <Card padding={0}>
            {mapped.map((m, i) => <MappedRow key={m.key} m={m} company={company} last={i === mapped.length - 1} />)}
          </Card>
        )}
      </Section>

      {/* Resume */}
      <Section title="Resume to send">
        {resumeOptions.length === 0 ? (
          <Card>
            <View style={{ gap: spacing.md }}>
              <Text variant="body" color={colors.muted}>You have no resume saved. Upload a file or add a link in your profile to send it with this application.</Text>
              <Button label="Add a resume" variant="secondary" icon="add" onPress={() => go('/(student)/profile/resumes')} />
              {errors[K_RESUME] ? <Text variant="caption" color={colors.error} accessibilityRole="alert">{errors[K_RESUME]}</Text> : null}
            </View>
          </Card>
        ) : (
          <Card>
            {resumeOptions.map((r) => (
              <CheckRow
                key={r.id}
                radio
                label={r.label}
                helper={[r.isDefault ? 'Default' : null, (r as { kind?: string }).kind === 'file' ? 'Uploaded file' : null].filter(Boolean).join(' · ') || undefined}
                checked={effectiveResume === r.id}
                onToggle={() => { setResumeSel(r.id); setErrors((e) => { const c = { ...e }; delete c[K_RESUME]; return c; }); }}
              />
            ))}
            {errors[K_RESUME] ? <Text variant="caption" color={colors.error} accessibilityRole="alert">{errors[K_RESUME]}</Text> : null}
          </Card>
        )}
      </Section>

      {/* Questions: ONLY questionsToAsk */}
      <Section title={`Questions from ${company}`} hint={questions.length ? `${questions.length} we could not fill from your profile.` : undefined}>
        {questions.length === 0 ? (
          <Banner tone="success" message="No extra questions. Everything needed is already in your profile." />
        ) : (
          <Card>
            <View style={{ gap: spacing.xl }}>
              {questions.map((q) => {
                const v = answers[q.id];
                return (
                  <View key={q.id} style={{ gap: spacing.sm }}>
                    <QuestionInput q={q} value={v} error={errors[q.id] ?? null} onChange={(nv) => setAnswer(q, nv)} onBlur={() => blurAnswer(q)} />
                    {q.saveToProfileKey && q.type !== 'declaration' && !isEmptyAnswer(q, v) ? (
                      <SaveToggle
                        value={!!saveKeys[q.id]}
                        onChange={(nv) => setSaveKeys((s) => ({ ...s, [q.id]: nv }))}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </Card>
        )}
      </Section>

      {/* Consent */}
      <Section title="Confirm">
        <Card>
          <CheckRow
            checked={accepted}
            onToggle={() => { setAccepted((a) => !a); setErrors((e) => { const c = { ...e }; delete c[K_ACCEPT]; return c; }); }}
            label={`I confirm these details are accurate and I agree to share them with ${company}.`}
            error={errors[K_ACCEPT] ?? null}
          />
        </Card>
      </Section>
    </Page>
  );
}

function MappedRow({ m, company, last }: { m: MappedField; company: string; last: boolean }) {
  const vb = verBadge(m.verification);
  const empty = m.value === null || m.value === undefined || m.value === '';
  const shown = empty ? 'Not provided' : String(m.value);
  const sharedWith = m.sharedWith && m.sharedWith !== company ? m.sharedWith : null;
  return (
    <View
      accessible
      accessibilityLabel={`${m.label}: ${shown}. ${vb.label}.${sharedWith ? ` Shared with ${sharedWith}.` : ''}`}
      style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}
    >
      <Text variant="caption" color={colors.muted}>{m.label}</Text>
      <Text variant="body" tabular color={empty ? colors.muted : colors.ink} style={{ fontWeight: '600' }}>{shown}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        <Badge label={vb.label} tone={vb.tone} icon={m.verification === 'verified' ? 'verified' : m.verification === 'student_confirmed' ? 'person' : 'hourglass-empty'} />
        <Text variant="caption" color={colors.muted} style={{ flexShrink: 1 }}>{`From ${m.source || 'profile'}${sharedWith ? ` · shared with ${sharedWith}` : ''}`}</Text>
      </View>
    </View>
  );
}

function SaveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="Also save this answer to my profile for next time"
      style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
    >
      <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>Also save this answer to my profile for next time</Text>
      <Switch accessible={false} value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor={colors.surface} />
    </Pressable>
  );
}
