import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Icon, Select, Sheet, SegmentedControl, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors, getServerOffsetMs } from '@/api/client';
import { useAuth } from '@/api/hooks';
import { useApproveSlot, useCancelSlot, useCreateSlots, useRecruiterDrive, useSlots } from '@/api/recruiter';
import type { Slot } from '@/api/recruiterTypes';
import { formatDateTimeIST, formatTimeIST } from '@/lib/format';
import { validateText, validateUrl } from '@/lib/validation';
import { istPartsToISO, nowISTParts, type ISTParts } from '@/features/officer/format';
import { dateLabel, PickerRow, timeLabel, useISTPicker } from '@/features/officer/components/pickers';
import { can, Page, SkeletonList, useBack } from '@/features/recruiter/kit';

const DURATIONS = [{ value: '30', label: '30 minutes' }, { value: '45', label: '45 minutes' }, { value: '60', label: '1 hour' }, { value: '90', label: '1.5 hours' }, { value: '120', label: '2 hours' }];

const SLOT_META: Record<Slot['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'error' }> = {
  open: { label: 'Open for booking', tone: 'success' },
  proposed: { label: 'Awaiting officer approval', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  declined: { label: 'Declined by officer', tone: 'error' },
};

function defaultStart(): ISTParts {
  const n = nowISTParts(getServerOffsetMs());
  const t = new Date(Date.UTC(n.y, n.m - 1, n.d + 1, 10, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 10, mm: 0 };
}

function ProposeSheet({ driveId, visible, onClose }: { driveId: string; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const drive = useRecruiterDrive(driveId);
  const create = useCreateSlots(driveId);
  const rounds = (drive.data?.rounds ?? []).filter((r) => r.kind === 'technical' || r.kind === 'hr' || r.kind === 'gd' || r.kind === 'custom');
  const allRounds = rounds.length ? rounds : drive.data?.rounds ?? [];
  const [roundId, setRoundId] = useState('');
  const [when, setWhen] = useState<ISTParts>(defaultStart);
  const [duration, setDuration] = useState('45');
  const [mode, setMode] = useState<'online' | 'in_person'>('online');
  const [venue, setVenue] = useState('');
  const [instructions, setInstructions] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const picker = useISTPicker(when, (p) => { setWhen(p); setErrors((x) => ({ ...x, startsAt: '' })); });
  const effectiveRound = roundId || allRounds[0]?.id || '';

  const submit = async () => {
    const errs: Record<string, string> = {};
    const startsAt = istPartsToISO(when);
    const endsAt = new Date(Date.parse(startsAt) + Number(duration) * 60000).toISOString();
    if (Date.parse(startsAt) <= Date.now() + getServerOffsetMs() + 60000) errs.startsAt = 'Pick a start time in the future (IST).';
    const v = venue.trim();
    if (mode === 'online') {
      const r = validateUrl(v, 'any', true);
      if (!r.ok) errs.venueOrLink = 'Enter the meeting link (https://...)';
    } else if (v.length < 3 || v.length > 200) errs.venueOrLink = 'Venue must be 3 to 200 characters.';
    else { const r = validateText(v, { max: 200 }); if (!r.ok) errs.venueOrLink = r.error; }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 50) errs.capacity = 'Capacity must be a whole number from 1 to 50.';
    const ins = validateText(instructions, { max: 500 });
    if (!ins.ok) errs.instructions = ins.error;
    if (!effectiveRound) errs.roundId = 'Choose a round.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFormError(null);
    try {
      await create.mutateAsync({ roundId: effectiveRound, slots: [{ startsAt, endsAt, mode, venueOrLink: v, instructions: instructions.trim() || undefined, capacity: cap }] });
      toast.show('Slot proposed. The placement cell will review it.', 'success');
      onClose();
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      setFormError(errMessage(e));
    }
  };

  return (
    <Sheet visible={visible} onClose={() => { if (!create.isPending) { picker.close(); onClose(); } }} title="Propose interview slot">
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <Select label="Round" value={effectiveRound} onChange={setRoundId} options={allRounds.map((r) => ({ value: r.id, label: `${r.seq}. ${r.name}` }))} error={errors.roundId} placeholder="Choose a round" />
        <PickerRow label="Date (IST)" icon="event" value={dateLabel(when)} onPress={() => picker.open('date')} error={errors.startsAt} />
        <PickerRow label="Start time (IST)" icon="schedule" value={timeLabel(when)} onPress={() => picker.open('time')} error={errors.startsAt} />
        {picker.iosPicker}
        {errors.startsAt ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errors.startsAt}</Text></View> : null}
        <Select label="Length" value={duration} onChange={setDuration} options={DURATIONS} />
        <View style={{ gap: 6 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Mode</Text>
          <SegmentedControl value={mode} onChange={(v) => setMode(v === 'in_person' ? 'in_person' : 'online')} options={[{ value: 'online', label: 'Online' }, { value: 'in_person', label: 'In person' }]} />
        </View>
        <TextField label={mode === 'online' ? 'Meeting link' : 'Venue'} value={venue} onChangeText={setVenue} maxLength={200} autoCapitalize="none" keyboardType={mode === 'online' ? 'url' : 'default'} error={errors.venueOrLink || null} helper={mode === 'online' ? 'Must start with https://' : undefined} />
        <TextField label="Seats per slot" value={capacity} onChangeText={(t) => setCapacity(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" error={errors.capacity || null} helper="1 for one-to-one interviews" />
        <TextField label="Instructions (optional)" value={instructions} onChangeText={setInstructions} maxLength={500} multiline error={errors.instructions || null} />
        {formError ? <Banner tone="error" message={formError} /> : null}
        <Button label="Propose slot" full loading={create.isPending} onPress={submit} />
        <Button label="Cancel" variant="ghost" full disabled={create.isPending} onPress={() => { picker.close(); onClose(); }} />
      </View>
    </Sheet>
  );
}

export default function SlotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = useBack(`/(recruiter)/drive/${id}`);
  const toast = useToast();
  const { user } = useAuth();
  const drive = useRecruiterDrive(id);
  const q = useSlots(id);
  const approve = useApproveSlot(id);
  const cancel = useCancelSlot(id);
  const [propose, setPropose] = useState(false);
  const [cancelling, setCancelling] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const canPropose = can(drive.data?.permissions, 'proposeSlots');
  const isOfficer = user?.role === 'officer'; // approve is officer-only on the server
  const roundName = useMemo(() => new Map((drive.data?.rounds ?? []).map((r) => [r.id, r.name])), [drive.data]);

  const mine = (s: Slot) => {
    const p = s.proposedBy;
    if (!p) return true;
    if (typeof p === 'string') return p === user?.id;
    return p.id === user?.id;
  };

  const doCancel = async () => {
    if (!cancelling) return;
    const r = reason.trim();
    if (r.length < 3) { setReasonErr('Give a reason (at least 3 characters). Booked students are told why.'); return; }
    try {
      const res = await cancel.mutateAsync({ id: cancelling.id, reason: r });
      toast.show(res.cancelledBookings ? `Slot cancelled. ${res.cancelledBookings} booking(s) cancelled and students notified.` : 'Slot cancelled', 'success');
      setCancelling(null); setReason(''); setReasonErr(null);
    } catch (e) { setReasonErr(errMessage(e)); }
  };

  const slots = [...(q.data ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return (
    <Page title="Interview slots" onBack={back} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} footer={canPropose ? <Button label="Propose a slot" icon="add" full onPress={() => setPropose(true)} /> : undefined}>
      {drive.data?.settings.autoAcceptSlotProposals ? null : <Banner tone="info" message="Slots you propose go live for students once a placement officer approves them." />}
      {q.isLoading ? <SkeletonList rows={3} height={120} /> : null}
      {q.isError ? <ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data && !slots.length ? <EmptyState icon="event-busy" title="No interview slots" message={canPropose ? 'Propose a slot so shortlisted students can book a time.' : 'No slots have been created for this drive.'} /> : null}
      {slots.map((s) => {
        const m = SLOT_META[s.status];
        const full = s.booked >= s.capacity;
        return (
          <Card key={s.id} style={{ gap: 8 }}>
            <Text variant="subhead" tabular>{formatDateTimeIST(s.startsAt)} to {formatTimeIST(s.endsAt)}</Text>
            <Text variant="caption" color={colors.muted}>{roundName.get(s.roundId) ?? 'Round'} | {s.mode === 'online' ? 'Online' : 'In person'}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Badge label={m.label} tone={m.tone} />
              <Badge label={`${s.booked} of ${s.capacity} booked`} tone={full ? 'warning' : 'neutral'} icon="event-seat" />
            </View>
            <Text variant="caption" color={colors.muted} selectable>{s.venueOrLink}</Text>
            {s.panel?.length ? <Text variant="caption" color={colors.muted}>Panel: {s.panel.map((p) => p.name).join(', ')}</Text> : null}
            {s.instructions ? <Text variant="caption" color={colors.muted}>{s.instructions}</Text> : null}
            {s.status === 'proposed' || s.status === 'open' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {isOfficer && s.status === 'proposed' ? (
                  <Button size="sm" label="Approve" icon="check" loading={approve.isPending && approve.variables === s.id} onPress={async () => { try { await approve.mutateAsync(s.id); toast.show('Slot approved', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); } }} />
                ) : null}
                {mine(s) || isOfficer ? <Button size="sm" variant="secondary" label="Cancel slot" icon="event-busy" onPress={() => { setReason(''); setReasonErr(null); setCancelling(s); }} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      {id ? <ProposeSheet driveId={id} visible={propose} onClose={() => setPropose(false)} /> : null}
      <Sheet visible={!!cancelling} onClose={() => { if (!cancel.isPending) setCancelling(null); }} title="Cancel this slot?">
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text variant="body">{cancelling ? `${formatDateTimeIST(cancelling.startsAt)}. ${cancelling.booked ? `${cancelling.booked} booked student(s) will be notified and their bookings cancelled.` : 'No one has booked it yet.'}` : ''}</Text>
          <TextField label="Reason (required)" value={reason} onChangeText={(t) => { setReason(t); setReasonErr(null); }} multiline maxLength={300} error={reasonErr} />
          <Button label="Cancel slot" variant="danger" full loading={cancel.isPending} onPress={doCancel} />
          <Button label="Keep slot" variant="ghost" full disabled={cancel.isPending} onPress={() => setCancelling(null)} />
        </View>
      </Sheet>
    </Page>
  );
}
