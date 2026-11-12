import { Router } from 'express';
import { authenticate, Deps } from '../context';
import { analyticsRouter } from './analytics';
import { policyRouter } from './policy';
import { restrictionRouter } from './policyRestrictions';
import { cohortRouter } from './opsCohorts';
import { announcementV2Router } from './opsAnnouncements';
import { calendarRouter, icsHandler } from './opsCalendar';
import { companyRouter } from './opsCompanies';
import { auditRouter } from './opsAudit';
import { documentRouter } from './opsDocuments';
import { registerFeatureFlags } from '../features';

registerFeatureFlags(() => ({ opsAnalytics: true, opsPolicy: true, opsRestrictions: true, opsCohorts: true, opsAnnouncementsV2: true, opsCalendar: true, opsCompanyCrm: true, opsAudit: true, opsDocuments: true }));

/** Public (token) routes of the operations module. Mount BEFORE routers that authenticate everything under '/'. */
export function opsPublicRouter(deps: Deps) {
  const r = Router();
  r.get('/calendar.ics', icsHandler(deps));
  return r;
}

/** Authenticated operations routes. Authentication is scoped to this module's path prefixes so other routes are unaffected. */
export function opsRouter(deps: Deps) {
  const r = Router();
  r.use(['/analytics', '/stats', '/ops', '/policy', '/restrictions', '/my', '/cohorts', '/announcements-v2', '/announcement-templates', '/calendar', '/crm', '/company-directory', '/audit', '/documents'], authenticate(deps));
  for (const sub of [analyticsRouter, policyRouter, restrictionRouter, cohortRouter, announcementV2Router, calendarRouter, companyRouter, auditRouter, documentRouter]) r.use(sub(deps));
  return r;
}
