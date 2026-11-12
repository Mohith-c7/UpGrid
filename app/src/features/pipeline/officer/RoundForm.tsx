import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Checkbox, SegmentedControl, Select, Sheet, Text, TextField } from '@/ui';
import { getServerOffsetMs } from '@/api/client';
import { pipeError, useRoundActions } from '@/api/pipeline';
import type { Round, RoundKind, RoundMode } from '@/api/pipelineTypes';
import { validateText, validateUrl } from '@/lib/validation';
import { isoToISTParts, istPartsToISO, nowISTParts, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, timeLabel, useISTPicker } from '@/features/officer/components/pickers';
import { KIND_OPTIONS, sp, useOnce } from '../kit';

export function tomorrow10(): ISTParts {
  const n = nowISTParts(getServerOffsetMs());
  const t = new Date(Date.UTC(n.y, n.m - 1, n.d + 1, 10, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 10, mm: 0 };
}

export function RoundForm({ driveId, visible, round, onClose, onSaved }: { driveId: string; visible: boolean; round: Round | null; onClose: () => void; onSaved: () => void }) {
  const { create, update } = useRoundActions(driveId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RoundKind>('technical');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'none' | RoundMode>('none');
  const [venue, setVenue] = useState('');
  const [setWhen, setSetWhen] = useState(false);
  const [when, setWhenParts] = useState<ISTParts>(tomorrow10);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const picker = useISTPicker(when, setWhenParts);

  useEffect(() => {
    if (!visible) return;
    setName(round?.name ?? ''); setKind(round?.kind ?? 'technical'); setDescription(round?.description ?? '');
    setMode(round?.mode ?? 'none'); setVenue(round?.venueOrLink ?? '');
    const p = round?.scheduledAt ? isoToISTParts(round.scheduledAt) : null;
    setSetWhen(!!p); setWhenParts(p ?? tomorrow10()); setErrors({}); setFormError(null);
  }, [visible, round]);

  const [save, busy] = useOnce(async () => {
    const errs: Record<string, string> = {};
    const n = name.trim();
    if (n.length < 2 || n.length > 80) errs.name = 'Name must be 2 to 80 characters';
    else { const r = validateText(n, { max: 80 }); if (!r.ok) errs.name = r.error; }
    const d = validateText(description, { max: 500 });
    if (!d.ok) errs.description = d.error;
    const v = venue.trim();
    if (mode === 'online' && v) { const r = validateUrl(v, 'any', true); if (!r.ok) errs.venue = r.error; }
    if (mode === 'in_person' && v && (v.length < 3 || v.length > 200)) errs.venue = 'Venue must be 3 to 200 characters';
    if (mode === 'none' && v) errs.venue = 'Choose online or in person, or clear this field';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFormError(null);
    const body = {
      name: n, kind, description: description.trim() || null, mode: mode === 'none' ? null : mode, venueOrLink: v || null,
      scheduledAt: setWhen ? istPartsToISO(when) : null,
    };
    try {
      if (round) await update.mutateAsync({ id: round.id, body }); else await create.mutateAsync(body);
      onSaved();
    } catch (e: any) {
      const f = e?.fields as Record<string, string> | undefined;
      if (f && Object.keys(f).length) setErrors({ name: f.name ?? '', description: f.description ?? '', venue: f.venueOrLink ?? '' });
      setFormError(pipeError(e));
    }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title={round ? 'Edit round' : 'Add a round'}>
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        <TextField label="Round name" value={name} onChangeText={(t) => { setName(t); setErrors((x) => ({ ...x, name: '' })); }} error={errors.name || null} maxLength={80} placeholder="e.g. Technical interview" />
        <Select label="Type" value={kind} onChange={(v) => setKind(v as RoundKind)} options={KIND_OPTIONS} />
        <TextField label="Description (optional)" value={description} onChangeText={(t) => { setDescription(t); setErrors((x) => ({ ...x, description: '' })); }} error={errors.description || null} multiline maxLength={500} />
        <View style={{ gap: 6 }}>
          <Text variant="caption" style={{ fontWeight: '600' }}>Mode</Text>
          <SegmentedControl value={mode} onChange={(v) => setMode(v as 'none' | RoundMode)} options={[{ value: 'none', label: 'Not set' }, { value: 'online', label: 'Online' }, { value: 'in_person', label: 'In person' }]} />
        </View>
        {mode !== 'none' ? (
          <TextField label={mode === 'online' ? 'Meeting link (optional)' : 'Venue (optional)'} value={venue} onChangeText={(t) => { setVenue(t); setErrors((x) => ({ ...x, venue: '' })); }}
            error={errors.venue || null} maxLength={200} autoCapitalize="none" />
        ) : null}
        <Checkbox checked={setWhen} onChange={setSetWhen}><Text variant="body">Set a date and time</Text></Checkbox>
        {setWhen ? (
          <View style={{ gap: sp.sm }}>
            <PickerRow label="Date (IST)" icon="event" value={dateLabel(when)} onPress={() => picker.open('date')} />
            <PickerRow label="Time (IST)" icon="schedule" value={timeLabel(when)} onPress={() => picker.open('time')} />
            {picker.iosPicker}
          </View>
        ) : null}
        {formError ? <Banner tone="error" message={formError} /> : null}
        <Button label={round ? 'Save changes' : 'Add round'} full loading={busy} onPress={() => save()} />
      </View>
    </Sheet>
  );
}
