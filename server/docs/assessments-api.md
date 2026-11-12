# Assessments API (module 010-019)

Base path `/api/v1`, JSON, `Authorization: Bearer <accessJWT>`. Errors are always
`{ "error": { "code": string, "message": string, "fields"?: { [path]: string } } }`.
Lists are `{ items, nextCursor }` (`?cursor=&limit=`, limit 1-50, default 20, cursor is opaque).
All timestamps are ISO-8601 UTC. **Time and scores are always decided by the server.** Every response that matters for a
countdown carries `serverNow`; the app computes `offset = serverNow - deviceNow` and counts down to `deadlineAt`.
Money-like numbers (marks) are JSON numbers with at most 2 decimals.

Roles: **officer** = question bank, assessments, results. **student** = my tests, attempts, practice.
Student calling an officer route (or vice versa) gets `403 FORBIDDEN`; no token `401`. Everything is tenant scoped; other tenants' and
other students' objects are `404`.

Feature flags (merged into `features` by the config endpoint): `assessments` (always true), `codeExecution`
(true only when a Judge0 endpoint is configured: `JUDGE0_URL`, optional `JUDGE0_API_KEY` + `JUDGE0_API_HOST`
(RapidAPI style), optional `JUDGE0_AUTH_TOKEN`). When false: coding questions can be authored but a test containing
them cannot be published, and run/submit-code answer `503 CODE_EXECUTION_UNAVAILABLE`.

No endpoint ever blocks screenshots / screen recording. Proctoring-lite only *logs* app switches and focus loss.

---------------------------------------------------------------------------------------------------------------------

## 1. Shared shapes

### Question types and answer formats (what the student sends in `answer`)
| type | student `answer` | notes |
|---|---|---|
| `mcq_single` | `"b"` (option id) | `null` = unanswered |
| `mcq_multi` | `["a","c"]` (option ids, unique) | `[]`/`null` = unanswered |
| `numeric` | `12.5` (number; numeric strings accepted) | |
| `short_text` | `"text"` (<= 500 chars) | |
| `coding` | `{ "language": "python3", "code": "..." }` (code <= 32 000 chars) | autosave of the editor; scoring uses *judged submissions* (see 7) |

### Question (bank) - officer representation
```
{
  id, type, title (<=200), body (markdown <=20000), topic (<=80), tags[] (<=10, lowercase), difficulty: "easy"|"medium"|"hard",
  marks (0.25..100), negativeMarks (0..marks, default 0), explanation (<=5000), practice: boolean,
  status: "active"|"archived",
  options: [{ id: "a", text }]                       // mcq_*: 2..8 options, ids a..h
  answer:  mcq_single {correct:"b"} | mcq_multi {correct:["a","c"]} | numeric {value:12.5, tolerance:0.01}
           | short_text {accepted:["foo","bar"], mode:"exact"|"regex", caseSensitive:false}   // coding: {}
  coding:  null | {
     constraints (markdown), languages: ["python3","java","cpp","c","javascript"] (>=1),
     timeLimitMs (100..15000, default 2000), memoryLimitMb (16..512, default 256),
     compare: { mode: "tokens"|"lines", floatTolerance?: number },    // default tokens (whitespace-insensitive)
     starterCode: { python3?: string, ... },
     referenceSolution?: { language, code },                          // officer only, never sent to students
     testCases: [{ id, kind: "sample"|"hidden", input, expectedOutput, weight (int 0..100, default 1), explanation? }]
  },
  usedIn: number (assessments referencing it), createdBy, createdAt, updatedAt
}
```
Short-text normalisation: NFKC, trim, collapse whitespace, case-insensitive unless `caseSensitive`. `regex` mode treats
every `accepted` entry as a JS regex that must match the whole normalised answer (patterns with nested quantifiers are rejected).

### Student view of a question (inside an attempt) - never contains answers, explanations, hidden tests
```
{ id /* assessment-question id: use this everywhere as questionId */, sectionId, number /* 1-based display order */,
  type, title, body, marks, negativeMarks, options?: [{id,text}] /* shuffled per attempt if enabled */,
  multi?: boolean,
  coding?: { constraints, languages, timeLimitMs, memoryLimitMb, starterCode, samples: [{id,input,expectedOutput,explanation?}], hiddenCount } }
```

