import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Icon, KeyValueList, SectionHeader, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { formatTimeIST } from '@/lib/format';
import { pipeCode, pipeError, useAppRounds, useAppSlots, useBookSlot, useCancelBooking } from '@/api/pipeline';
import type { StudentSlot } from '@/api/pipelineTypes';
import { Boundary, confirm, formatIST, Page, ReasonSheet, sp, useOnce } from '@/features/pipeline/kit';

const REFRESH_CODES = ['SLOT_FULL', 'SLOT_NOT_OPEN', 'SLOT_NOT_FOUND', 'SLOT_STARTED'];

export default function SlotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = String(id);
  const router = useRouter();
  const toast = useToast();
  const q = useAppSlots(appId);
  const rounds = useAppRounds(appId);
  const book = useBookSlot(appId);
  const cancel = useCancelBooking(appId);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const booking = q.data?.booking ?? null;
  const slots = q.data?.items ?? [];
  const roundName = (rid: string) => rounds.data?.find((r) => r.roundId === rid)?.name ?? slots.find((s) => s.roundId === rid)?.roundName ?? 'Interview';
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(student)/application/${appId}` as never));

  const [doBook] = useOnce(async (slot: StudentSlot) => {
    setError(null);
    setBookingId(slot.id);
    try {
      const r = await book.mutateAsync(slot.id);
      toast.show(r.replayed ? 'You already booked this slot.' : 'Slot booked. It is added to your schedule.', 'success');
    } catch (e) {
      setError(pipeError(e));
      if (REFRESH_CODES.includes(pipeCode(e) ?? '')) void q.refetch();
    } finally { setBookingId(null); }
  });
  const askBook = (s: StudentSlot) =>
    confirm('Book this slot?', `${s.roundName}\n${formatIST(s.startsAt)} to ${formatTimeIST(s.endsAt)} IST`, 'Book slot', () => { void doBook(s); }, false);

  const [doReschedule, rescheduling] = useOnce(async () => {
    if (!booking) return;
    setError(null);
    try {
      await cancel.mutateAsync({ roundId: booking.roundId });
      toast.show('Booking released. Pick a new slot below.', 'info');
    } catch (e) { setError(pipeError(e)); }
  });

  const byRound = new Map<string, StudentSlot[]>();
  for (const s of slots) byRound.set(s.roundId, [...(byRound.get(s.roundId) ?? []), s]);

  return (
    <Page title="Interview slots" onBack={back} onRefresh={() => { void q.refetch(); void rounds.refetch(); }} refreshing={q.isRefetching}>
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={120}>
        {error ? <Banner tone="error" title="Could not complete that" message={error} /> : null}

        {booking ? (
          <View style={{ gap: sp.md }}>
            <SectionHeader title="Your booking" />
            <Card tinted>
              <View style={{ gap: sp.md }}>
                <Badge label="Booked" tone="success" icon="event-available" />
                <Text variant="subhead">{roundName(booking.roundId)}</Text>
                <KeyValueList inline items={[
                  { label: 'Starts', value: formatIST(booking.startsAt) },
                  { label: 'Ends', value: `${formatTimeIST(booking.endsAt)} IST` },
                  { label: 'Mode', value: booking.mode === 'online' ? 'Online' : 'In person' },
                  { label: booking.mode === 'online' ? 'Link' : 'Venue', value: booking.venueOrLink ?? null },
                ]} />
                {booking.mode === 'online' && booking.venueOrLink?.startsWith('https://') ? (
                  <Button label="Open meeting link" variant="secondary" icon="open-in-new" full
                    onPress={() => { Linking.openURL(booking.venueOrLink!).catch(() => toast.show('Could not open the link', 'error')); }} />
                ) : null}
                <Button label="Reschedule" variant="secondary" icon="event-repeat" full loading={rescheduling}
                  onPress={() => confirm('Reschedule this booking?', 'Your current slot is released straight away and someone else may take it. Then you can pick a new slot.', 'Release and choose another', () => { void doReschedule(); })} />
                <Button label="Cancel booking" variant="danger" icon="event-busy" full disabled={rescheduling} onPress={() => setCancelOpen(true)} />
                <Text variant="caption" color={colors.muted}>Cancelling is allowed until a cut-off before the start time. After that, contact the placement cell.</Text>
              </View>
            </Card>
          </View>
        ) : null}

        <View style={{ gap: sp.md }}>
          <SectionHeader title="Open slots" subtitle={booking ? 'Release your booking to choose a different slot' : 'Times are in IST'} />
          {slots.length === 0 ? (
            <Card>
              <View style={{ gap: sp.sm, alignItems: 'flex-start' }}>
                <Icon name="event-busy" size={24} color={colors.muted} />
                <Text variant="subhead">No open slots right now</Text>
                <Text variant="body" color={colors.muted}>{booking ? 'There are no other open slots for your rounds.' : 'When the placement cell or the company opens slots for your round, they appear here and you get a notification.'}</Text>
              </View>
            </Card>
          ) : null}
          {[...byRound.entries()].map(([rid, list]) => (
            <View key={rid} style={{ gap: sp.sm }}>
              <Text variant="overline" color={colors.muted}>{roundName(rid)}</Text>
              {list.map((s) => (
                <Card key={s.id}>
                  <View style={{ gap: sp.sm }}>
                    <Text variant="subhead" tabular>{formatIST(s.startsAt)}</Text>
                    <Text variant="caption" color={colors.muted} tabular>{`Ends ${formatTimeIST(s.endsAt)} IST`}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                      <Badge label={s.mode === 'online' ? 'Online' : 'In person'} tone="info" icon={s.mode === 'online' ? 'videocam' : 'place'} />
                      <Badge label={s.remaining === 1 ? '1 seat left' : `${s.remaining} seats left`} tone={s.remaining <= 1 ? 'warning' : 'neutral'} icon="event-seat" />
                    </View>
                    {s.venueOrLink ? <Text variant="body" color={colors.textSecondary}>{s.venueOrLink}</Text> : null}
                    {s.instructions ? <Text variant="caption" color={colors.muted}>{s.instructions}</Text> : null}
                    <Button label="Book this slot" full disabled={!!booking || rescheduling || (bookingId !== null && bookingId !== s.id)} loading={bookingId === s.id} onPress={() => askBook(s)} />
                  </View>
                </Card>
              ))}
            </View>
          ))}
        </View>
      </Boundary>

      <ReasonSheet
        visible={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this booking?" required={false} label="Reason"
        description="Your slot is released and the panel is told. You can book another open slot afterwards."
        confirmLabel="Cancel booking"
        onSubmit={async (reason) => {
          if (!booking) { setCancelOpen(false); return; }
          const r = await cancel.mutateAsync({ roundId: booking.roundId, reason: reason || undefined });
          setCancelOpen(false);
          toast.show(r.cancelled ? 'Booking cancelled' : 'Nothing to cancel', 'success');
        }}
      />
    </Page>
  );
}
