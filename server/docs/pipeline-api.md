# Hiring pipeline + Recruiter API (module: pipeline, migrations 020-024)

Base path `/api/v1`, JSON, `Authorization: Bearer <access JWT>` unless marked **public**.
Errors: `{error:{code,message,fields?}}` (400 validation, 401, 403, 404, 409, 422, 429). Lists: `{items,nextCursor}`, `?cursor=&limit=` (1-50, default 20). Dates ISO-8601 UTC. All ids are UUIDs. Every query is tenant-scoped; ids from another tenant are `404`.
Feature flag: `features.recruiter = true` (via `registerFeatureFlags`).

## 0. Roles and access model

Roles: `student`, `officer`, `recruiter` (`user.role`). Recruiters are **never** created by `POST /auth/register` (`role:'recruiter'` -> 400). An officer invites them per drive.

Recruiter permissions (`company_recruiters.permissions`, all default `true`, officer edits per member):
`viewCandidates, shortlist, notes, scorecards, proposeSlots, proposeOutcomes, proposeOffers, uploadResults, markAttendance, message`.
A recruiter can only touch drives where they hold an **active** membership (not revoked). Anything else is `404 DRIVE_NOT_FOUND` (drive id) or `404 CANDIDATE_NOT_FOUND`. Missing permission -> `403 PERMISSION_DENIED` (`fields.permission` names it).

Candidate data for recruiters is limited to the **shared-field snapshot** taken at apply time: `name, email, phone, registrationNumber, department, program, batchYear, cgpa, tenthPercent, twelfthPercent, activeBacklogs, gapYears, linkedin` (exactly the fields the student saw on the apply review sheet), plus the resume the student chose and answers to the drive's questions. Never the live profile, never other applications, never other drives. There is no export endpoint for recruiters. Applications in `submitted` (not yet screened) and `withdrawn` are hidden from recruiters (`settings.showUnscreened` can show `submitted`). Officers see everything of their tenant.

Existing endpoints for recruiters: `GET /drives`, `GET /drives/:id`, `GET /applications/:id`, `/tickets*` return `403 FORBIDDEN` (recruiters use `/recruiter/*` and `/pipeline/*`). `/notifications*`, `/reminder-settings`, `/devices`, `/me*` work as for any user. Student and officer behaviour of existing endpoints is unchanged.

Shared-field object (`candidate`): `{name,email,phone,phoneDisplay,registrationNumber,department,program,batchYear,cgpa,cgpaScale,tenthPercent,twelfthPercent,activeBacklogs,gapYears,linkedin}` (a key is `null` if the student had no value) plus `fieldKeys:[...]` and `verification:{cgpa:'verified',...}`.

Permission column below: **O** officer only, **R** officer or assigned recruiter (permission in brackets for recruiters; officers always pass), **S** student (owner of the application).

## 1. Invites and recruiter registration

| | Path | Who |
|---|---|---|
| POST | `/drives/:id/recruiters` | O |
| GET | `/drives/:id/recruiters?includeRevoked=1` | O |
| PATCH | `/drives/:id/recruiters/:userId` | O |
| DELETE | `/drives/:id/recruiters/:userId` | O |
| DELETE | `/drives/:id/recruiter-invites/:inviteId` | O |
| POST | `/drives/:id/recruiter-invites/:inviteId/resend` | O |
| POST | `/auth/recruiter-invite/lookup` | public |
| POST | `/auth/register-recruiter` | public (rate limited like `/auth/*`) |

**POST /drives/:id/recruiters** body `{email, name?, permissions?}` (email uses the shared validator incl. typo domains: `"Did you mean gmail.com?"`; `name` 2-80).
- New email -> `201 {invite:{id,driveId,email,name,status:'pending',expiresAt,permissions}, inviteToken, emailSent:boolean, inAppNotified:false}`. `inviteToken` is returned ONCE to the officer (stored only as SHA-256) so it can be shared as a link/deep link when no mail provider is configured. Expires in 7 days.
- Pending invite for the same email+drive -> `200` same shape with `reissued:true` (old token invalid, new token, expiry reset).
- Email already belongs to an active **recruiter** of this tenant -> membership is created at once: `201 {member:{userId,...}, invite:null, inAppNotified:true}` (in-app + push notification to them).
- Errors: 400 email/name/permissions; 404 `DRIVE_NOT_FOUND`; 409 `ALREADY_MEMBER`; 409 `EMAIL_BELONGS_TO_OTHER_ROLE` (student/officer account).
Audit `recruiter.invite`.

