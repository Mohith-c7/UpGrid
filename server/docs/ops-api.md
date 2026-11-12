# Placement Operations API (analytics, policy, restrictions, cohorts, announcements v2, calendar, company CRM, audit, documents)

Base `/api/v1`, `Authorization: Bearer <jwt>`. Errors `{error:{code,message,fields?}}`. Lists `{items,nextCursor}` (`?cursor=&limit=` 1-50, default 20, opaque offset cursor). All dates ISO-8601 UTC. Everything is tenant-scoped. **O** = officer only, **S** = student only, **A** = any signed-in user. Wrong role = 403 `FORBIDDEN`. Unknown ids / other tenant's ids = 404.

Common validation: unknown body fields are rejected (400 `VALIDATION_ERROR` with `fields`). Free text is trimmed, control characters rejected.

---------------------------------------------------------------------------------------------------
## 1. Analytics (O) — `routes/analytics.ts`
Filters on every analytics endpoint: `batch=2026` (int), `department=Computer Science` (case-insensitive), `from=2026-08-01`, `to=2026-11-30` (ISO date/datetime; applied to application submit time; students are not date-filtered). Invalid filter = 400.

### GET /analytics/dashboard
```
{ filters:{batch,department,from,to},
  kpis:{ students, profileCompletePct, avgProfileCompletionPct, verifiedPct,
         drivesOpen, drivesClosed, drivesDraft,
         applications,                      // non-withdrawn applications
         eligibleVsApplied:{ eligibleSlots, appliedSlots, appliedOfEligiblePct },  // (student,drive) pairs over published drives
         selected:{ applications, students },   // reached "selected" at any time
         offers:{ applications, students },     // reached "offer_issued"
         accepted:{ applications, students },   // reached "offer_accepted"
         joined:{ applications, students } },   // reached "joined"
  generatedAt }
```
Selection, offer, acceptance and joining are always separate numbers (never merged). Percentages are 0-100 with 1 decimal; `null` when the denominator is 0.

### GET /analytics/placement
```
{ filters, totals:{ students, placedStudents, placedPct, offeredStudents, offersIssued, offersPerStudent },
  ctc:{ highestLpa, averageLpa, medianLpa, count },       // best accepted annual CTC per placed student, LPA; stipend drives excluded
  byBranch:[{ department, students, placed, placedPct, avgLpa, highestLpa }],
  byBatch:[{ batchYear, students, placed, placedPct, avgLpa, highestLpa }],
  byCompany:[{ company, hires, avgLpa, highestLpa }],
  ctcBands:[{ label:"0-5", minLpa, maxLpa, count }, ...] }   // 0-5,5-8,8-12,12-20,20+
```
### GET /analytics/funnel[?driveId=uuid]
`{ driveId|null, stages:[{key:'applied'|'screening'|'assessment'|'interview'|'selected'|'offer_issued'|'offer_accepted'|'joined', label, count, pctOfApplied}], rejected, withdrawn }` ("reached" semantics, from the append-only events).
### GET /analytics/drives
`{ items:[{ id, company, role, status, deadline, publishedAt, completenessScore(0-100), completenessGaps:[key], eligibleCount, applied, appliedOfEligiblePct, deadlineMissEstimate, medianHoursToApply, selected, offers, accepted, joined }] }` — `deadlineMissEstimate` = eligible students who never applied to a drive whose deadline has passed (0 for open drives).
### GET /analytics/reminders
`{ byKind:[{kind:'t60'|'t30'|'t15'|'sched60', pending,sent,cancelled,skipped, total}], deliveryRatePct, pushDevices }`
### GET /analytics/workload
`{ officers:[{ id, name, statusChanges30d, drivesCreated, pendingDocuments, openTickets? }], unassigned:{ applicationsAwaitingScreening, documentsPending, openTickets } }`
### GET /analytics/export?dataset=drives|branches|batches|companies|funnel|students&format=csv|json
CSV is UTF-8 BOM + CRLF, formula-injection safe (cells starting `= + - @` get a leading `'`). `Content-Disposition: attachment; filename=analytics-<dataset>.csv`. JSON = `{dataset, generatedAt, rows:[...]}`. `students` dataset has no phone/email (aggregate-safe columns: department, batch, cgpa band, placed). Audited as `analytics.export`.
### GET /analytics/report-pack
Structured data for the app's PDF: `{ meta:{tenantName,generatedAt,filters}, dashboard, placement, funnel, drives:[…], reminders }` (each section has the shape above). Audited.

