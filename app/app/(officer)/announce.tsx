import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Header, OfflineBanner, Screen, Select, TextField, useIsOnline, useToast } from '@/ui';
import { errFields, errMessage, postAnnouncement, useDrivesOfficer, useInvalidateOfficer } from '@/features/officer/data';
import { useOnce } from '@/features/officer/components/common';
import { confirm } from '@/features/pipeline/kit';
import { useUnsavedGuard } from '@/features/student/me/kit';
import { FocusedStatusBar } from '@/features/officer/components/FocusedStatusBar';

export default function Announce() {
  const r = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const goBack = () => (r.canGoBack() ? r.back() : r.replace('/(officer)/(tabs)/more'));
  const invalidate = useInvalidateOfficer();
  const drives = useDrivesOfficer();
  const options = useMemo(() => {
    const list = (drives.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.status !== 'draft');
    return [{ value: 'all', label: 'All students' }, ...list.map((d) => ({ value: d.id, label: `${d.company.name} · ${d.role} participants` }))];
  }, [drives.data]);
  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});

  const { allowLeave } = useUnsavedGuard(!!(title.trim() || body.trim()));
  const audienceLabel = options.find((o) => o.value === audience)?.label ?? 'the chosen audience';

  const [send, busy] = useOnce(async () => {
    if (!online) { setErrs({ form: 'You are offline. Connect to send.' }); return; }
    try {
      await postAnnouncement({ title: title.trim(), body: body.trim(), driveId: audience === 'all' ? undefined : audience });
      void invalidate(); allowLeave(); toast.show('Announcement sent', 'success'); goBack();
    } catch (x) {
      const f = errFields(x);
      if (f && Object.keys(f).length) {
        const known = { title: f.title, body: f.body };
        const other = Object.entries(f).filter(([k]) => k !== 'title' && k !== 'body').map(([, v]) => v).join('. ');
        setErrs({ ...known, ...(other ? { form: other } : {}) } as Record<string, string>);
      } else setErrs({ form: errMessage(x) });
    }
  });
  // sending reaches many students at once and cannot be recalled, so ask first
  const review = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = 'Title needs at least 3 characters';
    if (body.trim().length < 5) e.body = 'Write a message of at least 5 characters';
    setErrs(e);
    if (Object.keys(e).length) return;
    confirm('Send this announcement?', `It goes straight to ${audienceLabel.toLowerCase().startsWith('all') ? 'all students' : audienceLabel} as a notification and cannot be recalled.`, 'Send', () => void send(), false);
  };

  return (
    <Screen padded={false} keyboard edges={['bottom']} footer={<Button label="Send announcement" icon="send" full loading={busy} onPress={review} />}>
      <FocusedStatusBar />
      <Header variant="bar" title="New announcement" onBack={goBack} />
      <KeyboardScroll>
        <OfflineBanner />
        <Card style={{ gap: 16 }}>
          <Select label="Send to" value={audience} onChange={setAudience} options={options} />
          {drives.isError ? <Banner tone="warning" message="Could not load your drives, so only 'All students' is available. Retry to pick a drive." action={{ label: 'Retry', onPress: () => { void drives.refetch(); } }} /> : null}
          <TextField label="Title" value={title} onChangeText={(t) => { setTitle(t); if (errs.title) setErrs((x) => ({ ...x, title: '' })); }} maxLength={100} error={errs.title} />
          <TextField label="Message" value={body} onChangeText={(t) => { setBody(t); if (errs.body) setErrs((x) => ({ ...x, body: '' })); }} multiline maxLength={1000} error={errs.body} />
        </Card>
        {errs.form ? <Banner tone="error" message={errs.form} /> : null}
        <Banner tone="info" message="Students receive this as a notification and see it in their announcements." />
      </KeyboardScroll>
    </Screen>
  );
}

function KeyboardScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
      {children}
    </ScrollView>
  );
}
