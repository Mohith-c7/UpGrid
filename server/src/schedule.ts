import type { Db } from './db';

export interface ScheduleDto {
  type: 'assessment' | 'interview';
  scheduledAt: string;
  mode: 'online' | 'in_person';
  venueOrLink: string;
  instructions: string | null;
}

export const scheduleDto = (r: any): ScheduleDto => ({
  type: r.type,
  scheduledAt: new Date(r.scheduled_at).toISOString(),
  mode: r.mode,
  venueOrLink: r.venue_or_link,
  instructions: r.instructions ?? null,
});

/** Latest (live) schedule of an application, or null. */
export async function latestSchedule(db: Db, applicationId: string): Promise<ScheduleDto | null> {
  const r = await db.query(
    `SELECT type, scheduled_at, mode, venue_or_link, instructions FROM application_schedules
      WHERE application_id=$1 ORDER BY (superseded_at IS NULL) DESC, created_at DESC, id LIMIT 1`,
    [applicationId],
  );
  return r.rows[0] ? scheduleDto(r.rows[0]) : null;
}
