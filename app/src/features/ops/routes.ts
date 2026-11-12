import type { IconName } from '@/ui';

export const OPS_ROUTES: { key: string; path: string; title: string; subtitle: string; icon: IconName }[] = [
  { key: 'analytics', path: '/(officer)/ops/analytics', title: 'Analytics', subtitle: 'Placement numbers, funnel, drives, reminders', icon: 'insights' },
  { key: 'policy', path: '/(officer)/ops/policy', title: 'Placement policy', subtitle: 'Versions, simulation and activation', icon: 'gavel' },
  { key: 'restrictions', path: '/(officer)/ops/restrictions', title: 'Restrictions and appeals', subtitle: 'Approve, lift and decide appeals', icon: 'block' },
  { key: 'cohorts', path: '/(officer)/ops/cohorts', title: 'Cohorts', subtitle: 'Student groups for announcements', icon: 'groups' },
  { key: 'announcements', path: '/(officer)/ops/announcements', title: 'Announcements', subtitle: 'Schedule, pin and track reads', icon: 'campaign' },
  { key: 'calendar', path: '/(officer)/ops/calendar', title: 'Calendar', subtitle: 'Deadlines, interviews and a calendar feed link', icon: 'event' },
  { key: 'companies', path: '/(officer)/ops/companies', title: 'Company CRM', subtitle: 'Contacts, outreach stage and interactions', icon: 'business' },
  { key: 'audit', path: '/(officer)/ops/audit', title: 'Audit log', subtitle: 'Who changed what, with export', icon: 'history' },
  { key: 'documents', path: '/(officer)/ops/documents', title: 'Document verification', subtitle: 'Review student documents', icon: 'fact-check' },
  { key: 'settings', path: '/(officer)/ops/settings', title: 'Operations settings', subtitle: 'Approval rules and public statistics', icon: 'tune' },
];
