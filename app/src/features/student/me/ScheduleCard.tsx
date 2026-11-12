import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Badge, Banner, Button, Card, Icon, Text, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import type { Schedule } from '@/api/types';
import { addEventToCalendar } from '@/lib/calendar';
import { formatIST, sp } from './kit';

export function relativeFromNow(iso: string, offsetMs = 0): string {
  const diff = Date.parse(iso) - (Date.now() + offsetMs);
  if (!Number.isFinite(diff)) return '';
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  let span: string;
  if (min < 1) return 'starting now';
  if (min < 60) span = `${min} min`;
  else if (min < 60 * 24) { const h = Math.floor(min / 60); const m = min % 60; span = m && h < 6 ? `${h} h ${m} min` : `${h} h`; }
  else { const dd = Math.round(min / (60 * 24)); span = `${dd} day${dd === 1 ? '' : 's'}`; }
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

export function ScheduleCard({ schedule, company, role }: { schedule: Schedule; company: string; role: string }) {
  const toast = useToast();
  const [added, setAdded] = useState(false);
  const [denied, setDenied] = useState(false);
  const label = schedule.type === 'interview' ? 'Interview' : 'Assessment';
  const offset = getServerOffsetMs();
  const past = Date.parse(schedule.scheduledAt) < Date.now() + offset;
  const isLink = schedule.mode === 'online' && /^https?:\/\//i.test(schedule.venueOrLink);

  const openLink = async () => {
    try { await Linking.openURL(schedule.venueOrLink); }
    catch { toast.show('Could not open the link. Copy it from the placement cell message instead.', 'error'); }
  };

  const addToCalendar = async () => {
    setDenied(false);
    try {
      const r = await addEventToCalendar({
        title: `${label}: ${company} (${role})`,
        startISO: schedule.scheduledAt,
        location: schedule.venueOrLink,
        notes: [schedule.instructions, schedule.mode === 'online' ? `Link: ${schedule.venueOrLink}` : null].filter(Boolean).join('\n') || undefined,
      });
      if (r === 'added') { setAdded(true); toast.show('Added to your calendar', 'success'); }
      else if (r === 'denied') setDenied(true);
      else toast.show('No calendar on this device can accept events. Add a Google or device calendar first.', 'error');
    } catch {
      toast.show('Could not add the event. Please try again.', 'error');
    }
  };

  return (
    <Card>
      <View style={{ gap: sp.md }}>
        <View style={{ gap: sp.xs }}>
          <Text variant="subhead">{`${label} details`}</Text>
          <Badge label={past ? 'Past' : 'Upcoming'} tone={past ? 'neutral' : 'info'} icon={past ? 'history' : 'event'} />
        </View>
        <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
          <Icon name="schedule" size={22} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" color={colors.muted}>When</Text>
            <Text variant="body" tabular style={{ fontWeight: '600' }}>{formatIST(schedule.scheduledAt)}</Text>
            <Text variant="caption" color={colors.muted} tabular>{relativeFromNow(schedule.scheduledAt, offset)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
          <Icon name={schedule.mode === 'online' ? 'videocam' : 'place'} size={22} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" color={colors.muted}>{schedule.mode === 'online' ? 'Online' : 'In person'}</Text>
            {isLink ? (
              <Pressable onPress={openLink} accessibilityRole="link" accessibilityLabel="Open meeting link" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
                <Text variant="body" color={colors.info} style={{ textDecorationLine: 'underline' }} numberOfLines={3} ellipsizeMode="middle">{schedule.venueOrLink}</Text>
              </Pressable>
            ) : (
              <Text variant="body" selectable>{schedule.venueOrLink}</Text>
            )}
          </View>
        </View>
        {schedule.instructions ? (
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
            <Icon name="info-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption" color={colors.muted}>Instructions</Text>
              <Text variant="body">{schedule.instructions}</Text>
            </View>
          </View>
        ) : null}
        {isLink ? <Button label="Open link" variant="secondary" icon="open-in-new" full onPress={openLink} /> : null}
        {!past ? (
          <Button label={added ? 'Added to calendar' : 'Add to calendar'} icon={added ? 'check' : 'event'} variant="secondary" full disabled={added} onPress={addToCalendar} />
        ) : null}
        {denied ? (
          <Banner
            tone="warning"
            message="Calendar access was not allowed, so the event was not added. You can allow it in your phone settings and try again."
            action={{ label: 'Open settings', onPress: () => { Linking.openSettings().catch(() => undefined); } }}
          />
        ) : null}
      </View>
    </Card>
  );
}
