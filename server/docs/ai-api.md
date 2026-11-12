# UpGrid — AI API (module `ai`, migrations 030–039)

Base path `/api/v1/ai`, JSON, `Authorization: Bearer <accessJWT>` on every route. Errors use the standard shape
`{ "error": { "code", "message", "fields"? } }`. Lists return `{ items, nextCursor }` (`?cursor=&limit=` 1–50, default 20).
All timestamps ISO-8601 UTC. Provider: Gemini (`@google/genai`). Nothing here ever decides eligibility, selection, scores or status:
every score is **advisory**, every output that can reach another person is a **DRAFT** (`draft: true`) that a human must edit and confirm.

Roles: `student`, `officer`, `recruiter` (recruiter users appear once the pipeline module extends the role set).

## 0. Cross-cutting rules (apps must handle these)

| Situation | HTTP | `error.code` |
|---|---|---|
| `GEMINI_API_KEY` / Vertex env missing | 503 | `AI_NOT_CONFIGURED` |
| `AI_ENABLED=false` (kill switch) | 503 | `AI_DISABLED` |
| Student has not opted in (`ai_consent`) and the endpoint needs personal data | 403 | `AI_CONSENT_REQUIRED` |
| Wrong role | 403 | `FORBIDDEN` |
| Daily quota used up (resets 00:00 UTC; see `GET /ai/status`) | 429 | `AI_QUOTA_EXCEEDED` (+ `Retry-After`) |
| Burst limit (10 AI calls / minute / user) | 429 | `AI_RATE_LIMITED` (+ `Retry-After`) |
| Abuse / jailbreak / prompt-extraction filter hit (no model call, no quota used) | 422 | `AI_REQUEST_REJECTED` |
| Model output failed schema validation twice (one automatic repair attempt) | 502 | `AI_BAD_OUTPUT` |
| Provider error after 1 retry | 502 | `AI_UPSTREAM_ERROR` |
| Provider timeout after 1 retry (`AI_TIMEOUT_MS`, default 25 000) | 504 | `AI_TIMEOUT` |
| Body fails validation | 400 | `VALIDATION_ERROR` (+ `fields`) |

* `features.ai` in `GET /config` is `true` only when configured **and** enabled. Hide AI entry points when false.
* Quota: `AI_DAILY_LIMIT` (default 30) per student per UTC day; `AI_DAILY_LIMIT_STAFF` (default 300) for officers and recruiters. One quota unit = one user-facing model call (a chat turn, a review, a mock-interview start/answer/finish, a generation). Cache hits, rejected requests, automatic repairs and reads cost nothing.
* Every model-backed response carries `usage: { inputTokens, outputTokens, cached: boolean }` and `quota: { limit, used, remaining, resetsAt }`.
* Free text from users, resumes and JDs is treated as untrusted data by the server. Clients render AI text as **plain text** (no HTML); the server also strips markup.
* Server never sends email, phone, registration number or address to the model; names are replaced with `[NAME]` in resume text.

## 1. Status and consent

### GET /ai/status  (any role)
200 `{ "enabled": bool, "configured": bool, "available": bool, "model": "gemini-flash-lite-latest", "quota": { limit, used, remaining, resetsAt }, "consent": { "required": bool, "granted": bool, "grantedAt": iso|null, "version": "v1" } }`
Never 503 — use it to render the screen. `consent.required` is true for students only.

### GET /ai/consent  (student) → 200 `{ granted, grantedAt, revokedAt, version }`
### PUT /ai/consent  (student)
Body `{ "granted": true|false, "deleteData"?: bool }`. Granting stores a timestamp; revoking stops all personal-data use immediately, deletes cached AI outputs, and with `deleteData:true` also deletes conversations and mock interviews. → 200 same shape as GET.
Consent text the app must show: *"Let UpGrid AI use my profile summary (department, batch, CGPA, skills), my resume text and my application/drive details to personalise answers, and let placement officers and recruiters use AI tools (draft interview questions, factual summaries) on the details I share when I apply. Contact details are never sent to the AI, AI output is only a draft reviewed by a person, and it never decides eligibility or selection. I can turn this off any time."*

### DELETE /ai/data  (student) → 200 `{ deleted: { conversations, mockInterviews, cache } }`

### GET /ai/usage  (any role) → 200 `{ today: { limit, used, remaining, resetsAt }, last7Days: [{ day: "YYYY-MM-DD", requests, inputTokens, outputTokens }] }`
### GET /ai/usage/summary?days=7  (officer) → 200 `{ items: [{ day, feature, requests, inputTokens, outputTokens, errors, cached }] }`