### GET /stats/public (A — student or officer)
Anonymised aggregates; every group (branch/batch) with fewer than `k` students (k = tenant setting `publicStatsMinGroup`, never below 5) is suppressed and counted in `suppressedGroups`; CTC figures need at least k placed students overall. When the tenant setting is off: `200 {enabled:false}`.
`{ enabled:true, minGroupSize, totals:{students,placedPct}, byBranch:[{department,students,placedPct}], byBatch:[{batchYear,students,placedPct}], ctc:{averageLpa,medianLpa,highestLpa}|null, suppressedGroups }`

### GET /ops/settings (O) · PUT /ops/settings (O)
`{ publicStatsEnabled:false, publicStatsMinGroup:5 (5-100), restrictionApproval:'required'|'not_required' (default required), policyApproval:'required'|'not_required' (default not_required) }`. PUT partial. Audited `settings.update`.

---------------------------------------------------------------------------------------------------
## 2. Policy engine (O) — `routes/policy.ts`, logic `src/policy/*`
### Policy JSON (validated, strict)
```
{ "schemaVersion":1,
  "oneOffer":{ "enabled":true },
  "tiers":{ "enabled":false, "dreamMinLpa":10, "superDreamMinLpa":20 },     // super > dream
  "upgrade":{ "enabled":false, "multiplier":1.5 },                        // 1.1 - 5
  "defaults":{ "minCgpa":null, "maxActiveBacklogs":null, "maxGapYears":null, "min10th":null, "min12th":null },  // fill criteria a drive does not set
  "requireVerifiedAcademics":false,
  "notes":"" }
```
Semantics: with `oneOffer`, a student holding an accepted offer (`offer_accepted`/`joined`) is `not_eligible` for other drives unless (a) `upgrade.enabled` and drive CTC >= multiplier × best accepted CTC, or (b) `tiers.enabled` and the drive's tier (regular < dream < super_dream by total CTC) is higher than the student's best tier. `defaults` apply only where the drive's own rules omit that criterion. `requireVerifiedAcademics` turns "met but unverified" criteria into `pending`.
Active policy is also written to `tenant_settings.policy` (+ `_meta:{policyId,versionId,version,name,effectiveFrom}`) on activation. Server code: `getActivePolicy(db, tenantId)` from `src/policy/store.ts`.