**GET /drives/:id/recruiters** -> `{members:[{userId,name,email,phoneDisplay,permissions,addedAt,revokedAt}], invites:[{id,email,name,status:'pending'|'expired'|'revoked'|'accepted',expiresAt,createdAt}]}` (revoked members only with `includeRevoked=1`).
**PATCH** body `{permissions:{key:boolean,...}}` (partial) -> `{member}`. Audit `recruiter.permissions`.
**DELETE member** optional body `{reason?}` -> `{ok:true, revoked:true, alreadyRevoked:boolean}`. Revoked recruiter immediately loses all access to that drive (JWT stays valid but every drive call is 404). Audit `recruiter.revoke`; recruiter notified. Their notes/scorecards stay for the record.
**DELETE invite** -> `{ok:true}`; **resend** -> `{invite, inviteToken, emailSent}`.

**POST /auth/recruiter-invite/lookup** `{inviteToken}` -> `{invite:{email,name,driveId,companyName,role,expiresAt}}`; `404 INVITE_INVALID`, `422 INVITE_EXPIRED`.
**POST /auth/register-recruiter** `{inviteToken, name, phone, password, acceptTerms:true}`. The email is the invited one (cannot be changed). Same validators as `/auth/register` (10-digit Indian mobile, password rules, name). -> `201 {user:{role:'recruiter',...}, accessToken, refreshToken, memberships:[{driveId,permissions}]}`. All still-valid pending invites for that email in the tenant are accepted in the same transaction. Errors: 400 `VALIDATION_ERROR` (+`fields`), 404 `INVITE_INVALID` (unknown/revoked/used), 422 `INVITE_EXPIRED`, 409 `EMAIL_TAKEN`, 409 `PHONE_TAKEN`. Audit `recruiter.register`.

## 2. Recruiter home

**GET /recruiter/drives** (recruiter; officers get all drives with pipeline data) -> `{items:[{driveId,company:{name,logoUrl,industry,verified},role,status,deadline,permissions,counts:{candidates,shortlisted,rejected,inRounds,offers}}], nextCursor}`.
**GET /recruiter/drives/:id** -> `{drive:{id,company,role,workMode,locations,ctc,jd,requirements,status,deadline}, permissions, settings, rounds:[Round], funnel}`.

## 3. Pipeline settings, rounds, rubric (officer config)

`Settings` = `{autoAcceptSlotProposals:false, showUnscreened:false, slotCancelCutoffMinutes:120 (0-10080), blindScorecards:true}`.
**GET /pipeline/drives/:id/settings** (R) -> `{settings}`; **PUT** (O) partial body -> `{settings}`. Audit `pipeline.settings`.

`Round` = `{id,driveId,seq,name,kind,assessmentId|null,description|null,mode|null,venueOrLink|null,scheduledAt|null,resultsPublishedAt|null,counts:{...}}`; `kind` in `aptitude|assessment|coding|technical|hr|gd|custom`.
- **GET /pipeline/drives/:id/rounds** (R) -> `{items:[Round]}` ordered by `seq`, `counts` = per-status counts.
- **POST /pipeline/drives/:id/rounds** (O) `{name 2-80, kind, assessmentId?, description?<=500, mode?:'online'|'in_person', venueOrLink?, scheduledAt?}` -> `201 {round}`. `assessmentId` is checked against the assessments module when installed. Max 12 rounds. 409 `DRIVE_CLOSED`.
- **PATCH /pipeline/drives/:id/rounds/:roundId** (O) same fields partial -> `{round}`.
- **DELETE /pipeline/drives/:id/rounds/:roundId** (O) only if no candidates (`409 ROUND_HAS_CANDIDATES`) -> `{ok:true}`.
- **POST /pipeline/drives/:id/rounds/reorder** (O) `{roundIds:[all round ids in new order]}` -> `{items}`; 400 if set differs.
- **POST /pipeline/drives/:id/rounds/:roundId/publish-results** (O) -> `{ok:true,notified:n}`. Until published, students see passed/failed/on_hold as `pending_results`.

**Rubric** (per drive, optionally per round; a round rubric wins over the drive rubric):
- **GET /pipeline/drives/:id/rubric?roundId=** (R) -> `{rubric:{id,roundId|null,version,items:[{id,label,description|null}]}|null, effective:true}` (falls back to drive-level).
- **PUT /pipeline/drives/:id/rubric** (O) `{roundId?, items:[{id?,label 2-80,description?<=300}]}` (1-12 items; every item is rated 1-5) -> `{rubric}`; `version` increments. Audit `rubric.update`.