### Assessment (officer)
```
{
 id, title, instructions (markdown <=10000), status: "draft"|"published"|"archived", practice: boolean,
 driveId|null, drive?: {id, company, role},
 audience: {type:"drive_applicants", driveId?, statuses:["submitted","screening",...]}   // driveId defaults to assessment.driveId
         | {type:"all_eligible", driveId?}       // students whose eligibility for the drive is `eligible`
         | {type:"students", studentIds:[uuid]}  // 1..2000
         | {type:"cohort", cohortId: string}     // resolved through the ops `resolveCohort` helper if installed, else publish fails
         | {type:"all_students"},                // practice sets (forced) and open tests
 opensAt, closesAt (UTC; null only for practice), durationMinutes (1..600),
 settings: {
   randomiseQuestions: boolean (false), randomiseOptions: boolean (false),
   negativeMarking: boolean (false),                     // when true each question's negativeMarks applies
   passCutoff: null | {type:"marks"|"percent", value},   // overall; section cutoffs are on sections
   resultVisibility: "immediate"|"after_close"|"manual" (default "after_close"),
   allowReview: boolean (false)                          // student may see their answers + key + explanations after result release
   maxAttempts: 1..10 (1)  (ignored for practice = unlimited),
   rankingEnabled: boolean (true; forced false for practice),
   proctoring: { enabled: boolean (false), maxWarnings: 1..20 (3), autoSubmit: boolean (false) }
 },
 sections: [{ id, title, timeLimitMinutes: int|null, cutoffMarks: number|null, questions: [{ id /*aqId*/, questionId, type, title, marks, negativeMarks, difficulty }] }],
 totalMarks, questionCount, audienceCount (after publish), resultsPublishedAt|null, publishedAt|null, createdBy, createdAt, updatedAt,
 counts: { attempts, submitted, inProgress }
}
```
Write bodies (`POST/PUT /assessments`) take: `title, instructions, driveId, audience, opensAt, closesAt, durationMinutes, practice, settings (partial),
sections: [{ id?, title, timeLimitMinutes?, cutoffMarks?, questions: [{ questionId, marks?, negativeMarks? }] }]`.
`sections` replaces the whole structure (draft only). `marks`/`negativeMarks` default to the bank question's values.

### Sections with time limits ("sequential mode")
If any section has `timeLimitMinutes`, the attempt is sequential: only the first section is open at start; its clock starts at
attempt start. `POST /attempts/:id/sections/:sectionId/enter` opens the next section (and permanently locks every earlier section).
Answers for a locked section, or after its section deadline, are rejected with `409 SECTION_CLOSED`. Questions of sections not yet
entered are not sent. Without any timed section all sections are open and navigation is free.

---------------------------------------------------------------------------------------------------------------------

## 2. Question bank (officer)

| Method & path | Body / query | Success |
|---|---|---|
| `GET /assessment-questions` | `q, type, difficulty, topic, tag, status=active\|archived\|all (default active), practice=1, cursor, limit` | `{items:[QuestionSummary], nextCursor}` (summary = question without `coding.testCases` bodies/reference; has `testCaseCounts:{sample,hidden}`) |
| `POST /assessment-questions` | Question fields (no id) | `201 {question}` |
| `GET /assessment-questions/:id` | | `{question}` (full, incl. key, tests, reference) |
| `PUT /assessment-questions/:id` | full replace of Question fields | `{question}`. Published assessments are unaffected (they hold a snapshot) |
| `DELETE /assessment-questions/:id` | | `204`; `409 QUESTION_IN_USE` if any assessment references it (archive instead) |
| `POST /assessment-questions/:id/archive` / `/unarchive` | | `{question}` |
| `POST /assessment-questions/:id/duplicate` | | `201 {question}` (title gets " (copy)") |
| `POST /assessment-questions/import` | `{format:"json", rows:[Row]}` or `{format:"csv", csv:"..."}`, `dryRun?:boolean` | `{total, imported, valid, dryRun, errors:[{row, fields:{...}}]}` (`valid` = rows that passed validation; `imported` is 0 on a dry run) |