### Templates — GET /policy/templates
`{items:[{id:'one-offer'|'dream-super-dream'|'upgrade-1-5x'|'upgrade-2x'|'cgpa-backlog-defaults', name, description, policy}]}`
### Policies & versions
- `GET /policy/policies` → `{items:[{id,name,description,activeVersion:{id,version,status}|null,latestVersion,updatedAt}]}`
- `POST /policy/policies {name, description?, templateId?, policy?}` → 201 `{policy:{…}, version:{…draft v1}}` (policy body overrides template; default = `one-offer` empty defaults). Audited `policy.create`.
- `GET /policy/policies/:id` → `{policy, versions:[{id,version,status,effectiveFrom,note,createdBy,approvedBy,activatedAt,createdAt}]}`; `GET /policy/versions/:vid` → `{version:{…, policy:{…json}}}`
- `POST /policy/policies/:id/versions {policy?, effectiveFrom?, note?}` → 201 new draft version (clone of latest if `policy` omitted).
- `PUT /policy/versions/:vid {policy?, effectiveFrom?, note?}` drafts only (409 `VERSION_NOT_DRAFT`).
- `POST /policy/versions/:vid/approve` → status `approved`. Approval by the author is 403 `SELF_APPROVAL` when tenant `policyApproval='required'`. 
- `POST /policy/versions/:vid/activate {}` → requires `approved` (or `draft` when `policyApproval='not_required'`; else 422 `APPROVAL_REQUIRED`). If `effectiveFrom` is in the future the version becomes `scheduled` and takes effect at that time; otherwise it becomes `active` and supersedes the previous active version. Returns `{version, active:boolean}`. **Existing applications are never rewritten**; each application keeps the policy version in its snapshot.
- `POST /policy/policies/:id/rollback {toVersionId, note?}` → clones that earlier version as a new version and activates it (history is kept) → 201 `{version}`.
- `POST /policy/policies/:id/clone {name}` → 201 new policy with a draft v1 copied from the latest version.
- `GET /policy/active` → `{policy:{json}|null, version:{id,version,policyId,name,effectiveFrom}|null}`
- `POST /policy/validate-draft {policy}` → `200 {valid:boolean, errors:[{path,message}], warnings:[string], normalized:{…}|null}` (never 4xx for invalid policy content; used by the AI module).
- `POST /policy/validate-conditions {conditions}` → `200 {valid, errors:[{path,message}]}`.
### Simulation — POST /policy/simulate
Body `{draft?:policyJson, versionId?:uuid, driveId?:uuid}` (exactly one of draft/versionId). Without `driveId` all open drives are simulated. No writes. Response:
```
{ against:{ currentVersion|null, candidate:'draft'|versionId }, drives:n,
  current:{ eligible, notEligible, pending, restricted }, candidate:{ …same },
  perReason:[{ criterion, failed, missing }],           // candidate
  diff:{ newlyEligible, newlyIneligible, newlyPending, unchanged },
  samples:{ newlyIneligible:[{studentId,name,driveId,reason}], newlyEligible:[…] } }   // max 5 each
```
### Drive conditions (`extra`)
A drive's `rules` accepts an `extra` condition tree (PUT /drives/:id): leaf `{field,op,value}`, `{all:[…]}` (AND), `{any:[…]}` (OR), `{not:{…}}`. Fields: `cgpa` (10-scale), `tenthPercent`, `twelfthPercent`, `activeBacklogs`, `gapYears`, `semester`, `batchYear`, `department`, `program`, `city`, `state`, `skills`(array), `hasAcceptedOffer`, `acceptedOfferLpa`, `academicsVerified`. Ops: `eq neq gt gte lt lte between in nin contains exists notExists`. Missing data = unknown: AND/OR/NOT follow three-valued logic; unknown makes the student `pending` with a reason. Max depth 6, 50 nodes. Offer fields are only known on the apply/preview path (lists treat them as missing).
### GET /policy/evaluations?studentId=&driveId=&cursor=
Stored evaluations (written at apply): `{items:[{id,studentId,driveId,policyVersionId,status,reasons,context,createdAt}]}`.

