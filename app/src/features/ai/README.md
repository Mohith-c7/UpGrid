# AI feature components (officer / recruiter)

Reusable, route-less components for the staff-side AI tools. They call `/api/v1/ai/*` through hooks in `src/api/ai.ts` (types in `src/api/aiTypes.ts`).
Import from `@/features/ai`. All AI output is a draft: nothing is sent, attached or published until a person confirms.
Every component handles loading, error (quota, rate limit, not configured, disabled, candidate has no AI consent, offline) and retry itself.
Mount them only when `useFeature('ai')` (from `@/config/features`) is true; the server also answers 503 `AI_NOT_CONFIGURED` / `AI_DISABLED`.
Staff roles only (students get 403). Recruiters need candidate access on the server (`canAccessCandidate`), else the server returns 404.

```tsx
import { useFeature } from '@/config/features';
import { QuestionSetEditor, CandidateSummaryCard, AnnouncementDraftButton, McqGenerateSheet } from '@/features/ai';
```

## QuestionSetEditor
Generate interview questions from a candidate's apply-time snapshot (POST `/ai/interview-questions`), then edit, save, approve or discard
(PATCH / `approve` / `discard` on `/ai/question-sets/:id`). Shows evidence with "Not verified against resume/JD" when the quote could not be checked.

| Prop | Type | Notes |
|---|---|---|
| `applicationId` | `string` (required) | Application the questions are about |
| `defaultRoundType` | `string?` | Pre-fills the round field (2 to 40 chars) |
| `resumeText` | `string?` | Pasted resume text, forwarded to the server (max 12000) |
| `initialSet` | `QuestionSet?` | Open an existing set (e.g. from `GET /ai/question-sets`) instead of the generate form |
| `onApproved` | `(set: QuestionSet) => void` | After approval. Attach by id in the pipeline scorecard (`set.id`) |
| `onDiscarded` | `(set: QuestionSet) => void` | After discard |
| `onChange` | `(set: QuestionSet) => void` | Any stored change (generated, saved, approved, discarded) |

Edits (question text, expected points, follow-ups, removing questions) are only possible while `status === 'draft'`. Approve saves pending edits first.

## CandidateSummaryCard
Factual, cited summary versus the JD (POST `/ai/candidate-summary`). Always badged Draft. No hire or no-hire recommendation.

| Prop | Type | Notes |
|---|---|---|
| `applicationId` | `string` (required) | |
| `resumeText` | `string?` | |
| `autoLoad` | `boolean?` | Generate on mount (spends one AI request). Default: wait for a tap |
| `onLoaded` | `(r: CandidateSummaryResult) => void` | |

## AnnouncementDraftButton
Button that opens a sheet: officer enters bullet points and tone, gets an editable title and body (POST `/ai/announcement/draft`) with `warnings` for dates or numbers not in the input.

| Prop | Type | Notes |
|---|---|---|
| `onUse` | `(d: { title: string; body: string }) => void` (required) | Fill your announcement form with it, then send via `POST /announcements` yourself |
| `driveId` | `string?` | Lets the AI use that drive's facts |
| `label` | `string?` | Default "Draft with AI" |
| `disabled` | `boolean?` | |

## McqGenerateSheet
Bottom sheet: topic, difficulty, count, tags, generate MCQ drafts (POST `/ai/mcq/generate`), edit stem/options/correct option/explanation, discard,
then import the selected drafts (POST `/ai/mcq/import`). If the question bank adapter is not registered the server returns 501 `QUESTION_BANK_NOT_LINKED` and the sheet says so.

| Prop | Type | Notes |
|---|---|---|
| `visible` | `boolean` (required) | |
| `onClose` | `() => void` (required) | |
| `onImported` | `(r: McqImportResult) => void` | `{ imported: [{draftId, questionId}], skipped: [...] }`; refresh your question list here |
| `defaultTopic` | `string?` | |
| `defaultTags` | `string[]?` | |

## Student side (for reference)
Routes live under `app/(student)/ai/*`: `index` (hub), `chat`, `history`, `resume-review`, `mock-interview/index` and `[id]`, `consent` (AI privacy).
`AiHomeCard` is the Home entry; the Profile tab has an "AI assistant and privacy" row. Both hide when `features.ai` is false.
