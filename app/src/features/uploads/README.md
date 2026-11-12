# Uploads (Cloudflare R2, presigned)

Flow: pick -> validate type/size -> `POST /files/presign` -> `PUT` bytes to R2 (progress) -> `POST /files/:id/confirm`.
Limits come from `GET /config` (`limits.resumeMb` etc, defaults 5/2/1/5 MB). Everything is hidden/disabled when `features.fileUploads` is false.
Import from `@/features/uploads`.

## `<ResumeUploader />` (student)
| prop | type | notes |
|---|---|---|
| `onSaved?` | `(resume: ResumeEntry \| undefined, file: UploadedFile) => void` | after `POST /profile/resumes {label, fileId}` succeeded; `qk.resumes` and `qk.profile` are invalidated for you |
| `isDefault?` | boolean | make the new resume the default |
| `disabled?` / `disabledReason?` | boolean / string | e.g. when the student already has 5 resumes (server: 409 `RESUME_LIMIT`) |
| `fallback?` | ReactNode | shown instead when uploads are off (e.g. the existing link form); default nothing |

Put it on the Resumes screen above or below the link form: `<ResumeUploader disabled={list.length >= 5} fallback={null} />`.
Resume entries now carry `kind: 'file' | 'link'`, `fileId`, `fileName`, `size`, and `url` is **null for files**. Screens that print `r.url` must branch on `kind` (type: `ResumeEntry` in `@/api/integrationsTypes`). Open a file with `fileUrl(fileId)` from `@/api/integrations` (signed URL, 300 s, never cache) and `Linking.openURL`.

## `<LogoUploader />` (officer)
| prop | type | notes |
|---|---|---|
| `companyName` | string | initials fallback in the preview |
| `currentUrl?` | string \| null | existing `company.logoUrl` |
| `onChange` | `(v: { fileId, previewUrl } \| null) => void` | `null` = officer removed the logo |
| `fallback?`, `disabled?` | | |

On save send `company: { ..., logoFileId: v ? v.fileId : null }` (`null` clears). Errors from the drive save: `422 LOGO_PUBLIC_URL_NOT_CONFIGURED` (server has no `R2_PUBLIC_BASE_URL`), `400` `fields["company.logoFileId"]`.

## `useFileUpload(purpose, { onDone? })`
Purposes: `resume | photo | company_logo | document`. Returns
`{ phase: 'idle'|'working'|'done'|'error', stage, progress (0..1), file, result, error: {message, retryable, code} | null, enabled, limits, pick(), retry(), cancel(), reset() }`.
`pick()` opens the system picker (expo-document-picker) with the allowed types, checks extension/type and size, then uploads. `retry()` repeats only the failed step (confirm-only when the bytes are already uploaded). `<UploadStatus upload={up} />` renders progress, Cancel, Retry and Choose another.
Photos: `useFileUpload('photo')` works the same (pick from files; no camera/gallery permission needed).

## Lower level (`uploadFile.ts`)
`startUpload({ purpose, file: {uri,name,mimeType?,size?}, limits, onProgress?, onStage?, resumeFileId? }) -> { promise: Promise<UploadedFile>, cancel() }`, `checkPicked()`, `resolveContentType()`, `UploadError {code, stage, retryable, fileId?}`.
Errors you may see: `INVALID_FILE`, `OFFLINE`, `NETWORK`, `TIMEOUT`, `URL_EXPIRED` (auto re-presigned once), `FILE_QUOTA_EXCEEDED` (20 ready files per user), `FILE_MISMATCH`, `FILE_STORAGE_NOT_CONFIGURED`, `RATE_LIMITED`.
Delete a stored file: `deleteFile(id)` (`409 FILE_IN_USE` when attached to an application).