## 4. Candidates (recruiter + officer)

`CandidateRow` = `{applicationId,reference,status,submittedAt,candidate:{shared fields},resume:{label}, decision:'shortlisted'|'rejected'|'on_hold'|null, decisionReason, currentRound:{roundId,name,seq,status}|null, scorecardCount, avgScore|null, hasOffer}`.

- **GET /pipeline/drives/:id/candidates** (R viewCandidates) query: `q` (name/registration no./email, shared fields only), `status` (application status), `decision`, `roundId`, `roundStatus`, `department`, `minCgpa`, `sort=newest|name|cgpa|score`, `cursor,limit` -> `{items:[CandidateRow],nextCursor,total}`. `sort=score` is rejected with `400 VALIDATION_ERROR` (`fields.sort`) for recruiters while `settings.blindScorecards` is on (see *Blind scorecards*); officers and non-blind drives are unaffected. Only unwithdrawn applications; recruiters never see `submitted` unless `settings.showUnscreened`.
- **GET /pipeline/drives/:id/candidates/:applicationId** (R) -> `{candidate:{applicationId,reference,status,submittedAt,fields:{shared},fieldKeys,verification,resume:{label,url,signed:boolean,expiresAt|null},answers:[{id,label,value}],events:[{status,note,actorRole,createdAt}],rounds:[{roundId,name,seq,kind,status,waitlisted}],decision,decisionReason,notes:[Note],scorecards:[Scorecard],scoreSummary:{count,avg,byRecommendation:{},hiddenCount?},schedule,outcome:Outcome|null,offer:OfferSummary|null}}`. Audited `candidate.view` for recruiters.
- **GET /pipeline/drives/:id/candidates/:applicationId/resume** (R) -> `{url,signed,expiresAt}`. Uses the files module signed-URL helper when installed (`setResumeSigner` hook in `src/pipeline/access.ts`), else the https link the student saved. Audited `candidate.resume_view`.
- **POST .../candidates/:applicationId/decision** (R shortlist) `{decision:'shortlisted'|'rejected'|'on_hold'|'clear', reason?}` (`reason` 3-500 required for `rejected`) -> `{decision,reason,at}`. This is a recruiter/officer working decision; it does NOT change the application status (use outcomes). Officers are notified (`pipeline`). Audit `candidate.decision`.
- **POST /pipeline/drives/:id/candidates/bulk-decision** (R shortlist) `{applicationIds[1-100],decision,reason?}` -> `{updated,failed:[{applicationId,reason}]}`.
- **Notes**: `GET .../candidates/:applicationId/notes` (R notes) -> `{items:[Note]}`; `POST` `{body 1-2000, visibility:'team'|'private'}` -> `201 {note}`; `DELETE .../notes/:noteId` (author or officer) -> `{ok:true}`. `Note={id,body,visibility,author:{id,name,role},createdAt}`. `team` notes are visible to the drive's recruiters and officers, `private` only to the author. Students never see notes.

### Scorecards
`Scorecard={id,roundId,applicationId,recruiter:{id,name},ratings:[{itemId,label,rating}],overall (server-computed mean, 2 dp),comments,recommendation,rubricVersion,revision,submittedAt,updatedAt}`.
- **PUT /pipeline/drives/:id/candidates/:applicationId/scorecards/:roundId** (R scorecards) `{ratings:[{itemId,rating 1-5 integer}], comments?<=2000, recommendation:'strong_hire'|'hire'|'no_hire'|'strong_no_hire', questionSetId?: uuid}` -> `201 {scorecard}` first time, `200` when updating own (revision+1). Every rubric item must be rated exactly once. The candidate must be in that round (`422 NOT_IN_ROUND`). Errors: 422 `NO_RUBRIC`, 400 `fields["ratings.<itemId>"]`. Audit `scorecard.submit`.
- **GET .../candidates/:applicationId/scorecards?roundId=** (R) -> `{items:[Scorecard],hiddenCount}`. With `settings.blindScorecards` a recruiter sees other recruiters' cards for a round only after submitting their own (`hiddenCount` says how many are withheld). Officers see all.

#### Blind scorecards (score-derived aggregates)
When `settings.blindScorecards` is `true` (default) the same rule that hides other recruiters' cards also applies to every value derived from them. The rule is evaluated **per candidate and per round**: a recruiter's view of a round's scores opens only once *they* have submitted a scorecard for that candidate in that round. Officers are never restricted, and with `blindScorecards:false` nothing is withheld.

