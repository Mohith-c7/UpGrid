import * as Calendar from 'expo-calendar';

export type AddToCalendarResult = 'added' | 'denied' | 'no_calendar';

/** Adds a one-hour event. Never throws for permission problems: returns 'denied' / 'no_calendar'. */
export async function addEventToCalendar(e: {
  title: string; startISO: string; durationMinutes?: number; location?: string; notes?: string;
}): Promise<AddToCalendarResult> {
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (!perm.granted) return 'denied';
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = cals.filter((c) => c.allowsModifications);
  const target = writable.find((c) => c.isPrimary) ?? writable[0];
  if (!target) return 'no_calendar';
  const start = new Date(e.startISO);
  const end = new Date(start.getTime() + (e.durationMinutes ?? 60) * 60000);
  await Calendar.createEventAsync(target.id, {
    title: e.title, startDate: start, endDate: end, timeZone: 'Asia/Kolkata',
    location: e.location, notes: e.notes, alarms: [{ relativeOffset: -60 }],
  });
  return 'added';
}