## 2. A. Student copilot

Student only. Without consent the chat still works in **general mode** (placement FAQs, plain-language JD explanation of a public drive) but no profile, eligibility, application or offer data is injected; the response says `contextUsed.profile:false` and `consentRequired:true` (true whenever personal context was not used, so the app can show a "turn on personalisation" banner). Personal intents (`explain_eligibility`, `suggest_drives`, `weekly_plan`, `cover_note`, `compare_offers`) return 403 `AI_CONSENT_REQUIRED` without consent.

### POST /ai/chat
Body
```
{ "message": string 1..2000,
  "conversationId"?: uuid,            // omit to start a new conversation
  "driveId"?: uuid,                   // focus drive (JD + eligibility facts for it)
  "intent"?: "explain_eligibility"|"suggest_drives"|"weekly_plan"|"faq"|"explain_jd"|"cover_note"|"compare_offers" }
```
Query `?stream=1` (or `Accept: text/event-stream`) switches to SSE. 

Non-stream 200
```
{ "conversationId": uuid, "title": string,
  "message": { "id": uuid, "role": "assistant", "content": string, "draft": bool, "createdAt": iso },
  "userMessage": { "id": uuid, "role": "user", "content": string, "createdAt": iso },
  "contextUsed": { "profile": bool, "drives": number, "applications": number, "schedule": number },
  "consentRequired": bool,
  "usage": {...}, "quota": {...} }
```
`draft:true` (cover notes, any text meant for others) means content starts with `DRAFT — review and edit before you use this.`; the app must show a "Draft" badge and a Copy action, never auto-send.

SSE (`Content-Type: text/event-stream`, each event `event: <name>\ndata: <json>\n\n`):
* `meta` `{ conversationId, userMessageId }` — first event
* `delta` `{ text }` — zero or more; raw model text chunks (may contain markup that the final message strips)
* `done` `{ message: {...same as above...}, contextUsed, usage, quota }` — **replace the streamed text with `done.message.content`** (sanitised, with draft prefix)
* `error` `{ code, message }` — terminal; same codes as table above. Errors before streaming starts (503, 403, 429, 400, 422) are plain JSON with the HTTP status, not SSE.
Closing the connection aborts the model call; no assistant message is stored.

### GET /ai/conversations?cursor&limit → `{ items: [{ id, title, createdAt, updatedAt, messageCount }], nextCursor }`
### GET /ai/conversations/:id → `{ conversation: {id,title,createdAt,updatedAt}, messages: [{ id, role:'user'|'assistant', content, draft, createdAt }] }` (404 for other users' conversations)
### DELETE /ai/conversations/:id → 200 `{ deleted: true }`

### GET /ai/suggested-prompts?driveId=  → `{ items: [{ id, label, prompt, intent }] }`
Deterministic (no model call, no quota). Examples: "Why am I not eligible for <Company>?", "Plan my week", "Explain this JD", "Compare my offers" (only when ≥2 offers).

Facts rule: eligibility statuses/reasons come from the deterministic engine and are given to the model as FACTS; the model may explain and suggest what to improve but cannot change them. Offers comparison uses only offer data stored in the system.

## 3. B. Resume review (student, consent required)

### POST /ai/resume/review
Body `{ "resumeId"?: uuid, "fileId"?: string, "text"?: string 50..12000, "driveId"?: uuid }` — exactly one of `resumeId|fileId|text`.
* `text`: pasted resume text. Link-only resumes (the default in `/profile/resumes`) cannot be fetched → `resumeId` of a link resume returns 422 `RESUME_NOT_READABLE` ("Paste your resume text instead").
* `fileId` / `resumeId` backed by an uploaded PDF/DOCX in the files module: text is extracted server-side (≤5 MB, 15 s timeout, cached 1 h). Errors: 422 `RESUME_NOT_READABLE`, 413-style `RESUME_TOO_LARGE` (422), `RESUME_UNSUPPORTED_TYPE` (422), 422 `RESUME_EMPTY` (scanned image without text).
* `driveId` adds JD matching (open drives of the tenant only).

