import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Button, Checkbox, SegmentedControl, Select, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useFeature } from '@/config/features';
import { useAnnouncementMutations, useAnnouncementTemplates, useAnnouncementV2, useCohorts } from '@/api/ops';
import type { Audience } from '@/api/opsTypes';
import { confirm } from '@/features/pipeline/kit';
import { AnnouncementDraftButton } from '@/features/ai';
import { useDrivesOfficer } from '@/features/officer/data';
import { AUDIENCE_LABEL } from '@/features/ops/annParts';
import { Async, DateTimeFields, Group, isDate, isoToIst, istToIso, OpsPage, PickRow, useBack, useGo, useOnce } from '@/features/ops/kit';

type Mode = 'now' | 'schedule' | 'draft';

export default function Compose() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const toast = useToast();
  const back = useBack('/(officer)/ops/announcements');
  const go = useGo();
  const aiOn = useFeature('ai');
  const existing = useAnnouncementV2(id);
  const m = useAnnouncementMutations();
  const cohorts = useCohorts();
  const drives = useDrivesOfficer();
  const templates = useAnnouncementTemplates();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [aType, setAType] = useState<Audience['type']>('all');
  const [cohortId, setCohortId] = useState('');
  const [driveId, setDriveId] = useState('');
  const [inApp, setInApp] = useState(true);
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [mode, setMode] = useState<Mode>('now');
  const [sd, setSd] = useState(''); const [st, setSt] = useState('');
  const [pinned, setPinned] = useState(false);
  const [ed, setEd] = useState(''); const [et, setEt] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    const a = existing.data;
    if (editing && a && !loaded) {
      setTitle(a.title); setBody(a.body); setAType(a.audience?.type ?? 'all');
      if (a.audience?.type === 'cohort') setCohortId(a.audience.cohortId);
      if (a.audience && 'driveId' in a.audience) setDriveId(a.audience.driveId);
      setInApp(a.channels?.inApp ?? true); setPush(a.channels?.push ?? true); setEmail(a.channels?.email ?? false);
      setPinned(a.pinned); setTemplateId(a.templateId);
      const s = isoToIst(a.sendAt); setSd(s.date); setSt(s.time); setMode(a.status === 'scheduled' ? 'schedule' : a.status === 'draft' ? 'draft' : 'now');
      const x = isoToIst(a.expiresAt); setEd(x.date); setEt(x.time);
      setLoaded(true);
    }
  }, [existing.data, editing, loaded]);

  const driveOpts = useMemo(() => (drives.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => d.status !== 'draft').map((d) => ({ value: d.id, label: `${d.company.name} · ${d.role}` })), [drives.data]);
  const cohortOpts = useMemo(() => (cohorts.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.memberCount})` })), [cohorts.data]);
  const needsDrive = aType === 'drive_participants' || aType === 'eligible_not_applied';

  const [submit, busy] = useOnce(async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Enter a title'; else if (title.trim().length > 100) e.title = 'Keep the title within 100 characters';
    if (!body.trim()) e.body = 'Write a message';
    if (aType === 'cohort' && !cohortId) e.audience = 'Choose a cohort';
    if (needsDrive && !driveId) e.audience = 'Choose a drive';
    if (!inApp && !push && !email) e.channels = 'Choose at least one channel';
    let sendAt: string | null = null;
    if (mode === 'schedule') {
      sendAt = istToIso(sd, st || '09:00');
      if (!sendAt) e.sendAt = 'Use YYYY-MM-DD and HH:mm'; else if (Date.parse(sendAt) <= Date.now() + 30_000) e.sendAt = 'Choose a time in the future';
    }
    let expiresAt: string | null = null;
    if (ed.trim()) {
      expiresAt = istToIso(ed, et || '23:59');
      if (!expiresAt) e.expiresAt = 'Use YYYY-MM-DD and HH:mm';
      else if (Date.parse(expiresAt) <= (sendAt ? Date.parse(sendAt) : Date.now())) e.expiresAt = 'Expiry must be after the send time';
    }
    setErrs(e); setBanner(null);
    if (Object.keys(e).length) return;
    const audience: Audience = aType === 'all' ? { type: 'all' } : aType === 'cohort' ? { type: 'cohort', cohortId } : { type: aType, driveId } as Audience;
    const payload = { title: title.trim(), body: body.trim(), audience, channels: { inApp, push, email }, pinned, expiresAt, templateId, sendAt: mode === 'schedule' ? sendAt : null, draft: mode === 'draft' };
    try {
      if (editing) {
        await m.update(id!, { title: payload.title, body: payload.body, audience, channels: payload.channels, pinned, expiresAt, sendAt: payload.sendAt, templateId });
        if (mode === 'now') await m.send(id!);
        toast.show(mode === 'now' ? 'Announcement sent' : 'Changes saved', 'success');
      } else {
        await m.create(mode === 'now' ? { ...payload, sendAt: undefined, draft: false } : mode === 'draft' ? { ...payload, sendAt: undefined } : { ...payload, draft: false });
        toast.show(mode === 'now' ? 'Announcement sent' : mode === 'schedule' ? 'Announcement scheduled' : 'Draft saved', 'success');
      }
      back();
    } catch (x) {
      const f = fieldErrors(x);
      setErrs(f); setBanner(errMessage(x));
    }
  });

  const label = mode === 'now' ? (editing ? 'Save and send now' : 'Send now') : mode === 'schedule' ? 'Schedule' : 'Save draft';
  const locked = editing && existing.data && existing.data.status === 'sent';

  return (
    <OpsPage title={editing ? 'Edit announcement' : 'New announcement'} back="/(officer)/ops/announcements" keyboard
      footer={!locked ? <Button label={label} icon={mode === 'now' ? 'send' : mode === 'schedule' ? 'schedule' : 'save'} full loading={busy} onPress={() => (mode === 'now' ? confirm(editing ? 'Save and send now?' : 'Send now?', 'Students in the audience are notified straight away. A sent announcement cannot be recalled.', 'Send', () => void submit(), false) : void submit())} /> : undefined}>
      <Async isLoading={editing && existing.isLoading} isError={editing && existing.isError} error={existing.error} onRetry={() => void existing.refetch()} rows={3}>
        {locked ? <Banner tone="warning" title="Already sent" message="A sent announcement cannot be edited. You can still pin or unpin it from its page." action={{ label: 'Back', onPress: back }} /> : (
          <>
            <Group title="Message">
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                <Button label="Use template" icon="description" variant="secondary" size="sm" onPress={() => setTplOpen(true)} />
                {aiOn ? <AnnouncementDraftButton driveId={needsDrive ? driveId || undefined : undefined} onUse={(d) => { setTitle(d.title.slice(0, 100)); setBody(d.body); setTemplateId(null); }} /> : null}
              </View>
              <TextField label="Title" value={title} onChangeText={setTitle} maxLength={100} error={errs.title} />
              <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={2000} error={errs.body} />
              {aiOn ? <Text variant="caption" color={colors.muted}>AI drafts are only suggestions. Check every date and number before sending.</Text> : null}
            </Group>

            <Group title="Audience">
              <Select label="Send to" value={aType} onChange={(v) => setAType(v as Audience['type'])} options={Object.entries(AUDIENCE_LABEL).map(([value, label]) => ({ value, label }))} />
              {aType === 'cohort' ? (
                cohorts.isError ? <Banner tone="error" message={errMessage(cohorts.error)} action={{ label: 'Retry', onPress: () => void cohorts.refetch() }} /> :
                cohortOpts.length === 0 && !cohorts.isLoading ? <Banner tone="info" message="You have no cohorts yet." action={{ label: 'Create a cohort', onPress: () => go('/(officer)/ops/cohorts/new') }} /> :
                <Select label="Cohort" value={cohortId} onChange={setCohortId} options={cohortOpts} error={errs.audience} />
              ) : null}
              {needsDrive ? (
                drives.isError ? <Banner tone="error" message="Could not load drives." action={{ label: 'Retry', onPress: () => void drives.refetch() }} /> :
                <Select label="Drive" value={driveId} onChange={setDriveId} options={driveOpts} error={errs.audience} />
              ) : null}
              {aType === 'eligible_not_applied' ? <Text variant="caption" color={colors.muted}>Reaches students who can apply to the drive but have not yet. Good for deadline nudges.</Text> : null}
            </Group>

            <Group title="Channels">
              <Checkbox checked={inApp} onChange={setInApp}><Text variant="body">In-app notification</Text></Checkbox>
              <Checkbox checked={push} onChange={setPush}><Text variant="body">Push notification</Text></Checkbox>
              <Checkbox checked={email} onChange={setEmail}><Text variant="body">Email</Text></Checkbox>
              {errs.channels ? <Text variant="caption" color={colors.error}>{errs.channels}</Text> : null}
            </Group>

            <Group title="When">
              <SegmentedControl value={mode} onChange={(v) => setMode(v as Mode)} options={[{ value: 'now', label: 'Send now' }, { value: 'schedule', label: 'Schedule' }, { value: 'draft', label: 'Save draft' }]} />
              {mode === 'schedule' ? <DateTimeFields label="Send at" date={sd} time={st} onDate={setSd} onTime={setSt} error={errs.sendAt} /> : null}
              <Checkbox checked={pinned} onChange={setPinned}><Text variant="body">Pin to the top of students' feed</Text></Checkbox>
              <DateTimeFields label="Hide after (optional)" date={ed} time={et} onDate={setEd} onTime={setEt} error={errs.expiresAt} helper="Students stop seeing it after this time." />
            </Group>
            {banner ? <Banner tone="error" message={banner} /> : null}
          </>
        )}
      </Async>

      <Sheet visible={tplOpen} onClose={() => setTplOpen(false)} title="Use a template">
        <View style={{ gap: 8, paddingBottom: 16 }}>
          <Async isLoading={templates.isLoading} isError={templates.isError} error={templates.error} onRetry={() => void templates.refetch()} isEmpty={(templates.data?.length ?? 0) === 0}
            empty={{ icon: 'description', title: 'No templates', message: 'Create templates from the Announcements page.' }} rows={2} rowHeight={56}>
            {templates.data?.map((t) => <PickRow key={t.id} label={t.name} sub={t.title} onPress={() => { setTitle(t.title); setBody(t.body); setTemplateId(t.id); setTplOpen(false); }} />)}
          </Async>
        </View>
      </Sheet>
    </OpsPage>
  );
}