| Endpoint / field | Recruiter in blind mode (no own card yet) | After own card |
|---|---|---|
| `GET .../candidates` `items[].avgScore` | `null` | mean of the scorecards in rounds where the recruiter has their own card (so other rounds' scores never leak through the candidate-level number) |
| `GET .../candidates` `sort=score` | `400 VALIDATION_ERROR`, `fields.sort` (also after submitting: the order would reveal other candidates' scores) | same 400 |
| `GET .../candidates/:applicationId` `scoreSummary.avg` / `byRecommendation` | `null` / `{}` | computed over the visible rounds only |
| `scoreSummary.count`, `items[].scorecardCount` | unchanged (counts are kept) | unchanged |
| `scoreSummary.hiddenCount` (new, recruiters in blind mode only) | number of cards withheld | remaining withheld cards (other rounds) |
| `GET .../rounds/:roundId/candidates` `items[].avgScore` | `null` | round mean for that candidate |
| `GET .../rounds/:roundId/candidates?sort=score\|avgScore` | `400` | `400` |
| `POST .../advance/preview` and `POST .../advance` (`toInvite`/`toWaitlist`/`moved`/`waitlisted` `[].avgScore`) | `null` | round mean |

Round `score` (the 0-100 value from the results upload) is not scorecard-derived and is unchanged.

Advance ordering: when a recruiter in blind mode runs `advance` or `advance/preview` and at least one eligible candidate has scorecards the recruiter has not matched with their own, candidates are ordered by application time instead of score, and a `capacity` smaller than the number of eligible candidates is rejected with `400` (`fields.capacity`), because the cut would reveal the ranking. Without `capacity` (or with `capacity >=` eligible count) it works. Officers keep score ranking. A stored idempotent `advance` result is sanitised for the viewer on replay (hidden `avgScore` -> `null`, hidden entries re-sorted by name), so an officer's result cannot be used to read scores.

### Outcomes (select/reject proposals)
`Outcome={id,applicationId,kind:'select'|'reject',reason,status:'pending'|'approved'|'declined',proposedBy:{id,name},decidedBy,decidedAt,decisionNote,createdAt}`.
- **POST .../candidates/:applicationId/outcomes** (R proposeOutcomes) `{kind, reason? (3-500, required for reject), note?}` -> `201 {outcome}`; `409 OUTCOME_PENDING`; `422 INVALID_STATE` when the application status machine cannot go there (`select` needs screening/assessment/interview; `reject` needs a non-terminal status). Officers' own `POST /applications/:id/status` is unchanged.
- **GET /pipeline/drives/:id/outcomes?status=pending** (R) -> `{items:[Outcome+candidate summary],nextCursor}`.
- **POST /pipeline/outcomes/:id/decide** (O) `{decision:'approve'|'decline', note?}` -> `{outcome, application:{id,status}}`. Approve applies the existing status machine (`selected`/`rejected`, event actor_role `officer`, student notification). Idempotent for the same decision (`replayed:true`); 409 `OUTCOME_DECIDED` otherwise.

### Round results upload
**POST /pipeline/drives/:id/rounds/:roundId/results** (R uploadResults) `{rows:[{applicationId? | reference?, result:'passed'|'failed'|'absent'|'on_hold', score?:0-100, remark?<=300}] (1-500)}` -> `{total,updated,unchanged,failed:[{row,reference,reason}]}` (row 1-based). Valid per row through the same transition rules as status marking. Audit `round.results_upload`. Students see results only after `publish-results`.

### Messaging (drive thread: assigned recruiters + officers)
- **GET /pipeline/drives/:id/messages?cursor&limit** (R message) -> `{items:[{id,body,author:{id,name,role},createdAt}],nextCursor}` newest first.
- **POST /pipeline/drives/:id/messages** (R message) `{body 1-2000, clientId?}` -> `201 {message}`. Same `clientId` (uuid) within a drive replays (200). Every other participant gets an in-app notification (`pipeline_message`); audit `message.post` (id only, no body).

## 5. Round candidates, advance, attendance, waitlist, funnel

`RoundCandidate={applicationId,reference,name,department,cgpa,applicationStatus,status,waitlisted,waitlistRank,remark,score|null,avgScore|null,updatedAt}` (`avgScore` is `null` for recruiters in blind mode until they submit their own scorecard for that candidate in this round, see *Blind scorecards*); status: `pending|invited|attended|absent|passed|failed|on_hold`.
Round status moves are validated against a transition table; invalid -> `reason` in a bulk result or `422 INVALID_ROUND_TRANSITION`. Every change appends to `round_events` (append-only) with actor.

- **GET /pipeline/drives/:id/rounds/:roundId/candidates?status=&waitlisted=0|1&q=&cursor&limit** (R) -> `{items:[RoundCandidate],nextCursor,counts}`.
- **POST /pipeline/drives/:id/rounds/:roundId/candidates** (O) `{applicationIds[1-200]}` or `{allScreened:true}` -> `{added,alreadyIn,failed:[{applicationId,reason}]}`. Application status must be `screening|assessment|interview|selected`.
- **POST /pipeline/drives/:id/rounds/:roundId/status** (R markAttendance for attended/absent, uploadResults for passed/failed/on_hold, officer for invited/pending) `{updates:[{applicationId,status,remark?}] (1-200)}` -> `{updated,unchanged,failed:[{applicationId,reason}]}`. Setting `invited` notifies the student.
- **POST /pipeline/drives/:id/rounds/:roundId/attendance** (R markAttendance) `{marks:[{applicationId,present:boolean}] (1-200)}` -> same shape.
- **POST /pipeline/drives/:id/rounds/:roundId/waitlist** (O) `{applicationIds[], ranks?:{[applicationId]:int}}` -> `{updated}`. **POST .../promote** (O) `{applicationIds[]}` -> `{promoted}` (waitlisted -> normal `invited`, student notified).
- **Advance** (O or R uploadResults). Moves candidates who `passed` a round to the next round (or `toRoundId`).
  - `POST .../rounds/:roundId/advance/preview` `{applicationIds?, toRoundId?, capacity?}` -> `{fromRound,toRound,toInvite:[{applicationId,name,avgScore}],toWaitlist:[...],skipped:[{applicationId,reason}],counts}`. `skipped.reason`: `not_passed`, `already_in_target`, `application_inactive`, `waitlisted`. Without `applicationIds` every `passed` candidate is considered; `capacity` invites the best N by average scorecard (then application time), the rest are waitlisted in the target round. Writes nothing.
  - `POST .../rounds/:roundId/advance` `{applicationIds?, toRoundId?, capacity?, confirm:true, idempotencyKey (uuid)}` -> `{moved:[...],waitlisted:[...],skipped:[...],replayed:boolean}`. `confirm:true` is required (400 otherwise). The same `idempotencyKey` returns the stored result (`replayed:true`) and changes nothing; a different key re-evaluates (already-moved candidates are `skipped:already_in_target`). 422 `NO_NEXT_ROUND`. Students moved get a notification and status `invited`.
- **Attendance QR**: 
  - `POST /pipeline/drives/:id/rounds/:roundId/attendance-token` (R markAttendance) `{session?:string<=40 (default 'default'), validFrom?:ISO (default now), validMinutes?:5-720 (default 60)}` -> `201 {token, qrPayload:'POSATT1.'+token, session, validFrom, validUntil}`. The token is shown once (stored hashed). Creating a new one for the same round+session revokes the previous one. `DELETE .../attendance-token/:session` revokes.
  - `POST /pipeline/attendance/scan` (S) `{token}` (raw token or the `POSATT1.` payload) -> `{attended:true,replayed:boolean,round:{id,name},driveId,markedAt}`. Server clock only. Errors: 404 `TOKEN_INVALID` (unknown/revoked); 422 `TOKEN_NOT_STARTED`; 422 `TOKEN_EXPIRED`; 403 `NOT_SHORTLISTED` (student has no live application / not in that round / waitlisted); 422 `ALREADY_DECIDED` (passed/failed). Repeat scans return 200 `replayed:true`. Audit `attendance.scan`.
- **GET /pipeline/drives/:id/funnel** (R) -> `{applications:{total,byStatus:{submitted,screening,...}}, rounds:[{roundId,name,seq,kind,pending,invited,attended,absent,passed,failed,onHold,waitlisted,total}], decisions:{shortlisted,rejected,on_hold}, offers:{pending_approval,issued,accepted,declined,expired,revoked,rejected,joined}}`.
- **GET /pipeline/applications/:id/rounds** (S owner) -> `{items:[{roundId,name,kind,seq,status,waitlisted}]}`; passed/failed/on_hold appear as `pending_results` until the round's results are published.

## 6. Interview panels and slot booking

`Slot={id,driveId,roundId,startsAt,endsAt,mode,venueOrLink,instructions,capacity,booked,status:'proposed'|'open'|'cancelled'|'declined',panel:[{userId,name,role}],proposedBy,createdAt}`.
- **POST /pipeline/drives/:id/rounds/:roundId/slots** (O, or R proposeSlots) `{slots:[{startsAt,endsAt,mode:'online'|'in_person',venueOrLink,instructions?,capacity? (1-50, default 1),panelistIds?:[userIds]}] (1-50)}` -> `201 {items:[Slot]}`. Officer slots are `open`. Recruiter slots are `proposed` unless `settings.autoAcceptSlotProposals` (then `open`). `panelistIds` must be active members of the drive or officers of the tenant (recruiter default: self). Times: future, `endsAt` > `startsAt`, 10 min - 8 h, same validators as `/applications/:id/schedule` for mode/venue. Open slots reserve their panelists: overlapping a panelist's other open slot -> `409 PANELIST_BUSY`.
- **GET /pipeline/drives/:id/slots?roundId=&status=&from=&to=&cursor&limit** (R) -> `{items:[Slot],nextCursor}`.
- **POST /pipeline/slots/:id/approve** (O) -> `{slot}` (409 `PANELIST_BUSY`, 422 `SLOT_NOT_PROPOSED`). **POST /pipeline/slots/:id/decline** `{reason}` (O) -> `{slot}`; proposer notified.
- **PATCH /pipeline/slots/:id** (O or the proposer) `{startsAt?,endsAt?,mode?,venueOrLink?,instructions?,panelistIds?}` reschedule/edit; booked students are notified, their live schedule, reminder and booking window move with it. 409 `PANELIST_BUSY`, 409 `CANDIDATE_BUSY` (a booked student would clash), 422 `SLOT_STARTED`.
- **POST /pipeline/slots/:id/cancel** `{reason}` (O or proposer) -> `{slot,cancelledBookings:n}`; students notified, their schedule superseded.
- **GET /pipeline/applications/:id/slots** (S) -> `{items:[{id,roundId,roundName,startsAt,endsAt,mode,venueOrLink,instructions,remaining}],booking:Booking|null}`. Only `open`, future, non-full slots of rounds the student is in (status pending/invited/attended/passed, not waitlisted).
- **POST /pipeline/applications/:id/slots/:slotId/book** (S) -> `201 {booking:{id,slotId,roundId,startsAt,endsAt,mode,venueOrLink,status:'booked'},schedule}`; same slot again -> `200 replayed:true`. Errors: 404 `SLOT_NOT_FOUND`, 409 `SLOT_FULL`, 409 `ALREADY_BOOKED` (cancel first), 409 `CANDIDATE_BUSY` (overlaps another booking of the student), 422 `SLOT_NOT_OPEN`, 422 `SLOT_STARTED`, 403 `NOT_IN_ROUND`. Booking uses the existing schedule logic: creates the live `application_schedules` row (type `interview`, or `assessment` for aptitude/assessment/coding rounds), moves the application to `interview`/`assessment` if the status machine allows, creates the `sched60` reminder, in-app + push to student, in-app to the panel and officers.
- **POST /pipeline/applications/:id/rounds/:roundId/booking/cancel** (S) `{reason?}` -> `{ok:true,cancelled:boolean}`. Allowed until `slotCancelCutoffMinutes` before start, afterwards `422 CANCEL_WINDOW_CLOSED`. Slot is freed; panel and officer notified. Panelists get an in-app reminder 60 minutes before an open booked slot (worker).

## 7. Offers

`Offer={id,applicationId,driveId,status:'pending_approval'|'rejected'|'issued'|'accepted'|'declined'|'expired'|'revoked'|'joined',kind:'annual'|'stipend_monthly',ctc:{fixedLpa,variableLpa,bonusLpa,joiningBonusLpa,esopNote,other:[{label,amountLpa}],totalLpa},joiningDate,location,expiresAt,letter:{fileId|null,url|null},notes,tier:'regular'|'dream'|'super_dream',policy:{result:'allowed'|'needs_override'|'blocked',reasons:[{code,message}]},overrideReason|null,proposedBy:{id,name,role},approvedBy|null,rejectedReason,revokedReason,createdAt,issuedAt,respondedAt,joinedAt,candidate?:{name,applicationReference}}`.
(For stipend drives amounts are rupees per month in `fixedLpa` like the drive; policy checks are skipped for `stipend_monthly`.)

- **POST /pipeline/drives/:id/candidates/:applicationId/offers** (O, or R proposeOffers) body `{ctc:{fixedLpa>0,variableLpa?,bonusLpa?,joiningBonusLpa?,esopNote?,other?}, joiningDate:'YYYY-MM-DD' (future), location 2-120, expiresAt ISO (future, <=90 days), letterFileId?|letterUrl? (https), notes?<=500, overrideReason? (officer only, 10-300)}`.
  - Application must be `selected` (422 `NOT_SELECTED`) and have no open offer (409 `OFFER_EXISTS`).
  - Policy evaluated (section 8). `blocked` -> `422 OFFER_BLOCKED_BY_POLICY` (`fields.policy` lists reasons). `needs_override`: officer must send `overrideReason` (else `422 OVERRIDE_REQUIRED`); recruiter proposals are accepted as `pending_approval` flagged `policy.result:'needs_override'`.
  - Officer -> offer is issued immediately: `201 {offer}` status `issued`, application -> `offer_issued` (event actor officer, note "Offer issued"), student notified. Recruiter -> `201 {offer}` status `pending_approval`, officers notified. The student cannot see the offer until issued.
- **POST /pipeline/offers/policy-check** (R proposeOffers) `{applicationId, ctc:{...}}` -> `{policy:{result,reasons,tier,existing:[...]}}`.
- **GET /pipeline/drives/:id/offers?status=&cursor&limit** (R) -> `{items:[Offer]}`; **GET /pipeline/offers/:id** (R of that drive) -> `{offer, events:[{type,fromStatus,toStatus,note,actor:{id,name,role},createdAt}]}`.
- **POST /pipeline/offers/:id/approve** (O) `{overrideReason?}` -> `{offer}` (re-evaluates policy; 422 `OFFER_BLOCKED_BY_POLICY` / `OVERRIDE_REQUIRED`; 422 `NOT_SELECTED`; 422 `OFFER_EXPIRED_ON_APPROVAL` when `expiresAt` already passed). Issues it as above.
- **POST /pipeline/offers/:id/reject** (O) `{reason 3-300}` -> `{offer}` (pending only); proposer notified.
- **POST /pipeline/offers/:id/revoke** (O) `{reason 3-300}` -> `{offer}`. Allowed for `pending_approval` and `issued` (422 `OFFER_NOT_REVOCABLE` for accepted/joined/etc). An issued offer moves the application to `offer_declined` (the status machine has no other exit from `offer_issued`) with event note `Offer revoked by placement cell: <reason>`; student notified; audit `offer.revoke`.
- **POST /pipeline/offers/:id/joined** (O) `{joinedOn?:'YYYY-MM-DD', note?}` -> `{offer}`; requires `accepted`; moves application `offer_accepted` -> `joined`.
- **Student**: accept/decline stay `POST /applications/:id/respond` (unchanged contract). New: `422 OFFER_EXPIRED` when the offer's `expiresAt` has passed; the response also settles the offer record (`accepted`/`declined`) and notifies the proposing recruiter. **GET /pipeline/applications/:id/offer** (S owner) -> `{offer|null}` (issued, accepted, declined, expired, revoked, joined only; includes `canRespond`).
- **Expiry worker** (every 30 s, in-process, `FOR UPDATE SKIP LOCKED`): issued offers past `expiresAt` -> `expired`, application `offer_issued` -> `offer_declined` (event actor_role `system`, note "Offer expired"), notifications to student, officers and proposer. Idempotent.
- Offers are mirrored in `offer_events` (append-only): created, approved, rejected, issued, accepted, declined, expired, revoked, joined, override.

## 8. Policy (read side only)

`tenant_settings(tenant_id pk, policy jsonb)`; the ops module edits it. `getPolicy(tenantId)` (in `src/pipeline/policy.ts`) returns the validated policy merged over defaults; invalid stored values fall back to defaults field by field.

```json
{ "offers": {
    "oneOffer": true,
    "allowOverride": true,
    "dreamMinLpa": 10,
    "superDreamMinLpa": 20,
    "dreamUpgradeMultiplier": 1.5,
    "superDreamUpgradeMultiplier": 2
} }
```
Tier by `totalLpa`: `>= superDreamMinLpa` super_dream, `>= dreamMinLpa` dream, else regular. `evaluateOfferAgainstPolicy({policy, offer:{totalLpa}, existing:[{status,totalLpa}]})` is pure. "Holding" offers = `issued`, `accepted`, `joined`. With `oneOffer:false` or nothing held -> `allowed`. Otherwise by the best held offer:
- held tier super_dream -> `blocked` (`SUPER_DREAM_HELD`).
- new tier regular -> `blocked` (`ONE_OFFER`).
- new dream over held regular: allowed if new >= `dreamUpgradeMultiplier` x held, else `needs_override` (`BELOW_UPGRADE_MULTIPLIER`).
- new dream over held dream -> `blocked` (`SAME_TIER`).
- new super_dream over regular/dream: allowed if new >= `superDreamUpgradeMultiplier` x held, else `needs_override`.
`allowOverride:false` turns `needs_override` into `blocked`.

## 9. Library surface for other modules

`server/src/pipeline/access.ts`: `canAccessCandidate(userId, applicationId, db?)` -> `{allowed, reason?, role, tenantId, driveId, studentId, sharedFieldKeys}`; `getSharedCandidate(applicationId, db?)` -> the shared-field payload (the only candidate data an AI feature may hand to a model for a recruiter). Officers: allowed for their tenant; students: only their own application; recruiters: active membership + `viewCandidates` + visibility rules above. `server/src/pipeline/policy.ts`: `getPolicy`, `evaluateOfferAgainstPolicy`, `DEFAULT_POLICY`.

## 10. Seed

`recruiter@placement.demo` / `Recruiter@123` is assigned to the Kestrel Systems demo drive with a rubric, three rounds (Online assessment, Technical interview, HR discussion), candidates in the pipeline, an open interview slot and a pending offer proposal.

## 11. Audit actions written to `audit_events`

`recruiter.invite|register|permissions|revoke`, `candidate.view|resume_view|decision|note`, `scorecard.submit`, `rubric.update`, `pipeline.settings`, `round.create|update|reorder|delete|advance|results_upload|attendance|publish_results`, `attendance.scan`, `slot.create|approve|decline|update|cancel|book|booking_cancel`, `outcome.propose|decide`, `offer.create|approve|reject|revoke|expire|joined|override`, `message.post`.

## 12. Implementation notes (deviations and behaviours worth knowing)

- `canAccessCandidate(userId, applicationId, db?)` and `getPolicy(tenantId, db?)` take an optional trailing `db` (pool or transaction client); without it they use the pool bound by `createApp`.
- `questionSetId` (optional) attaches an APPROVED AI question set generated for the same application (`markQuestionSetAttached` from `src/ai/questionSets.ts`; sets `scorecardRef` = scorecard id, atomically with the scorecard). Draft, discarded or other-candidate sets: `422 QUESTION_SET_NOT_APPROVED`, nothing saved.
- Offer policy: `tenant_settings.policy` written by the ops module (`oneOffer`, `tiers`, `upgrade`) is translated by `fromOpsPolicy` in `src/pipeline/policy.ts`; a legacy `{offers:{...}}` shape and the defaults (no stored policy) still work.
- Hooks are bound in `src/hooks.ts`: invite email via `sendMail`, signed resume URLs (`resume.signed`) and recruiter read access to candidate resume files (`GET /files/:id/url`) via R2 when configured.
- `POST /drives/:id/recruiters` also returns `inviteToken` to the officer (the token is stored only as a SHA-256 hash) so the officer UI can show a copyable link when email delivery is not configured. Email and in-app notification are always attempted via `setInviteMailer`.
- Public recruiter onboarding lives in a second router mounted right after `authRouter` (`/auth/recruiter-invite/lookup`, `/auth/register-recruiter`), so `app.ts` has two pipeline lines (public auth router, plus the single `MODULES-BEGIN` line).
- `officer.ts` previously guarded everything under `/` with `requireRole('officer')`. The guard is now path-scoped to `/students`, `/officer`, `/announcements` (the only prefixes that router serves), so later modules mounted at `/` are reachable by recruiters.
- Recruiters get 403 `Recruiter accounts cannot use this endpoint` on the pre-existing student/officer routers (`drives`, `tickets`, `GET /applications/:id`) via `denyRecruiter`.
- `POST /applications/:id/respond` additionally returns `422 OFFER_EXPIRED` for lapsed offers and notifies the proposing recruiter (hooks in `src/pipeline/offerHooks.ts`).
- Idempotent replays: rejecting an already rejected offer and revoking an already revoked offer return `200` with the current offer instead of an error.
- Officers default to being the sole panelist of slots they create; two slots of the same officer may not overlap (`PANELIST_BUSY`), so give distinct `panelistIds` for parallel panels.
- Non-members and other tenants get `404` (not `403`) for drive-scoped recruiter resources, so existence is not leaked.
- `application_schedules.slot_booking_id` links a live schedule row to its slot booking. The shared-fields snapshot (`application_shared_fields`) is written by a DB trigger on `applications`, so the apply endpoint is unchanged. Offer status is kept in sync with application status changes made through the existing endpoints by trigger `pipeline_sync_offer_status`.
- Offer notifications use type `offer`; round and attendance notifications use type `pipeline`.
