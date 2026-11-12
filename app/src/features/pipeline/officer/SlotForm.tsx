import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, SegmentedControl, Select, Sheet, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { pipeError, useSlotActions } from '@/api/pipeline';
import type { Round, RoundMode } from '@/api/pipelineTypes';
import { validateText, validateUrl } from '@/lib/validation';
import { istPartsToISO, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, timeLabel, useISTPicker } from '@/features/officer/components/pickers';
import { sp, useOnce } from '../kit';
import { tomorrow10 } from './RoundForm';

const DURATIONS = [{ value: '20', label: '20 minutes' }, { value: '30', label: '30 minutes' }, { value: '45', label: '45 minutes' }, { value: '60', label: '1 hour' }, { value: '90', label: '1.5 hours' }];

/** Create one open slot (officer slots are open straight away). Panel defaults to the creating officer. */
export function SlotForm({ driveId, rounds, visible, onClose, onSaved }: { driveId: string; rounds: Round[]; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const { create } = useSlotActions(driveId);
  const [roundId, setRoundId] = useState('');
  const [when, setWhen] = useState<ISTParts>(tomorrow10);
  const [minutes, setMinutes] = useState('30');
  const [mode, setMode] = useState<RoundMode>('online');
  const [venue, setVenue] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [instructions, setInstructions] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const picker = useISTPicker(when, setWhen);
  useEffect(() => {
    if (!visible) return;
    setRoundId(rounds[0]?.id ?? ''); setWhen(tomorrow10()); setMinutes('30'); setMode('online'); setVenue(''); setCapacity('1'); setInstructions(''); setErrors({}); setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const [save, busy] = useOnce(async () => {
    const errs: Record<string, string> = {};
    if (!roundId) errs.round = 'Choose a round';
    const start = Date.parse(istPartsToISO(when));
    if (start <= Date.now() + getServerOffsetMs() + 60_000) errs.when = 'Pick a time in the future (IST).';
    const v = venue.trim();
    if (mode === 'online') { const r = validateUrl(v, 'any', true); if (!r.ok) errs.venue = r.error === 'Enter a link' ? 'Enter the meeting link (https://...)' : r.error; }
    else if (v.length < 3 || v.length > 200) errs.venue = 'Venue must be 3 to 200 characters';
    else { const r = validateText(v, { max: 200 }); if (!r.ok) errs.venue = r.error; }
    const cap = Number(capacity);
    if (!/^\d+$/.test(capacity) || cap < 1 || cap > 50) errs.capacity = 'Capacity must be 1 to 50';
    const ins = validateText(instructions, { max: 500 });
    if (!ins.ok) errs.instructions = ins.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFormError(null);
    try {
      await create.mutateAsync({ roundId, slots: [{ startsAt: new Date(start).toISOString(), endsAt: new Date(start + Number(minutes) * 60_000).toISOString(), mode, venueOrLink: v, capacity: cap, instructions: instructions.trim() || undefined }] });
      onSaved();
    } catch (e) { setFormError(pipeError(e)); }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="Create an interview slot">
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        <Select label="Round" value={roundId} onChange={setRoundId} error={errors.round || null} options={rounds.map((r) => ({ value: r.id, label: `Round ${r.seq}: ${r.name}` }))} />
        <PickerRow label="Date (IST)" icon="event" value={dateLabel(when)} error={errors.when || null} onPress={() => picker.open('date')} />
        <PickerRow label="Start time (IST)" icon="schedule" value={timeLabel(when)} onPress={() => picker.open('time')} />
        {picker.iosPicker}
        {errors.when ? <Text variant="caption" color={colors.error}>{errors.when}</Text> : null}
        <Select label="Length" value={minutes} onChange={setMinutes} options={DURATIONS} />
        <SegmentedControl value={mode} onChange={(v) => setMode(v as RoundMode)} options={[{ value: 'online', label: 'Online' }, { value: 'in_person', label: 'In person' }]} />
        <TextField label={mode === 'online' ? 'Meeting link' : 'Venue'} value={venue} onChangeText={(t) => { setVenue(t); setErrors((x) => ({ ...x, venue: '' })); }} error={errors.venue || null} maxLength={200} autoCapitalize="none" />
        <TextField label="Seats" value={capacity} onChangeText={(t) => { setCapacity(t.replace(/[^0-9]/g, '')); setErrors((x) => ({ ...x, capacity: '' })); }} keyboardType="number-pad" maxLength={2} error={errors.capacity || null} helper="Candidates who can book this slot" />
        <TextField label="Instructions (optional)" value={instructions} onChangeText={setInstructions} multiline maxLength={500} error={errors.instructions || null} />
        {formError ? <Banner tone="error" message={formError} /> : null}
        <Button label="Create slot" full loading={busy} onPress={() => save()} />
      </View>
    </Sheet>
  );
}
