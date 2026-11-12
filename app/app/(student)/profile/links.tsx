import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { Banner, Button, Card, useToast } from '@/ui';
import { validateUrl } from '@/lib/validation';
import { errFields, errMessage, useProfileFull, useSaveProfile, type ProfileFull } from '@/features/student/me/data';
import { makeResolver, Page, QueryBoundary, RHFText, sp, useBack, useOnce, useUnsavedGuard } from '@/features/student/me/kit';

interface FV { linkedin: string; github: string; portfolio: string }
const rule = (kind: 'any' | 'linkedin' | 'github') => (v: string) => { const r = validateUrl(v ?? '', kind); return r.ok ? null : r.error; };
const resolver = makeResolver<FV>({ linkedin: rule('linkedin'), github: rule('github'), portfolio: rule('any') });

function LinksForm({ p }: { p: ProfileFull }) {
  const router = useRouter(); void router;
  const goBack = useBack('/(student)/(tabs)/profile');
  const toast = useToast();
  const save = useSaveProfile();
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const { control, handleSubmit, formState } = useForm<FV>({
    resolver, mode: 'onBlur',
    defaultValues: { linkedin: p.links?.linkedin ?? '', github: p.links?.github ?? '', portfolio: p.links?.portfolio ?? '' },
  });
  const { allowLeave } = useUnsavedGuard(formState.isDirty);

  const [submit, busy] = useOnce(async (v: FV) => {
    setServerErr({});
    try {
      await save.mutateAsync({ links: { linkedin: v.linkedin.trim() || null, github: v.github.trim() || null, portfolio: v.portfolio.trim() || null } });
      toast.show('Links saved', 'success');
      allowLeave();
      goBack();
    } catch (e) {
      const f = errFields(e);
      if (f) { const m: Record<string, string> = {}; for (const [k, msg] of Object.entries(f)) m[k.split('.').pop()!] = msg; setServerErr(m); }
      toast.show(errMessage(e), 'error');
    }
  });

  return (
    <Page
      title="Links"
      onBack={goBack}
      keyboard
      footer={<Button label="Save links" full loading={busy} disabled={!formState.isDirty} onPress={handleSubmit(submit, () => toast.show('Fix the highlighted fields', 'error'))} />}
    >
      <Banner tone="info" message="Links must start with https://. Leave a field empty to remove it. Placement OS does not open or check these links." />
      <Card>
        <View style={{ gap: sp.lg }}>
          <RHFText control={control} name="linkedin" label="LinkedIn" keyboardType="url" maxLength={300} helper="https://www.linkedin.com/in/your-name" serverError={serverErr.linkedin} />
          <RHFText control={control} name="github" label="GitHub" keyboardType="url" maxLength={300} helper="https://github.com/your-username" serverError={serverErr.github} />
          <RHFText control={control} name="portfolio" label="Portfolio or website" keyboardType="url" maxLength={300} helper="https://..." serverError={serverErr.portfolio} />
        </View>
      </Card>
    </Page>
  );
}

export default function LinksScreen() {
  const q = useProfileFull();
  const back = useBack('/(student)/(tabs)/profile');
  if (q.data) return <LinksForm p={q.data} />;
  return (
    <Page title="Links" onBack={back}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} skeletonRows={3} skeletonHeight={72}>
        {null}
      </QueryBoundary>
    </Page>
  );
}