---------------------------------------------------------------------------------------------------
## 3. Restrictions — `routes/policyRestrictions.ts`
Scope: `student` (scopeValue = student id; all drives) · `company` (scopeValue = company name; optional `studentId` narrows to one student) · `drive` (scopeValue = drive id; optional `studentId`) · `department` (scopeValue) · `batch` (scopeValue = year) · `tenant` (everyone, all drives).
Status: `pending_approval` → `active` | `rejected`; `active` → `lifted`; active past `endsAt` is reported as `expired` (computed). Only active restrictions inside `[startsAt, endsAt)` are enforced.
### Officer
- `POST /restrictions {scope, scopeValue?, studentId?, reason (internal 3-500), studentMessage (shown to student, 5-300), evidenceNotes? (<=2000, officer-only), startsAt?, endsAt?}` → 201 `{restriction}`. Status `pending_approval`, or `active` straight away if tenant `restrictionApproval='not_required'`. `endsAt` must be after `startsAt`.
- `GET /restrictions?status=&scope=&studentId=&cursor=` → `{items:[restrictionDto]}`
- `GET /restrictions/:id` → `{restriction, history:[{id,type,actorId,actorName,note,createdAt}], appeals:[…]}`
- `PUT /restrictions/:id` (pending only) edit fields.
- `POST /restrictions/:id/approve {note?}` → active. Requester == approver = 403 `SELF_APPROVAL`. Not pending = 409 `NOT_PENDING`.
- `POST /restrictions/:id/reject {note}` · `POST /restrictions/:id/lift {reason}` (active only, 409 `NOT_ACTIVE`).
- `GET /restrictions/appeals?status=pending` → `{items:[{id,restrictionId,studentId,studentName,message,status,createdAt,restriction:{scope,studentMessage}}]}` (declared **before** `/:id`).
- `POST /restrictions/appeals/:appealId/decide {decision:'uphold'|'overturn', note}` — overturn exempts that student from the restriction (and notifies them); uphold keeps it. 409 `APPEAL_DECIDED` if already decided.
`restrictionDto = {id,scope,scopeValue,studentId,reason,studentMessage,evidenceNotes,status,effectiveStatus,startsAt,endsAt,requestedBy,approvedBy,approvedAt,liftedBy,liftedAt,liftReason,exemptStudentIds,createdAt}`
### Student
- `GET /my/restrictions` → `{items:[{id,scope,message,startsAt,endsAt,canAppeal,appeal:{id,status,decisionNote}|null,appealPath}]}` (active restrictions that apply to the caller; no internal reason / evidence).
- `POST /my/restrictions/:id/appeal {message 10-1000}` → 201 `{appeal}`; 409 `APPEAL_EXISTS` when a pending appeal exists; 404 if the restriction does not apply to the caller. Officers are notified.
### Effect on eligibility
Drive lists/details show `eligibility:{status:'restricted', reason}` for restricted students; `POST /drives/:id/application/preview` returns `canApply:false` and `blockedReason`; `POST /drives/:id/apply` → **422 `RESTRICTED`** `{message:"<respectful reason>. You can appeal from Profile > Restrictions.", fields:{restrictionId, appealPath:"/my/restrictions/<id>/appeal"}}`.
Server code: pure `getActiveRestrictions(student, drive, restrictions, now)` in `src/policy/restrictions.ts`.

---------------------------------------------------------------------------------------------------
## 4. Cohorts (O) — `routes/opsCohorts.ts`
`cohort = {id,name,description,kind:'dynamic'|'fixed',filter,memberCount,createdAt,updatedAt}`
Dynamic filter (all optional, AND-combined): `{departments:[str], batches:[int], minCgpa, maxCgpa, maxActiveBacklogs, verified:boolean, placement:'placed'|'unplaced'|'offered', appliedToDriveId, notAppliedToDriveId, registrationPrefix}`.
- `GET /cohorts` · `POST /cohorts {name, description?, kind, filter?, studentIds?}` (fixed uses `studentIds`) → 201 `{cohort}`
- `GET /cohorts/:id` · `PUT /cohorts/:id {name?,description?,filter?}` · `DELETE /cohorts/:id` (409 `COHORT_IN_USE` if a scheduled announcement uses it)
- `GET /cohorts/:id/members?cursor=` → `{items:[{id,name,registrationNumber,department,batchYear,cgpa}],nextCursor,total}`
- `PUT /cohorts/:id/members {add?:[uuid],remove?:[uuid]}` fixed only (409 `COHORT_NOT_FIXED`)
- `POST /cohorts/preview {kind,filter,studentIds?}` → `{count, sample:[{id,name,department,batchYear}]}`
Server: `resolveCohort(db, cohortId, tenantId?) → Promise<string[]>` (user ids) from `src/policy/cohorts.ts`.

