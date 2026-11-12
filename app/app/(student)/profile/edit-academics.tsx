import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, useWatch } from 'react-hook-form';
import { Banner, Button, Card, Chip, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import {
  normalizeSpaces, validateBacklogs, validateBatchYear, validateCgpa, validateGapYears, validatePercent, validateSemester, validateText,
} from '@/lib/validation';
import { errFields, errMessage, useProfileFull, useSaveProfile, type ProfileFull } from '@/features/student/me/data';
import { confirm, makeResolver, numStr, Page, QueryBoundary, RHFText, sp, useBack, useOnce, useUnsavedGuard, VerificationBadge } from '@/features/student/me/kit';

interface FV {
  university: string; department: string; program: string; batchYear: string; semester: string; cgpaScale: string;
  cgpa: string; tenthPercent: string; twelfthPercent: string; activeBacklogs: string; gapYears: string;
}
const optional = (v: string, fn: (s: string) => { ok: boolean; error?: string }) => (!v?.trim() ? null : (() => { const r = fn(v) as any; return r.ok ? null : r.error; })());
const textRule = (label: string, max: number) => (v: string) => {
  const r = validateText(v ?? '', { max, label });
  return r.ok ? null : r.error;
};

const resolver = makeResolver<FV>({
  university: textRule('University', 120),
  department: textRule('Department', 80),
  program: textRule('Program', 80),
  batchYear: (v) => optional(v, validateBatchYear),
  semester: (v) => optional(v, validateSemester),
  cgpa: (v, all) => optional(v, (s) => validateCgpa(s, Number(all.cgpaScale) || 10)),
  tenthPercent: (v) => optional(v, (s) => validatePercent(s, '10th percentage')),
  twelfthPercent: (v) => optional(v, (s) => validatePercent(s, '12th percentage')),
  activeBacklogs: (v) => optional(v, validateBacklogs),
  gapYears: (v) => optional(v, validateGapYears),
});

const VERIFIED: { field: keyof FV; key: string; label: string }[] = [
  { field: 'university', key: 'academics.university', label: 'University' },
  { field: 'department', key: 'academics.department', label: 'Department' },
  { field: 'program', key: 'academics.program', label: 'Program' },
  { field: 'batchYear', key: 'academics.batchYear', label: 'Batch year' },
  { field: 'semester', key: 'academics.semester', label: 'Semester' },
  { field: 'cgpa', key: 'academics.cgpa', label: 'CGPA' },
  { field: 'cgpaScale', key: 'academics.cgpaScale', label: 'CGPA scale' },
  { field: 'tenthPercent', key: 'academics.tenthPercent', label: '10th percentage' },
  { field: 'twelfthPercent', key: 'academics.twelfthPercent', label: '12th percentage' },
  { field: 'activeBacklogs', key: 'academics.activeBacklogs', label: 'Active backlogs' },
  { field: 'gapYears', key: 'academics.gapYears', label: 'Gap years' },
];

const num = (s: string) => (s.trim() ? Number(s.trim()) : null);
const txt = (s: string) => (s.trim() ? normalizeSpaces(s) : null);

function AcademicsForm({ p }: { p: ProfileFull }) {
  const router = useRouter(); void router;
  const goBack = useBack('/(student)/(tabs)/profile');
  const toast = useToast();
  const save = useSaveProfile();
  const a = p.academics ?? {};
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const initial: FV = {
    university: a.university ?? '', department: a.department ?? '', program: a.program ?? '', batchYear: numStr(a.batchYear),
    semester: numStr(a.semester), cgpaScale: String(a.cgpaScale ?? 10), cgpa: a.cgpa != null ? Number(a.cgpa).toFixed(2) : '',
    tenthPercent: numStr(a.tenthPercent), twelfthPercent: numStr(a.twelfthPercent), activeBacklogs: numStr(a.activeBacklogs), gapYears: numStr(a.gapYears),
  };
  const { control, handleSubmit, formState, setValue, getValues } = useForm<FV>({ resolver, mode: 'onBlur', defaultValues: initial });
  const scale = useWatch({ control, name: 'cgpaScale' });
  const watched = useWatch({ control }) as FV;
  const { allowLeave } = useUnsavedGuard(formState.isDirty);

  const norm = (f: keyof FV, v: string) => (f === 'cgpa' && v.trim() ? Number(v).toFixed(2) : (v ?? '').trim());
  const resetList = VERIFIED.filter((x) => p.verification?.[x.key] === 'verified' && norm(x.field, String(watched?.[x.field] ?? '')) !== norm(x.field, initial[x.field])).map((x) => x.label);

  const [submit, busy] = useOnce(async (v: FV) => {
    setServerErr({});
    try {
      await save.mutateAsync({
        academics: {
          university: txt(v.university), department: txt(v.department), program: txt(v.program),
          batchYear: num(v.batchYear), semester: num(v.semester), cgpaScale: Number(v.cgpaScale) as 4 | 5 | 10,
          cgpa: num(v.cgpa), tenthPercent: num(v.tenthPercent), twelfthPercent: num(v.twelfthPercent),
          activeBacklogs: num(v.activeBacklogs), gapYears: num(v.gapYears),
        },
      });
      toast.show(resetList.length ? 'Saved. Changed verified fields now await re-verification.' : 'Academics saved', 'success');
      allowLeave();
      goBack();
    } catch (e) {
      const f = errFields(e);
      if (f) {
        const m: Record<string, string> = {};
        for (const [k, msg] of Object.entries(f)) m[k.split('.').pop()!] = msg;
        setServerErr(m);
      }
      toast.show(errMessage(e), 'error');
    }
  });

  const onValid = (v: FV) => {
    if (resetList.length) {
      confirm('Reset verification?', `Changing ${resetList.join(', ')} marks ${resetList.length > 1 ? 'them' : 'it'} unverified until the placement cell checks again. Drives that need verified data may show as pending meanwhile.`, 'Save anyway', () => submit(v), false);
    } else submit(v);
  };

  const anyVerified = VERIFIED.some((x) => p.verification?.[x.key] === 'verified');
  return (
    <Page
      title="Academics"
      onBack={goBack}
      keyboard
      gap={sp.xl}
      footer={
        <>
          {resetList.length ? <Text variant="caption" color={colors.warning}>{`Saving will reset verification for: ${resetList.join(', ')}.`}</Text> : null}
          <Button label="Save changes" full loading={busy} disabled={!formState.isDirty} onPress={handleSubmit(onValid, () => toast.show('Fix the highlighted fields', 'error'))} />
        </>
      }
    >
      <Banner
        tone="warning"
        title="Editing verified details"
        message="If you change a value the placement cell has verified, it becomes unverified and must be checked again. Saving the same value keeps it verified."
      />
      {anyVerified ? <VerificationBadge v="verified" /> : <Text variant="caption" color={colors.muted}>Nothing is verified yet.</Text>}

      <Card>
        <View style={{ gap: sp.lg }}>
          <Text variant="subhead">Education</Text>
          <RHFText control={control} name="university" label="University" maxLength={120} serverError={serverErr.university} />
          <RHFText control={control} name="department" label="Department" maxLength={80} serverError={serverErr.department} />
          <RHFText control={control} name="program" label="Program (for example B.Tech)" maxLength={80} serverError={serverErr.program} />
          <RHFText control={control} name="batchYear" label="Batch year (graduation)" keyboardType="number-pad" maxLength={4} helper="2020-2040" serverError={serverErr.batchYear} />
          <RHFText control={control} name="semester" label="Current semester" keyboardType="number-pad" maxLength={2} helper="1-12" serverError={serverErr.semester} />
        </View>
      </Card>

      <Card>
        <View style={{ gap: sp.lg }}>
          <Text variant="subhead">Scores</Text>
          <View style={{ gap: sp.xs }}>
            <Text variant="caption" color={colors.muted}>CGPA scale</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {['4', '5', '10'].map((sc) => (
                <Chip key={sc} label={`Out of ${sc}`} selected={scale === sc} onPress={() => setValue('cgpaScale', sc, { shouldDirty: true, shouldValidate: !!getValues('cgpa') })} />
              ))}
            </View>
          </View>
          <RHFText control={control} name="cgpa" label={`CGPA (0-${scale || 10}, up to 2 decimals)`} keyboardType="decimal-pad" maxLength={5} serverError={serverErr.cgpa} />
          <RHFText control={control} name="tenthPercent" label="10th percentage" keyboardType="decimal-pad" maxLength={6} helper="0-100, up to 2 decimals" serverError={serverErr.tenthPercent} />
          <RHFText control={control} name="twelfthPercent" label="12th percentage" keyboardType="decimal-pad" maxLength={6} helper="0-100, up to 2 decimals" serverError={serverErr.twelfthPercent} />
          <RHFText control={control} name="activeBacklogs" label="Active backlogs" keyboardType="number-pad" maxLength={2} helper="Whole number, 0-50" serverError={serverErr.activeBacklogs} />
          <RHFText control={control} name="gapYears" label="Gap years" keyboardType="number-pad" maxLength={2} helper="Whole number, 0-10" serverError={serverErr.gapYears} />
        </View>
      </Card>
    </Page>
  );
}

export default function EditAcademics() {
  const q = useProfileFull();
  const back = useBack('/(student)/(tabs)/profile');
  if (q.data) return <AcademicsForm p={q.data} />;
  return (
    <Page title="Academics" onBack={back}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} skeletonRows={4} skeletonHeight={160}>
        {null}
      </QueryBoundary>
    </Page>
  );
}
