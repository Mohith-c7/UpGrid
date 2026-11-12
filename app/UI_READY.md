# Foundation exports (authoritative; code matches this file)

Import via alias `@/ui`, `@/api/hooks`, `@/api/client`, `@/api/types`, `@/theme`, `@/lib/*`, `@/state/session`.
(Relative imports such as `../../src/ui` also resolve to the same files.)

## `src/ui/index.ts`

```ts
type IconName = React.ComponentProps<typeof MaterialIcons>['name'];   // exported as `IconName`
type Tone = 'success'|'warning'|'error'|'info'|'neutral';             // from '@/theme'

Screen({ children, scroll?: boolean, padded?: boolean, onRefresh?: () => void, refreshing?: boolean,
         keyboard?: boolean /* wrap in KeyboardAvoidingView + keyboardShouldPersistTaps */,
         footer?: ReactNode /* sticky bottom bar, safe-area aware */, edges?: ('top'|'bottom')[] })
Text({ variant?: 'display'|'title'|'section'|'body'|'meta'|'button' (default 'body'), color?: string,
       tabular?: boolean, align?: 'left'|'center'|'right', ...RN TextProps })
Button({ label: string, onPress: () => void | Promise<void>, variant?: 'primary'|'secondary'|'ghost'|'danger',
         loading?: boolean, disabled?: boolean, icon?: IconName, full?: boolean, accessibilityLabel?: string })
         // async onPress auto-locks against double taps
TextField({ label: string, value: string, onChangeText: (t: string) => void, error?: string|null, helper?: string,
            keyboardType?: KeyboardTypeOptions, secure?: boolean, multiline?: boolean, maxLength?: number,
            prefix?: string, onBlur?: () => void, placeholder?: string, autoCapitalize?, autoComplete?, textContentType?,
            editable?: boolean, returnKeyType?, onSubmitEditing?: () => void, inputRef?: Ref<TextInput>, suffix?: ReactNode })
PhoneField({ label?: string, value: string, onChangeText: (t: string) => void, error?: string|null, onBlur?: () => void,
             onValidChange?: (ten: string | null) => void })   // fixed +91 prefix, digits only, max 10 digits; value is raw digits
EmailField({ label?: string, value: string, onChangeText: (t: string) => void, error?: string|null /* external/server */,
             onBlur?: () => void, validate?: boolean /* live validation, default true */ })  // shows "Did you mean ...?" with tap-to-fix
PasswordField({ label?: string, value: string, onChangeText: (t: string) => void, error?: string|null, showStrength?: boolean,
                onBlur?: () => void, placeholder?: string })  // show/hide toggle + strength meter
Card({ children, onPress?: () => void, style?: StyleProp<ViewStyle>, accessibilityLabel?: string })
Chip({ label: string, selected?: boolean, onPress?: () => void, tone?: Tone })
Badge({ label: string, tone?: Tone })            // default tone 'neutral'
CompanyLogo({ name: string, logoUrl?: string | null, size?: number })   // initials fallback; default size 44
Avatar({ name: string, logoUrl?: string | null, size?: number })        // same component
Skeleton({ height: number, width?: number | `${number}%`, radius?: number })
EmptyState({ title: string, message?: string, actionLabel?: string, onAction?: () => void, icon?: IconName })
ErrorState({ message?: string, onRetry?: () => void })
OfflineBanner()                                   // renders null when online
Sheet({ visible: boolean, onClose: () => void, title?: string, children })
ProgressBar({ value: number /* 0..1 or 0..100: values >1 treated as percent */, label?: string })
Header({ title: string, onBack?: () => void, right?: ReactNode, subtitle?: string })
SectionHeader({ title: string, action?: { label: string, onPress: () => void } | ReactNode })
SegmentedControl({ value?: string|null, onChange: (v: string) => void, options: { value: string; label: string }[] })
Select({ label: string, value?: string|null, onChange: (v: string) => void, options: { value: string; label: string }[],
         error?: string|null, placeholder?: string })
ToastProvider({ children })   // mounted in root layout
useToast(): { show: (message: string, tone?: 'success'|'error'|'info') => void }
ListRow({ title: string, subtitle?: string, right?: ReactNode, onPress?: () => void, left?: ReactNode, icon?: IconName })
Countdown({ deadline: string /* ISO */, serverOffsetMs?: number /* serverNow - deviceNow */, onExpire?: () => void,
            compact?: boolean })   // "2h 14m left" / "Closes in 38 min" / "Closed"; urgent tone < 1h
Icon({ name: IconName, size?: number, color?: string })
useReduceMotion(): boolean
useIsOnline(): boolean
```

Theme `@/theme`: `colors, spacing (xs..xxxl), radius, MIN_TOUCH, typography, shadow, toneColors, Tone, TextVariant`.

## `src/api/client.ts`
```ts
class ApiError extends Error { code: string; status: number; fields?: Record<string,string>; isNetwork: boolean }
api.get<T>(path, opts?) / api.post<T>(path, body?) / api.put<T>(path, body?) / api.patch<T>(path, body?) / api.delete<T>(path, body?)
   // path is relative to /api/v1 e.g. '/drives?x=1'. Returns parsed JSON. Throws ApiError.
errMessage(e: unknown): string        // friendly message for any error
fieldErrors(e: unknown): Record<string,string>   // ApiError.fields or {}
getServerOffsetMs(): number ; syncServerTime(): Promise<number>
API_URL: string
```

