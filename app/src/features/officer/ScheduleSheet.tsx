import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Icon, Sheet, SegmentedControl, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors, getServerOffsetMs } from '@/api/client';
import { useScheduleApplication, useScheduleBulk } from '@/api/hooks';
import type { BulkScheduleResult, ScheduleBody, ScheduleMode, ScheduleType } from '@/api/types';
import { validateText, validateUrl } from '@/lib/validation';
import { istPartsToISO, nowISTParts, type ISTParts } from './format';
import { dateLabel, describeIST, PickerRow, timeLabel, useISTPicker } from './components/pickers';

export { describeIST };
export interface ScheduleTarget { id: string; name: string }

function defaultParts(): ISTParts {
  const n = nowISTParts(getServerOffsetMs());
  const t = new Date(Date.UTC(n.y, n.m - 1, n.d + 1, 10, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 10, mm: 0 };
}

export function ScheduleSheet({
  visible, onClose, driveId, targets, onDone,
}: {
  driveId: string; visible: boolean; onClose: () => void; targets: ScheduleTarget[];
  onDone: (r: { scheduled: number; failed: number }) => void;
}) {
  const bulk = targets.length > 1;
  const single = useScheduleApplication();
  const multi = useScheduleBulk();
  const [type, setType] = useState<ScheduleType>('interview');
  const [mode, setMode] = useState<ScheduleMode>('online');
  const [when, setWhen] = useState<ISTParts>(defaultParts);
  const [venue, setVenue] = useState('');
  const [instructions, setInstructions] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkScheduleResult | null>(null);
  const names = useMemo(() => new Map(targets.map((t) => [t.id, t.name])), [targets]);
  const preview = describeIST(when);
  const picker = useISTPicker(when, (p) => { setWhen(p); setErrors((x) => ({ ...x, scheduledAt: '' })); });

  const validate = (): ScheduleBody | null => {
    const errs: Record<string, string> = {};
    const iso = istPartsToISO(when);
    if (Date.parse(iso) <= Date.now() + getServerOffsetMs() + 60000) errs.scheduledAt = 'Pick a date and time in the future (IST).';
    const v = venue.trim();
    if (mode === 'online') {
      const r = validateUrl(v, 'any', true);
      if (!r.ok) errs.venueOrLink = r.error === 'Enter a link' ? 'Enter the meeting link (https://...)' : r.error;
      else if (v.length < 3 || v.length > 200) errs.venueOrLink = 'Link must be 3–200 characters';
    } else if (v.length < 3 || v.length > 200) errs.venueOrLink = 'Venue must be 3–200 characters';
    else {
      const r = validateText(v, { max: 200 });
      if (!r.ok) errs.venueOrLink = r.error;
    }
    const ins = validateText(instructions, { max: 500 });
    if (!ins.ok) errs.instructions = ins.error;
    setErrors(errs);
    if (Object.keys(errs).length) return null;
    return { type, scheduledAt: iso, mode, venueOrLink: v, instructions: instructions.trim() || undefined };
  };

  const submit = async () => {
    setFormError(null);
    const body = validate();
    if (!body) return;
    try {
      if (bulk) {
        const r = await multi.mutateAsync({ driveId: driveId, body: { ...body, applicationIds: targets.map((t) => t.id) } });
        const failed = r?.failed ?? [];
        setResult({ scheduled: r?.scheduled ?? 0, failed });
        onDone({ scheduled: r?.scheduled ?? 0, failed: failed.length });
      } else {
        await single.mutateAsync({ id: targets[0].id, body });
        onDone({ scheduled: 1, failed: 0 });
        close();
      }
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      setFormError(errMessage(e));
    }
  };

  const close = () => {
    setResult(null); setErrors({}); setFormError(null); picker.close();
    onClose();
  };

  const busy = single.isPending || multi.isPending;
  return (
    <Sheet visible={visible} onClose={close} title={result ? 'Scheduling result' : bulk ? `Schedule ${targets.length} applicants` : `Schedule ${targets[0]?.name ?? ''}`}>
      {result ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Banner tone={result.failed.length ? 'warning' : 'success'} title={`${result.scheduled} scheduled, ${result.failed.length} failed`}
            message={result.failed.length ? 'Students who were scheduled have been notified.' : 'All selected students have been notified.'} />
          {result.failed.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text variant="subhead" color={colors.error}>Not scheduled</Text>
              {result.failed.map((f) => (
                <View key={f.applicationId} style={{ borderLeftWidth: 3, borderLeftColor: colors.error, paddingLeft: 12 }}>
                  <Text variant="body" style={{ fontWeight: '500' }}>{names.get(f.applicationId) ?? 'Applicant'}</Text>
                  <Text variant="caption" color={colors.muted}>{f.reason}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Button label="Done" full onPress={close} />
        </View>
      ) : (
        <View style={{ gap: 16, paddingBottom: 8 }}>
          {bulk ? <Text variant="caption" color={colors.muted}>The same slot is sent to all {targets.length} selected applicants. Each gets a notification.</Text> : null}
          <View style={{ gap: 6 }}>
            <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Type</Text>
            <SegmentedControl value={type} onChange={(v) => setType(v === 'assessment' ? 'assessment' : 'interview')}
              options={[{ value: 'interview', label: 'Interview' }, { value: 'assessment', label: 'Assessment' }]} />
          </View>
          <PickerRow label="Date (IST)" icon="event" value={dateLabel(when)} onPress={() => picker.open('date')} error={errors.scheduledAt} />
          <PickerRow label="Time (IST)" icon="schedule" value={timeLabel(when)} onPress={() => picker.open('time')} error={errors.scheduledAt} />
          {picker.iosPicker}
          {errors.scheduledAt ? (
            <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLiveRegion="polite">
              <Icon name="error-outline" size={20} color={colors.error} />
              <Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errors.scheduledAt}</Text>
            </View>
          ) : null}
          <Text variant="caption" color={colors.muted} tabular>Students will see: {preview}</Text>
          <View style={{ gap: 6 }}>
            <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Mode</Text>
            <SegmentedControl value={mode} onChange={(v) => { setMode(v === 'in_person' ? 'in_person' : 'online'); setErrors((x) => ({ ...x, venueOrLink: '' })); }}
              options={[{ value: 'online', label: 'Online' }, { value: 'in_person', label: 'In person' }]} />
          </View>
          <TextField
            label={mode === 'online' ? 'Meeting link' : 'Venue'} value={venue} onChangeText={setVenue} maxLength={200}
            placeholder={mode === 'online' ? 'https://meet.google.com/...' : 'Seminar Hall 2, Main Block'}
            keyboardType={mode === 'online' ? 'url' : 'default'} autoCapitalize="none" error={errors.venueOrLink || null}
            helper={mode === 'online' ? 'Must start with https://' : '3–200 characters'}
          />
          <TextField label="Instructions (optional)" value={instructions} onChangeText={setInstructions} maxLength={500} multiline
            error={errors.instructions || null} />
          {formError ? <Banner tone="error" message={formError} /> : null}
          <Button label={bulk ? `Schedule ${targets.length} applicants` : 'Schedule'} full onPress={submit} loading={busy} disabled={busy} />
          <Button label="Cancel" variant="ghost" full onPress={close} />
        </View>
      )}
    </Sheet>
  );
}