200
```
{ "review": {
    "advisory": true,
    "score": 0..100,
    "strengths": string[],
    "gaps": string[],
    "ats_keywords_missing": string[],
    "rewrite_suggestions": [{ "section": string, "before": string, "after": string, "needs_student_input": bool }],
    "jd_match": { "matched_skills": string[], "missing_skills": string[], "percent": 0..100 } | null
  },
  "disclaimer": "Advisory only. This score is not used by recruiters or the placement cell.",
  "usage": {...}, "quota": {...} }
```
Server guarantees: `before` is quoted from the submitted text (otherwise the suggestion is dropped); numbers/metrics in `after` that are not in the original are replaced by `[X]` and `needs_student_input:true` (the student must supply the real number). Nothing is invented. Same input within 24 h is served from cache (`usage.cached:true`).

## 4. C. Mock interview (student)

Consent is needed only for personalisation (`personalise:true` uses profile skills + optional resume text). Without consent the interview uses the role only.

### POST /ai/mock-interview/start
`{ "role": string 2..80, "type": "hr"|"technical"|"behavioural"|"coding_concepts", "difficulty": "easy"|"medium"|"hard", "numQuestions": 3..10, "driveId"?: uuid, "personalise"?: bool (default true), "resumeText"?: string ≤12000 }`
→ 201 `{ interview: { id, role, type, difficulty, numQuestions, status:'in_progress', createdAt, personalised }, question: { index: 1, text }, usage, quota }`

### POST /ai/mock-interview/:id/answer
`{ "answer": string 1..4000, "questionIndex"?: number }` (send `questionIndex` so double-taps replay instead of double-counting)
→ 200 `{ feedback: { summary, strengths: string[], improve: string[], score: 0..10 (advisory) }, next: { index, text } | null, done: bool, replayed?: bool, usage, quota }`
`done:true` once `numQuestions` are answered (then call finish). 409 `INTERVIEW_FINISHED`, 409 `STALE_QUESTION`.

### POST /ai/mock-interview/:id/finish
→ 200 `{ report: { advisory:true, overall: 0..100 (server-computed mean of per-question scores), communication: {score 0..10, notes}, technical_depth: {...}, structure_star: {...}, per_question: [{ index, question, score, comment }], top_tips: string[] }, interview: {...status:'finished'} }`. Idempotent (second call returns the stored report, no quota). Needs ≥1 answer else 422 `NO_ANSWERS`.

### GET /ai/mock-interview?cursor&limit → `{ items: [{ id, role, type, difficulty, status, answered, numQuestions, overall, createdAt }], nextCursor }`
### GET /ai/mock-interview/:id → `{ interview, turns: [{ index, question, answer|null, feedback|null }], report|null }`
### DELETE /ai/mock-interview/:id → `{ deleted: true }`

## 5. D. Recruiter / officer tools (roles `officer`, `recruiter`; students get 403)

Candidate access is checked with `canAccessCandidate(pool, userId, applicationId)` in `src/ai/access.ts`, which delegates to `src/pipeline/access.ts` (`{allowed}` result) when that module exists; until then officers of the same tenant are allowed and recruiters are denied (marked TODO). Not allowed → 404 `NOT_FOUND` (no existence leak). Only the **apply-time shared snapshot** reaches the model (never the live profile): department/program/batch/CGPA, the candidate's answers to the drive's questions, and resume text if a file-backed resume exists or the caller pastes `resumeText`. No name, email, phone, registration number (names are replaced by `[NAME]`). The candidate must also have turned on AI assistance (`ai_consent`); otherwise 403 `CANDIDATE_NO_AI_CONSENT` (server flag `AI_REQUIRE_CANDIDATE_CONSENT=false` disables this check).

### POST /ai/interview-questions
`{ "applicationId": uuid, "roundType": string 2..40, "count": 1..15, "difficulty": "easy"|"medium"|"hard", "focus"?: string[] ≤8, "resumeText"?: string ≤12000 }`
→ 201 `{ questionSet: QuestionSet, usage, quota }`
```
QuestionSet = { id, applicationId, driveId, roundType, difficulty, status: 'draft'|'approved'|'discarded', draft: bool,
  groundedOn: ('resume'|'jd'|'profile')[],
  questions: [{ id, question, why_asked, evidence: { source, quote } | null, evidence_verified: bool,
                expected_points: string[], follow_ups: string[], difficulty,
                rubric: { "1": string, "2": string, "3": string, "4": string, "5": string } }],
  createdBy, createdAt, updatedAt, approvedBy|null, approvedAt|null, scorecardRef|null }
```
`evidence.quote` is verified server-side to appear in the resume/JD/profile text; otherwise `evidence_verified:false` and the app shows "Not verified against resume/JD". Sets are always created as drafts.