---------------------------------------------------------------------------------------------------
## 5. Announcements v2 — `routes/opsAnnouncements.ts` (base `/announcements-v2`; the old `/announcements` keeps working)
`announcement = {id,title,body,status:'draft'|'scheduled'|'sent',audience,sendAt,sentAt,pinned,expiresAt,channels:{inApp,push,email},templateId,recipients,delivered,read,createdAt}`
`audience = {type:'all'} | {type:'cohort',cohortId} | {type:'drive_participants',driveId} | {type:'eligible_not_applied',driveId}`
- O `POST /announcements-v2 {title 1-100, body 1-2000, audience, channels?{inApp=true,push=true,email=false}, sendAt? , pinned?=false, expiresAt?, templateId?, draft?=false}` → 201. `sendAt` omitted + not `draft:true` = send now (status `sent` in the response, synchronous); `sendAt` in the future = `scheduled`; `draft:true` = `draft`. `sendAt` in the past = 400.
- O `GET /announcements-v2?status=&cursor=` · `GET /announcements-v2/:id` (includes `audienceCount` preview when not sent)
- O `PUT /announcements-v2/:id` (draft/scheduled only, else 409 `ALREADY_SENT`) · `DELETE /announcements-v2/:id` (draft/scheduled → deleted; sent → 409 `ALREADY_SENT`) · `POST /announcements-v2/:id/send` (send now, idempotent)
- O `POST /announcements-v2/:id/pin {pinned:boolean}` (allowed on sent)
- Templates (O): `GET /announcement-templates` · `POST /announcement-templates {name,title,body}` · `DELETE /announcement-templates/:id`
- S `GET /announcements-v2/feed?cursor=` → `{items:[{id,title,body,pinned,sentAt,expiresAt,read}]}` pinned first, expired hidden.
- S `POST /announcements-v2/:id/read` → `{ok:true}` idempotent. Officer sees `delivered`/`read` counts.
Delivery: a worker (every 30 s, `FOR UPDATE SKIP LOCKED`) sends due scheduled rows exactly once (unique `(announcement_id,user_id)` delivery rows). In-app = row in `notifications` (type `announcement`, `data.announcementId`), push via the existing push sender, email via `sendMail` of the mail module if present, otherwise recorded as `email_status='no_mailer'` (hook `setAnnouncementMailer(fn)`).

---------------------------------------------------------------------------------------------------
## 6. Calendar — `routes/opsCalendar.ts`
- A `GET /calendar?from=&to=` (default now .. +30d, max 92 days) → `{items:[{id,kind:'deadline'|'test'|'interview'|'assessment'|'offer_expiry'|'drive_closing'|'attendance',title,startsAt,endsAt|null,driveId|null,applicationId|null,refId,detail,link}]}` sorted by `startsAt`. Student: own application deadlines (open drives they are eligible for or applied to), own interviews/assessments, tests, offer expiries. Officer: drive closings, all scheduled interviews/assessments, tests, attendance sessions. Tables from other modules are probed with `to_regclass` + column checks and skipped when absent.
- A `POST /calendar/feed-token` → 201 `{token, url:"/api/v1/calendar.ics?token=…"}` (plaintext shown once; replaces any previous token) · A `GET /calendar/feed-token` → `{active:boolean,createdAt}` · A `DELETE /calendar/feed-token` → `{ok:true}` revokes.
- Public `GET /calendar.ics?token=` → `text/calendar` (next 60 days back 7). Invalid/revoked = 404 `NOT_FOUND`. Mounted before the authenticated routers (in `app.ts`, `opsPublicRouter`).

---------------------------------------------------------------------------------------------------
## 7. Company CRM — `routes/opsCompanies.ts`
`company = {id,name,website,industry,hq,contacts:[{name,role,email,phone}],notes,tags:[str],verified,logoFileId,stage:'prospect'|'contacted'|'interested'|'mou'|'hiring',createdAt,updatedAt,driveCount,lastInteractionAt,nextFollowUpAt}`
- O `GET /crm/companies?q=&stage=&tag=&verified=&cursor=` · `POST /crm/companies {name, website?, industry?, hq?, contacts?, notes?, tags?, verified?, logoFileId?, stage?, force?}` → 201. Duplicate (same normalised name or same website host) = 409 `DUPLICATE_COMPANY` with `fields:{existingId}` unless `force:true`.
- O `GET /crm/companies/duplicates` → `{groups:[{key,companies:[{id,name,website}]}]}` · `GET /crm/companies/export` (CSV, injection-safe) · `GET /crm/follow-ups?days=14` → upcoming interactions' follow-ups.
- O `GET /crm/companies/:id` (adds `drives:[…]`) · `PUT /crm/companies/:id` · `DELETE /crm/companies/:id` · `POST /crm/companies/:id/stage {stage, note?}`
- O `GET|POST /crm/companies/:id/interactions` body `{type:'call'|'meeting'|'email'|'other', occurredAt, summary 3-2000, followUpAt?}` · `PUT /crm/companies/:id/interactions/:iid` (summary/followUpAt/followUpDone)
- O `POST /crm/companies/:id/drives {driveId}` link · `DELETE /crm/companies/:id/drives/:driveId`
- S/O `GET /company-directory?q=&cursor=` → verified or hiring companies only, public fields: `{id,name,website,industry,hq,logoFileId,verified,pastVisits:{count,lastVisitAt}}`
- S/O `GET /company-directory/:id` → public fields + `roles:[titles]`, `ctcRange:{minLpa,maxLpa,drives}` (annual CTC aggregated over past/closed drives; never individual offers or contacts/notes).

