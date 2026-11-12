import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, Select, Text, TextField, useToast } from '@/ui';
import { Page } from '../student/me/kit';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useCreateTicket } from '@/api/hooks';
import type { Ticket, TicketCategory } from '@/api/types';
import { CATEGORY_OPTIONS, isCategory, MESSAGE_MAX, MESSAGE_MIN, SUBJECT_MAX, SUBJECT_MIN } from './shared';

/** Route params (all optional): category, subject, message — used by the "Report a problem" / "Dispute eligibility" shortcuts. */
export default function NewTicket() {
  const p = useLocalSearchParams<{ category?: string; subject?: string; message?: string }>();
  const router = useRouter();
  const toast = useToast();
  const create = useCreateTicket();
  const [category, setCategory] = useState<TicketCategory | null>(isCategory(p.category) ? p.category : null);
  const [subject, setSubject] = useState((p.subject ?? '').slice(0, SUBJECT_MAX));
  const [message, setMessage] = useState((p.message ?? '').slice(0, MESSAGE_MAX));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(student)/support' as never));

  const submit = async () => {
    if (create.isPending) return;
    setFormError(null);
    const errs: Record<string, string> = {};
    const s = subject.trim(); const m = message.trim();
    if (!category) errs.category = 'Choose what this is about';
    if (s.length < SUBJECT_MIN) errs.subject = `Subject must be at least ${SUBJECT_MIN} characters`;
    else if (s.length > SUBJECT_MAX) errs.subject = `Subject must be at most ${SUBJECT_MAX} characters`;
    if (m.length < MESSAGE_MIN) errs.message = `Describe the problem in at least ${MESSAGE_MIN} characters`;
    else if (m.length > MESSAGE_MAX) errs.message = `Message must be at most ${MESSAGE_MAX} characters`;
    setErrors(errs);
    if (Object.keys(errs).length || !category) return;
    try {
      const r = await create.mutateAsync({ category, subject: s, message: m });
      const t: Ticket | undefined = (r as { ticket?: Ticket }).ticket ?? (r as Ticket);
      toast.show('Sent to the placement cell', 'success');
      if (t?.id) router.replace(`/(student)/support/${t.id}` as never);
      else router.replace('/(student)/support' as never);
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      setFormError(errMessage(e));
    }
  };

  return (
    <Page
      title="New ticket"
      onBack={back}
      keyboard
      footer={<Button label="Send to placement cell" icon="send" full onPress={submit} loading={create.isPending} disabled={create.isPending} />}
    >
      <Card>
        <View style={{ gap: 16 }}>
          <Select label="About" value={category} onChange={(v) => { setCategory(v as TicketCategory); setErrors((x) => ({ ...x, category: '' })); }} options={CATEGORY_OPTIONS} error={errors.category || null} placeholder="Choose a topic" />
          <TextField label="Subject" value={subject} onChangeText={(t) => { setSubject(t); setErrors((x) => ({ ...x, subject: '' })); }} maxLength={SUBJECT_MAX} error={errors.subject || null} />
          <TextField label="What happened?" value={message} onChangeText={(t) => { setMessage(t); setErrors((x) => ({ ...x, message: '' })); }} multiline maxLength={MESSAGE_MAX} error={errors.message || null} />
        </View>
      </Card>
      <Text variant="caption" color={colors.muted}>The placement cell can see your profile when it reads this. Do not include passwords.</Text>
      {formError ? <Banner tone="error" message={formError} /> : null}
    </Page>
  );
}