Validation (400 `VALIDATION_ERROR`, `fields` keyed by path e.g. `options`, `answer.correct`, `coding.testCases.2.expectedOutput`):
mcq needs 2-8 options with unique ids and non-empty text; `correct` must reference existing ids (mcq_multi: at least one);
numeric `value` finite; short_text 1-20 accepted entries (<=200 chars each); coding needs >=1 language from the allowed set, >=1 test case,
total test weight > 0, `starterCode` keys must be allowed languages, `memoryLimitMb`/`timeLimitMs` in range. `practice:true` on a coding
question additionally requires >=1 sample and >=2 hidden tests (`422 NOT_PRACTICE_READY`).

**Bulk import** (MCQ only, <= 200 rows per request because the body limit is 100 KB). Row (JSON object or CSV line, header names are case-insensitive):
`type` (`mcq_single`|`mcq_multi`, default mcq_single), `title`, `body?` (defaults to title), `optionA..optionH` (or JSON `options:[strings]`),
`correct` (letters `B` or `A;C`/`A,C`), `topic?`, `tags?` (`;`-separated or array), `difficulty?` (default medium), `marks?` (default 1),
`negativeMarks?` (default 0), `explanation?`. `row` in errors is 1-based (CSV: line after the header). Valid rows are imported, invalid rows reported;
`dryRun:true` only validates. 400 if the payload itself is malformed or has 0 rows or > 200 rows.

---------------------------------------------------------------------------------------------------------------------

## 3. Assessments (officer)