* GET /ai/question-sets?applicationId=&status=&cursor&limit → `{ items: QuestionSet[], nextCursor }` (own sets; officers see tenant sets they can access)
* GET /ai/question-sets/:id → `{ questionSet }`
* PATCH /ai/question-sets/:id `{ questions: [...same shape, editable...] }` (draft only; 409 `NOT_DRAFT`)
* POST /ai/question-sets/:id/approve → `{ questionSet }` status `approved` (human confirmation; required before the pipeline can attach it to a scorecard)
* POST /ai/question-sets/:id/discard → `{ questionSet }`
Pipeline integration: approved sets are attached by id (`markQuestionSetAttached(db, id, scorecardRef)` exported from `src/ai/questionSets.ts`).

### POST /ai/candidate-summary
`{ "applicationId": uuid, "resumeText"?: string }` → 200 `{ summary: { draft:true, factual_summary: string, skills_vs_jd: { matched: [{skill, citation}], not_evidenced: string[] }, citations: [{ source:'resume'|'jd'|'profile', quote, verified: bool }], notes: string[] }, disclaimer, usage, quota }`. Contains **no** hire/no-hire recommendation (schema has none and the server removes recommendation language).

### POST /ai/jd/parse  (officer)
`{ "jd": string 40..6000 }` → 200 `{ draft:true, parsed: { role, company|null, skills: string[], qualifications: string[], selection_process: string[], suggested_eligibility: DriveRules (subset of: minCgpa,min10th,min12th,maxActiveBacklogs,maxGapYears,allowedDepartments[],allowedBatches[]), eligibility_evidence: { [criterion]: quote }, suggested_questions: [{ label, type, required, options[] }] }, warnings: string[], usage, quota }`
Eligibility criteria are only kept when the JD literally states them (quote verified); everything is a suggestion the officer reviews in the drive editor.

### POST /ai/mcq/generate  (officer)
`{ "topic": string 2..120, "difficulty": "easy"|"medium"|"hard", "count": 1..10, "tags"?: string[] ≤8 }` → 201 `{ items: McqDraft[], usage, quota }`
`McqDraft = { id, topic, difficulty, tags, stem, options: [4 strings], correctIndex: 0..3, explanation, status:'draft'|'imported'|'discarded', importedQuestionId|null, createdAt }`
* GET /ai/mcq/drafts?status=draft&cursor&limit → `{ items, nextCursor }`
* PATCH /ai/mcq/drafts/:id `{ stem?, options?, correctIndex?, explanation?, tags? }` (draft only)
* POST /ai/mcq/drafts/:id/discard
* POST /ai/mcq/import `{ ids: uuid[] ≤50 }` → `{ imported: [{draftId, questionId}], skipped: [{draftId, reason}] }`. Needs the assessments question-bank adapter (`registerQuestionBankAdapter()` in `src/ai/questionBank.ts`); until the integrator registers it: 501 `QUESTION_BANK_NOT_LINKED`. Drafts are never published automatically.

### POST /ai/announcement/draft  (officer)
`{ "points": string 5..1500, "driveId"?: uuid, "tone"?: "neutral"|"urgent"|"friendly" }` → 200 `{ draft:true, announcement: { title ≤120, body ≤1200 }, warnings: string[], usage, quota }`. Dates/numbers not present in `points`/drive facts are flagged in `warnings`. Send through the existing `POST /announcements` after editing; AI never sends.

### POST /ai/policy/draft  (officer)
`{ "instruction": string 5..1000 }` → 200 `{ draft:true, approved:false, rules: DriveRules, explanation: string, unsupported: string[], simulation: { total, eligible, not_eligible, pending, byCriterion: { [criterion]: failedCount } }, usage, quota }`
`rules` is validated against the eligibility rule schema; `simulation` is computed deterministically against current student profiles. The officer must review the simulation and apply it through the drive/policy editor — the AI never saves a rule.

## 6. Environment

`GEMINI_API_KEY` or Vertex (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, optional `GOOGLE_APPLICATION_CREDENTIALS_JSON`); `AI_MODEL` (default `gemini-flash-lite-latest`); `AI_ENABLED` (default true); `AI_DAILY_LIMIT` (30); `AI_DAILY_LIMIT_STAFF` (300); `AI_TIMEOUT_MS` (25000).