---------------------------------------------------------------------------------------------------
## 8. Audit log (O) — `routes/opsAudit.ts`
`GET /audit?actorId=&entityType=&entityId=&action=&from=&to=&q=&cursor=&limit=` → `{items:[{id,actorId,actorName,action,entityType,entityId,meta,createdAt}],nextCursor}` newest first. `action` matches exactly or by prefix with a trailing `*` (`policy.*`). `GET /audit/actions` → `{items:[action]}`. `GET /audit/export?format=csv|json&…same filters` (max 5000 rows; audited as `audit.export`).
Sensitive masking: meta keys matching `password|token|secret|hash|otp|authorization` => `"***"`; `email` and `phone` values are partially masked (`a***@example.com`, `98******10`). Entries written: policy.*, restriction.*, appeal.*, cohort.*, announcement.*, company.*, document.verify/reject, settings.update, analytics.export, audit.export, students.import (existing), plus any module calling `recordAudit()` from `src/policy/audit.ts` (offers, overrides, invites).

---------------------------------------------------------------------------------------------------
## 9. Document verification — `routes/opsDocuments.ts`
`doc = {id,studentId,docType:'marksheet'|'id_proof'|'resume'|'certificate'|'offer_letter'|'other',label,fileId|null,url|null,status:'pending'|'verified'|'rejected',rejectReason,reviewedBy,reviewedAt,createdAt}`
- S `POST /documents {docType,label 2-80, fileId? | url?}` (exactly one; url https; fileId must exist in the files module when it is installed) → 201 `{document}` · S `GET /documents/mine` → `{items,completion:{required:[docType],verified:[docType],percent}}` (required = marksheet, id_proof, resume) · S `DELETE /documents/:id` (409 `DOCUMENT_VERIFIED` once verified)
- O `GET /documents/queue?status=pending&docType=&q=&cursor=` → items include `student:{id,name,registrationNumber,department}`
- O `POST /documents/:id/verify {note?}` · `POST /documents/:id/reject {reason 3-300}` · `POST /documents/bulk-verify {ids:[<=100]}` → `{verified:n,skipped:[{id,reason}]}`
Verification writes `profiles.verification["documents.<docType>"]='verified'` (removed on reject), notifies the student (`type:'document'`), and is audited.

---------------------------------------------------------------------------------------------------
## Notes for integrators
- `opsRouter` is mounted in `app.ts` **before** `officerRouter` (which gates every path under `/` to officers); routes of other modules that students/recruiters call must be mounted before it too.
- Seed: `npm run seed` also loads demo analytics data (28 students over 4 branches, ~50 applications), an active policy, one active + one pending restriction, 2 cohorts, 7 CRM companies, a scheduled-stats setting (`publicStatsEnabled: true`).
- Eligibility statuses returned to students are now `eligible | not_eligible | pending | restricted`.
- `rules.extra` is stored with the drive and shown to officers; students see only the generated reasons.
- Offer/assessment/attendance data from other modules is read defensively: calendar expects `offers(tenant_id, application_id, expires_at, status?)`, `assessments(tenant_id, title|name, starts_at|opens_at|start_at, ends_at?, status?)` (+ optional `assessment_assignments(assessment_id, user_id)` to restrict a student's view), `attendance_sessions(tenant_id, title|name, starts_at|start_at)`. Analytics derive offers/acceptance from `applications` + `application_events` (the status machine), not from the pipeline's offers table.