## `src/state/session.ts`
```ts
useSession(): { status: 'loading'|'signedOut'|'signedIn'; user: User|null; role: Role|null }
session.init() / session.setAuth(AuthResponse) / session.clear() / session.getAccessToken() ...
```

## `src/api/hooks.ts`
(`UseQueryResult` etc. from @tanstack/react-query v5. All mutations: call `.mutateAsync(vars)`; reject with `ApiError`.)

```ts
qk                                   // query-key factory
flatten<T>(data?: InfiniteData<Page<T>>): T[]

useAuth(): { user: User|null; role: Role|null; status: 'loading'|'signedOut'|'signedIn';
             login(email: string, password: string): Promise<User>;
             register(body: RegisterBody): Promise<User>;     // RegisterBody {name,email,phone,password,role,inviteCode?}
             logout(): Promise<void>; refreshUser(): Promise<void> }
useServerOffset(): number                                            // ms, serverNow - deviceNow (syncs /time)
useUpdateMe(): Mutation<User|undefined, { name?: string; email?: string; phone?: string }>   // PATCH /me, updates session user
useChangePassword(): Mutation<void, {currentPassword:string; newPassword:string}>
useDeleteAccount(): Mutation<void, void>

// Student profile
useProfile(): UseQueryResult<ProfileResponse>                         // GET /profile
useUpdateProfile(): Mutation<ProfileResponse|void, ProfilePatch>
useResumes(): UseQueryResult<Resume[]>
useAddResume(): Mutation<Resume|void, {label:string; url:string; isDefault?:boolean}>
useDeleteResume(): Mutation<void, string>                             // resume id
useSetDefaultResume(): Mutation<void, string>

// Drives
useDrives(query?: DriveQuery & { limit?: number }): UseInfiniteQueryResult<InfiniteData<Page<DriveSummary>>>   // use flatten(data)
useDrive(id?: string): UseQueryResult<DriveDetail>
useSaveDrive(): Mutation<void, { id: string; saved: boolean }>
useApplyPreview(driveId?: string, enabled?: boolean): UseQueryResult<ApplyPreview>   // POST preview, never cached (staleTime 0)
useApply(): Mutation<ApplyReceipt, { driveId: string; body: ApplyBody }>

// Applications
useApplications(): UseQueryResult<Application[]>
useApplication(id?: string): UseQueryResult<Application>
useWithdrawApplication(): Mutation<void, string>
useRespondToOffer(): Mutation<RespondToOfferResult, { id: string; decision: 'accept'|'decline'; note?: string }>   // POST /applications/:id/respond

// Notifications & reminders
useNotifications(): UseInfiniteQueryResult<InfiniteData<Page<Notification>>>
useUnreadCount(): UseQueryResult<number>                              // polls 60s; refetched on push
useMarkNotificationsRead(): Mutation<void, { ids?: string[]; all?: boolean }>
useReminderSettings(): UseQueryResult<ReminderSettings>
useUpdateReminderSettings(): Mutation<ReminderSettings, ReminderSettings>
useResetReminderSettings(): Mutation<ReminderSettings, void>
useAnnouncements(): UseQueryResult<Announcement[]>
useCreateAnnouncement(): Mutation<Announcement|void, { title: string; body: string; driveId?: string }>

// Officer
useOfficerDashboard(): UseQueryResult<DashboardData>
useCreateDrive(): Mutation<DriveDetail, DrivePayload>
useUpdateDrive(): Mutation<DriveDetail, { id: string; payload: DrivePayload }>
usePublishDrive(): Mutation<DriveDetail, string>
useCloseDrive(): Mutation<DriveDetail, string>
useDuplicateDrive(): Mutation<DriveDetail, string>
useEligibleCount(driveId?: string): UseQueryResult<EligibleCount>
useApplicants(driveId?: string, status?: string): UseQueryResult<Application[]>
useUpdateApplicationStatus(): Mutation<Application|void, { id: string; status: AppStatus; note?: string }>
useStudents(params?: { q?: string; branch?: string; batch?: string; verified?: boolean }): UseInfiniteQueryResult<InfiniteData<Page<StudentSummary>>>
useStudent(id?: string): UseQueryResult<StudentDetail>
useVerifyStudent(): Mutation<void, { id: string; fields: string[] }>
```

## `src/lib/`
`format.ts`: `formatInr(n)`, `formatLpa(n)`, `formatCtc(ctc: Ctc)`, `formatDateTimeIST(iso)`, `formatDateIST(iso)`, `relativeDeadline(iso, offsetMs?)`, `timeAgo(iso)`, `initials(name)`
`validation.ts` (existing), `push.ts` (`registerForPush()`, `unregisterPush()`), `idempotency.ts` (`newIdempotencyKey()`).


## Redesign additions (see DESIGN.md)
New exports from `@/ui`: `DriveCard, StatTile, MetricRow, KeyValueList, StepIndicator, Banner, ScreenHero, BrandLogo, TimelineList, SearchBar, SegmentedTabs, CodeBlock, TestTimerBar, HeaderAction, useTabScreenOptions`. Added optional props: Button `size`, Card `padding/tinted`, Chip `icon`, Badge `icon`, ListRow `last`, SectionHeader `subtitle`, Header `variant`, Screen `background`, ErrorState `title`, ProgressBar `tone`. New `@/theme` exports: `urgentColors, monoFamily, CONTROL_HEIGHT, SCREEN_PADDING, setInterLoaded, fontFamilyFor`.