| Method & path | Notes |
|---|---|
| `GET /assessments?status=draft\|published\|archived&practice=1&q=&cursor=&limit=` | `{items:[AssessmentSummary]}` (summary = assessment without sections' question lists, plus `counts`) |
| `POST /assessments` | body above; `title` required; creates draft -> `201 {assessment}` |
| `GET /assessments/:id` | `{assessment}` |
| `PUT /assessments/:id` | draft: full edit (sections replace structure). published: only `instructions`, `closesAt` (may only move later), `resultVisibility` via `settings`, `settings.allowReview`, `settings.proctoring.maxWarnings`; anything else `409 ASSESSMENT_LOCKED` |
| `POST /assessments/:id/publish` | see below -> `{assessment, audienceCount, notified, replayed:false}`; already published -> `200` with `replayed:true` and nothing re-sent |
| `POST /assessments/:id/archive` | hides from students, cancels reminders; running attempts can still be submitted -> `{assessment}` |
| `POST /assessments/:id/clone` | new draft with `title + " (copy)"`, same sections/settings, no schedule -> `201 {assessment}` |
| `GET /assessments/:id/preview?seed=` | student view of the whole test without creating an attempt: `{sections, questions, settings, durationMinutes}` (answers/hidden tests stripped) |
| `GET /assessments/:id/audience` | `{count, sample:[{id,name}], unresolved?: string}` live resolution (works for drafts) |
| `POST /assessments/:id/audience/refresh` | published only: re-resolves audience, adds newcomers (notifies them, creates reminders) -> `{added, audienceCount}` |
| `PUT /assessments/:id/questions/:aqId/key` | published (or archived) only; drafts take their key from the bank at publish (`409 ASSESSMENT_LOCKED`). Body `{reason (3..300), answer?, marks?, negativeMarks?, explanation?}`; `answer` has the same shape as the question `answer`. Updates the snapshot, audit event `assessment.key_corrected`. Response `{assessment, needsRegrade:true}` |
| `POST /assessments/:id/regrade` | `{reason, rejudge?:boolean}` -> recomputes every submitted attempt from stored answers and judged submissions (`changed` = attempts whose computed score moved; manual overrides are kept); `rejudge:true` additionally puts every judged submission back to `pending_judge` (attempts show `evaluation:"pending"` until the worker finishes); `{regraded, changed, rejudgeQueued}`; audit `assessment.regraded` |

**Publish completeness checks** -> `422 NOT_PUBLISHABLE` with `fields` (path -> message): title; >=1 section with >=1 question; section titles;
every question valid (re-validated from the bank, archived questions rejected); coding question needs >=1 sample and >=2 hidden tests with weights and
`codeExecution` configured; `durationMinutes`; total marks > 0; for non-practice `opensAt` in the future and `closesAt > opensAt + duration`;
`passCutoff` achievable (<= total marks); audience resolves to >=1 student (`audience`). Practice sets need no window. Publish freezes a snapshot of each
question (later bank edits do not change running tests), materialises the audience, writes in-app notifications
(`type: "assessment_published"`, data `{assessmentId, opensAt}`) + push for each student, and schedules `t60` / `t15` start reminders (`assessment_reminder`).
Reminders are idempotent, skipped when already past, when the student already started, or per the student's reminder settings / quiet hours.

---------------------------------------------------------------------------------------------------------------------

## 4. Student: my tests and attempts

### `GET /my/assessments?bucket=upcoming|live|past|all&cursor&limit`
Item: `{id,title,drive:{id,company,role}|null,opensAt,closesAt,durationMinutes,totalMarks,questionCount,sectionCount,bucket:"upcoming"|"live"|"past",
attemptsAllowed,attemptsUsed,activeAttempt:{id,deadlineAt}|null,canStart,resultReleased,myScore:{score,maxScore,percent,passed}|null,serverNow}`.
`live` = window open and attempts left. `past` = window closed or attempts used up. Practice sets are not listed here (see 6).

### `GET /my/assessments/:id` -> `{assessment:{...same + instructions, sections:[{id,title,timeLimitMinutes,cutoffMarks?,questionCount}], settings:{negativeMarking, proctoring, resultVisibility, allowReview, rankingEnabled, maxAttempts, randomised: boolean}}, attempts:[{id,attemptNo,status,startedAt,submittedAt,evaluation}], serverNow}`
Not in the audience -> `404 ASSESSMENT_NOT_FOUND`.

### `POST /my/assessments/:id/start` (body `{}`)
Idempotent: if an attempt is in progress and not expired, it is returned (`200`, `resumed:true`) with the *remaining* time computed from the server clock.
New attempt -> `201`. Response `{attempt, resumed, ...AttemptState}` (see below).
Errors: `404 ASSESSMENT_NOT_FOUND`; `422 NOT_OPEN_YET` (`fields.opensAt`); `422 ASSESSMENT_CLOSED`; `409 MAX_ATTEMPTS_REACHED`.
`deadlineAt = min(startedAt + duration, closesAt)`. Randomisation (question order within section, option order) is derived from the attempt `seed`, so it is stable on resume.
An in-progress attempt whose deadline has passed is finalised (auto-submit) first, then the normal rules apply.

### `GET /attempts/:id` (also `/attempts/:id/questions` returns the same)  -> AttemptState
```
{ attempt: { id, assessmentId, attemptNo, status: "in_progress"|"submitted", submitReason: null|"student"|"deadline"|"proctor"|"closed"|"admin",
             startedAt, deadlineAt, submittedAt, remainingSeconds, warnings, maxWarnings|null, practice, evaluation: "pending"|"complete" },
  serverNow,
  assessment: { id, title, instructions, durationMinutes, negativeMarking, proctoring: {enabled,maxWarnings,autoSubmit}, totalMarks },
  sections: [{ id, title, timeLimitMinutes, enteredAt|null, deadlineAt|null, locked: boolean, questionIds: [aqId] }],
  questions: [StudentQuestion]   // display order; only questions of entered sections in sequential mode
  answers: { [aqId]: { answer, flagged, savedAt } },
  code: { [aqId]: { submissions: n, best: {passed,total,score,maxScore,verdict}|null, pending: boolean } }
}
```
If the attempt's deadline passed while you were away, this call finalises it and returns `status:"submitted"`.

### `PUT /attempts/:id/answers`  (autosave, batched, <= 100 items, body <= 100 KB)
`{ answers: [{ questionId, answer?, flagged?, clientTs, timeSpentMs? }] }`
- `clientTs`: integer ms since epoch, assigned by the client when the user edited. **Last write wins by `clientTs`** (per field: answer and flag are tracked
  separately; an older `clientTs` than the stored one is ignored and listed in `stale`). Equal timestamps: the later request wins.
- Omit `answer` to change only the flag; `answer: null` clears the answer. `timeSpentMs` is cumulative per question (server keeps the max).
Response `{ saved: n, stale: [questionId], rejected: [{questionId, reason: "SECTION_CLOSED"}], serverNow, remainingSeconds }`. Items for a closed/unopened section are listed in `rejected` and skipped; if nothing at all could be saved because of it the call is `409 SECTION_CLOSED`.
Errors: `400` (fields `answers.<i>.answer` for wrong shapes, `answers.<i>.questionId` unknown), `409 DEADLINE_PASSED` (attempt gets finalised; nothing saved; 5 s grace
after the deadline for in-flight requests), `409 ATTEMPT_ALREADY_SUBMITTED`, `409 SECTION_CLOSED`.

### `POST /attempts/:id/sections/:sectionId/enter`  -> `{section:{id,enteredAt,deadlineAt,locked}, questions:[StudentQuestion]}`
Idempotent. In sequential mode only the *next* unopened section can be entered (`409 SECTION_NOT_NEXT`), which locks every earlier one; unknown section `404 SECTION_NOT_FOUND`. `409 DEADLINE_PASSED` / `ATTEMPT_ALREADY_SUBMITTED` as for answers.

### `POST /attempts/:id/events`  (proctoring-lite)
`{ events: [{ type: "focus_lost"|"focus_regained"|"app_background"|"network_offline", clientTs, eventId?: string(<=64, dedupes retries) }] }` (<= 20)
-> `{ warnings, maxWarnings|null, autoSubmitted: boolean, status, ignored?: boolean }`.
`focus_lost` and `app_background` each count as one warning (only when `proctoring.enabled`; events are always logged). With `proctoring.autoSubmit` the attempt is
submitted (reason `proctor`) as soon as `warnings >= maxWarnings`. Events for an already submitted attempt are ignored (`ignored:true`, 200).

### `POST /attempts/:id/submit`  (idempotent)
Optional body `{ answers: [...same items as PUT...] }` saved atomically first. -> `{ attempt:{id,status,submitReason,submittedAt,evaluation}, replayed: boolean, resultAvailable: boolean }`.
Second call returns `200` with `replayed:true`. After the deadline the attempt is submitted with `submittedAt = deadlineAt`; the request still succeeds.
Non-coding answers are graded immediately. Coding answers use the best judged submission; unsubmitted editor code is queued for judging, so
`evaluation` may be `pending` for a few seconds (worker) and the result appears afterwards.

### `GET /attempts/:id/result`
Always `200` for the owner once the attempt is submitted (`409 ATTEMPT_NOT_SUBMITTED` before).
```
{ available: false, visibility, releaseAt: closesAt|null, reason: "AFTER_CLOSE"|"MANUAL"|"EVALUATION_PENDING" }
{ available: true, serverNow,
  result: { score, maxScore, percent, passed: boolean|null, rank: number|null, totalParticipants, percentile: number|null,   // rank/percentile null if ranking disabled / practice
            timeTakenSeconds, submitReason, evaluation: "complete"|"pending", warnings,
            sections: [{ id, title, score, maxScore, cutoffMarks|null, cutoffMet: boolean|null }],
            coding: [{ questionId, title, verdict, passed, total, score, maxScore, language|null }] },
  review: null | [{ questionId, sectionId, number, type, title, body, options?, yourAnswer, correctAnswer, correct: "correct"|"partial"|"wrong"|"unanswered", score, maxScore, explanation }] }
```
Visibility: `immediate` after evaluation; `after_close` when `now >= closesAt` (or officer released them); `manual` only after `POST /assessments/:id/results/publish`.
Practice attempts are always immediate with review. `review` is non-null only when `settings.allowReview` (always for practice). Ranking is by effective score
(manual override applies) over each student's best attempt, standard competition ranking (ties share a rank).
`correctAnswer` for coding is omitted; coding review shows verdict counts only.

### Coding
`POST /attempts/:id/run` `{ questionId, language, code (<=32000), stdin?: string (<=10000) }` -> `{ run: { mode: "samples"|"custom", compile: {ok, output?}, results: [{ id?, verdict, passed?, stdout, stderr, expectedOutput?, input?, timeMs, memoryKb }] } }`.
Without `stdin` it runs the sample cases; with `stdin` it runs only that input (no verdict). Rate limit 20 runs per 10 minutes per attempt -> `429 RATE_LIMITED` (`Retry-After`; the 21st run inside 10 minutes is refused).
`POST /attempts/:id/questions/:qid/submit-code` `{ language, code }` -> `{ submission: { id, language, status:"judged", verdict, passed, total, score, maxScore, compileOutput?, samples:[{id,verdict,input,expectedOutput,stdout,timeMs}], hiddenPassed, hiddenTotal, best:{passed,total,score,verdict}, improved: boolean } }`.
Runs every test case; hidden tests expose only counts. The best-scoring submission is kept for grading (ties keep the earliest). Max 50 submissions per question per attempt (`429`).
Verdicts: `accepted | wrong_answer | compile_error | runtime_error | time_limit_exceeded | memory_limit_exceeded | internal_error`.
Judge unreachable / not configured -> **`503 CODE_EXECUTION_UNAVAILABLE`**. For `submit-code` the submission *is stored* as `pending_judge` and a worker re-judges it
(also for final code at submit); the 503 body also carries `submission: {id, status:"pending_judge"}` at top level. `run` stores nothing in that case.
Starter code for `java` must declare `public class Main` (Judge0 convention). Errors common to both: `409 ATTEMPT_ALREADY_SUBMITTED`, `409 DEADLINE_PASSED`, `404` unknown question, `400` language not allowed for the question.

---------------------------------------------------------------------------------------------------------------------

## 5. Grading rules (deterministic)

* Unanswered: 0, never negative. Marks and negative marks come from the assessment question (copied from the bank, overridable).
* `negativeMarking:false` on the assessment disables every deduction.
* `mcq_single`: right = `+marks`, wrong = `-negativeMarks`.
* `mcq_multi` (documented partial credit): let `C` = number of correct options, `S` the chosen set. If `S` contains **any** wrong option -> wrong (`-negativeMarks`, no credit).
  Otherwise score = `marks * |S| / C` (full marks only when `S` equals the correct set; a strict subset is `partial`, no deduction).
* `numeric`: correct when `|answer - value| <= tolerance` (default 0). Wrong -> `-negativeMarks`.
* `short_text`: correct when the normalised answer equals/matches any accepted entry. Wrong -> `-negativeMarks`.
* `coding`: `marks * (sum of weights of passed tests / sum of all weights)`, rounded to 2 decimals, never negative.
* Scores are rounded to 2 decimals per question; section score = sum of its questions; attempt score = sum of sections (not floored at 0).
* `passed` = score meets `passCutoff` (marks or percent of total) **and** every section with `cutoffMarks` meets it. `null` when no cutoff is configured.

Output comparison for coding: line endings normalised; `tokens` mode compares whitespace-separated tokens (trim/whitespace insensitive); `lines` mode compares
lines after right-trimming and dropping trailing blank lines; with `floatTolerance` numeric tokens match when `|a-b| <= tol * max(1,|b|)`.

---------------------------------------------------------------------------------------------------------------------

## 6. Practice

* Practice sets: assessments with `practice:true` (officer sets it, publish needs no window, audience = all students). `GET /practice/assessments` ->
  `{items:[{id,title,durationMinutes,questionCount,totalMarks,attemptsUsed,lastScore}]}`; start them with `POST /my/assessments/:id/start` (unlimited attempts, never ranked, instant result + review).
* Coding practice problems: bank questions with `type:"coding", practice:true, status:"active"`.
  * `GET /practice/problems?q=&difficulty=&topic=&tag=&status=solved|unsolved&cursor=&limit=` -> `{items:[{id,title,difficulty,topic,tags,languages,marks,solved:boolean,attempted:boolean,bestPercent:number}]}`
  * `GET /practice/problems/:id` -> `{problem:{id,title,body,constraints,difficulty,topic,tags,languages,timeLimitMs,memoryLimitMb,starterCode,samples,solved,lastSubmission:{language,code,verdict,passed,total}|null}}`
  * `POST /practice/problems/:id/run` `{language,code,stdin?}` (20 per 10 min per problem) and `POST /practice/problems/:id/submit` `{language,code}`; same response shapes and 503 semantics as the attempt versions. Solved = a submission with every test passed.

---------------------------------------------------------------------------------------------------------------------

## 7. Results and analytics (officer)

* `GET /assessments/:id/results?q=&status=submitted|in_progress|not_attempted&passed=1|0&flagged=1&sort=rank|score|name|time&cursor&limit`
  -> `{ summary:{audience, participants, notAttempted, inProgress, avg, median, max, min, passCount, passRate, pendingEvaluation}, items:[Row], nextCursor, released:boolean }`
  Row `{ rank|null, studentId, name, email, registrationNumber, attemptId|null, attemptNo, status:"submitted"|"in_progress"|"not_attempted", submitReason, evaluation, score, maxScore, percent, passed,
         timeTakenSeconds, sections:[{id,score}], proctorWarnings, flags:{ plagiarism:boolean, overridden:boolean, autoSubmitted:boolean, proctor:boolean }, override:{score,reason}|null }`.
  One row per student (best attempt by effective score; earliest on tie). Ranks: standard competition (1,1,3).
* `GET /assessments/:id/analytics` -> `{ summary, distribution:{ bucketSize:10, buckets:[{fromPercent,toPercent,count}], mean, median, stdDev },
  sections:[{id,title,avgScore,maxScore}], questions:[{ id, sectionId, number, type, title, difficulty, marks, attempted, attemptRate, correctCount, correctPercent, partialCount, avgTimeSeconds, difficultyIndex }] }`
  (`difficultyIndex` = fraction of attempters answering fully correctly, 0..1; avg time is client reported.)
* `GET /assessments/:id/plagiarism?threshold=0.85` -> `{ threshold, pairs:[{ questionId, title, a:{attemptId,studentId,name}, b:{...}, similarity: number, identical: boolean }] }`
  Code is normalised (comments and whitespace removed, identifiers/literals abstracted); identical = same SHA-256 of the token stream; similar = Jaccard on 4-token shingles >= threshold.
  Only submitted non-practice attempts, best coding submission per student. Above 300 submissions per question only exact-hash matches are computed.
* `GET /assessments/:id/attempts/:attemptId` (answer sheet) -> `{ attempt, student, answers:[{ questionId, number, type, title, answer, correctAnswer, correct, score, maxScore, timeSpentMs, flagged,
  submissions?: [{id,language,verdict,passed,total,score,createdAt,tests:[{id,kind,verdict,timeMs}] }] }], proctorEvents:[{type,clientTs,createdAt,counted}], override }`
* `PUT /assessments/:id/attempts/:attemptId/override` `{ score: number|null, reason (3..300) }` -> `{attempt:{id,score,effectiveScore,passed,override}}`; `null` clears. Score 0..maxScore. Audit `assessment.score_override`.
  Effective score = override ?? computed score; regrading never erases an override.
* `POST /assessments/:id/results/publish` -> `{released:true, resultsPublishedAt, notified, alreadyPublished}`; notifies each student who submitted once (`assessment_result`). `POST .../unpublish` -> `{released, resultsPublishedAt:null}` (`released` stays true when visibility is `immediate`, or `after_close` and the window has ended).
* `GET /assessments/:id/results/export` -> `text/csv` (UTF-8 BOM, CRLF, formula-injection safe: cells starting with `= + - @` get a leading `'`). Columns: rank,name,email,registrationNumber,status,score,maxScore,percent,passed,timeTakenSeconds,`<section titles>`,proctorWarnings,flags,submittedAt (IST).
* `POST /assessments/:id/shortlist` `{ minScore? | topN?, driveId?, toStatus, dryRun? (default true), note? }` (exactly one of minScore / topN)
  Selects students by effective score (`>= minScore`) or `rank <= topN` (ties at the boundary included), non-practice, evaluation complete.
  Each matching student's application (non-withdrawn) on the drive is moved with the normal status machine (`toStatus` any of the application statuses), writing an
  `application_events` row (note `"Assessment shortlist: <title> (score X)"`) and an `application_status` notification. Response
  `{ dryRun, criteria, matched, willChange (dry run), changed (real run), unchanged, pendingEvaluation, skipped:[{studentId,name,reason:"NO_APPLICATION"|"INVALID_TRANSITION"}], items:[{studentId,name,score,rank,applicationId,from,to,outcome:"change"|"unchanged"|"skipped",reason?}] }`. Attempts still being evaluated are excluded from `matched` and counted in `pendingEvaluation`.
  Idempotent: re-running changes nobody twice. A real run with attempts still pending evaluation -> `409 EVALUATION_PENDING`. `driveId` defaults to the assessment's drive (else `400`).

---------------------------------------------------------------------------------------------------------------------

## 8. Error code index
`VALIDATION_ERROR 400` `INVALID_JSON 400` `UNAUTHORIZED 401` `FORBIDDEN 403` `ASSESSMENT_NOT_FOUND 404` `QUESTION_NOT_FOUND 404` `ATTEMPT_NOT_FOUND 404`
`NOT_PUBLISHABLE 422` `NOT_PRACTICE_READY 422` `ASSESSMENT_LOCKED 409` `QUESTION_IN_USE 409` `NOT_OPEN_YET 422` `ASSESSMENT_CLOSED 422` `MAX_ATTEMPTS_REACHED 409`
`ATTEMPT_ALREADY_SUBMITTED 409` `ATTEMPT_NOT_SUBMITTED 409` `DEADLINE_PASSED 409` `SECTION_CLOSED 409` `RATE_LIMITED 429` `CODE_EXECUTION_UNAVAILABLE 503`
`EVALUATION_PENDING 409` `SECTION_NOT_NEXT 409` `SECTION_NOT_FOUND 404` `DRIVE_NOT_FOUND 404` `INVALID_TRANSITION (per student, in shortlist response)`.

## 9. Operations notes
* Mounting: `mountAssessments(v1, deps)` in `routes/assessments.ts` (one line at `MODULES-BEGIN` in `app.ts`). Every router lives under its own prefix (`/assessment-questions`, `/assessments`, `/my/assessments`, `/attempts`, `/practice`) and authenticates itself, so nothing shadows other modules.
* Cohorts: the ops module calls `setCohortResolver(fn)` from `assessments/service.ts` (`fn(db, tenantId, cohortId) => Promise<string[]>` of student ids). Alternatively replace the whole `AudienceResolver` with `setAudienceResolver`.
* Judge: `setJudge(client)` (tests) or env `JUDGE0_URL`, `JUDGE0_API_KEY` + `JUDGE0_API_HOST` (RapidAPI style), `JUDGE0_AUTH_TOKEN`, optional `JUDGE0_LANGUAGE_IDS` JSON override (defaults python3 71, java 62, cpp 54, c 50, javascript 63). Code is never executed on this server.
* Seed: `npm run seed` also creates 13 demo questions, a live test, a completed test with graded attempts, and a practice set (`src/assessments/seed.ts`).
* Audit actions: `assessment.published`, `.archived`, `.key_corrected`, `.regraded`, `.score_override`, `.results_published`, `.results_unpublished`, `.shortlist`, `.questions_imported`, `.window_changed`.

## 10. Workers (in-process, started by `index.ts`)
* auto-submit (every 30 s): finalises in-progress attempts whose deadline passed (and whose assessment closed), `FOR UPDATE SKIP LOCKED`.
* judge queue (every 10 s): re-judges `pending_judge` submissions with back-off, then re-grades the attempt (`evaluation` -> `complete`).
* assessment reminders (every 30 s): `t60` / `t15` before `opensAt`.
