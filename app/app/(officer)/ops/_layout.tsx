import { Stack } from 'expo-router';

/** Officer operations: analytics, policy, restrictions, cohorts, announcements, calendar, CRM, audit, documents, settings. */
export default function OpsLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150 }} />;
}
