import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, HeaderAction, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useAnnouncementMutations, useAnnouncementTemplates } from '@/api/ops';
import { Async, ConfirmSheet, OpsPage, useOnce } from '@/features/ops/kit';

export default function Templates() {
  const toast = useToast();
  const q = useAnnouncementTemplates();
  const m = useAnnouncementMutations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);

  const [save, busy] = useOnce(async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter a name';
    if (!title.trim()) e.title = 'Enter a title';
    if (!body.trim()) e.body = 'Enter a message';
    setErrs(e); setBanner(null);
    if (Object.keys(e).length) return;
    try { await m.createTemplate({ name: name.trim(), title: title.trim(), body: body.trim() }); setOpen(false); setName(''); setTitle(''); setBody(''); toast.show('Template saved', 'success'); }
    catch (x) { setErrs(fieldErrors(x)); setBanner(errMessage(x)); }
  });

  return (
    <OpsPage title="Templates" back="/(officer)/ops/announcements" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}
      right={<HeaderAction icon="add" label="New template" onPress={() => setOpen(true)} />}>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} isEmpty={(q.data?.length ?? 0) === 0}
        empty={{ icon: 'description', title: 'No templates', message: 'Save the messages you send often, like deadline reminders.', actionLabel: 'New template', onAction: () => setOpen(true) }}>
        {q.data?.map((t) => (
          <Card key={t.id} style={{ gap: 6 }}>
            <Text variant="subhead">{t.name}</Text>
            <Text variant="body">{t.title}</Text>
            <Text variant="caption" color={colors.muted} numberOfLines={3}>{t.body}</Text>
            <View style={{ flexDirection: 'row' }}><Button label="Delete" icon="delete-outline" variant="ghost" size="sm" onPress={() => setDel(t.id)} /></View>
          </Card>
        ))}
      </Async>
      <Sheet visible={open} onClose={() => setOpen(false)} title="New template">
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <TextField label="Template name" value={name} onChangeText={setName} maxLength={60} error={errs.name} />
          <TextField label="Title" value={title} onChangeText={setTitle} maxLength={100} error={errs.title} />
          <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={2000} error={errs.body} />
          {banner ? <Banner tone="error" message={banner} /> : null}
          <Button label="Save template" full loading={busy} onPress={() => save()} />
        </View>
      </Sheet>
      <ConfirmSheet visible={!!del} onClose={() => setDel(null)} title="Delete template?" message="Announcements already written from it are not affected." confirmLabel="Delete" danger
        onConfirm={async () => { try { await m.deleteTemplate(del!); setDel(null); toast.show('Template deleted', 'success'); } catch (x) { toast.show(errMessage(x), 'error'); } }} />
    </OpsPage>
  );
}
