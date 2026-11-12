import React from 'react';
import { useRouter } from 'expo-router';
import { useFeatures } from '@/config/features';
import { RowGroup, type RowDef } from '@/features/student/me/kit';

/** Home shortcuts to the student extras. Each row shows only when its server feature is on. */
export function StudentShortcuts() {
  const router = useRouter();
  const { flags } = useFeatures();
  const go = (p: string) => () => router.push(p as never);
  const rows: RowDef[] = [];
  if (flags.opsCalendar) rows.push({ icon: 'event', title: 'Placement calendar', subtitle: 'Deadlines, tests and interviews in one list', onPress: go('/(student)/calendar') });
  rows.push({ icon: 'school', title: 'Prep hub', subtitle: 'Practice, mock interviews, resume builder', onPress: go('/(student)/prep') });
  if (flags.opsAnalytics) rows.push({ icon: 'insights', title: 'Campus placement stats', subtitle: 'Anonymous totals for your campus', onPress: go('/(student)/stats') });
  return <RowGroup rows={rows} />;
}
