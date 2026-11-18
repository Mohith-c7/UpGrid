# UpGrid design system

Flat, calm, indigo. Premium enterprise SaaS: white cards on a light slate canvas (#F8FAFC), hairline borders (#E5E7EB) preferred over shadows, Inter type with restrained weights. Indigo is the brand accent for actions, focus and selection, never a background for everything. No gradients, neon or decorative shapes; no slide/scale/pop animation; fades are 150ms max. Touch targets are 48dp minimum; all text is font-scale safe (wrap, never clip).

Import everything from `@/ui` and tokens from `@/theme`. Never hard-code hex values in screens.

## 1. Tokens (`src/theme.ts`)

| Group | Tokens |
|---|---|
| Brand | Official palette in `palette`. `colors.primary` indigo-600 #4F46E5 (6.3:1 on white), `primaryHover`/`primaryDark` #4338CA (pressed), `primaryDeep` #3730A3, `primarySoft` #6366F1, `primaryTint` #EEF2FF (selected/summary), `primaryTint2` #E0E7FF, `primaryBorder` #C7D2FE. Raw scales: `indigo` (`teal` is a deprecated alias), `slate`, `coral`, `amber` |
| Status | Text-safe: `success` #15803D, `warning` #B45309, `error` #B91C1C, `info` #1D4ED8 (all >= 4.5:1 on white and on their tints). Solid fills for bars, dots, charts and filled buttons: `successSolid` #16A34A, `warningSolid` #D97706, `errorSolid` #DC2626, `infoSolid` #2563EB. Tints: `*Bg`; borders: `*Border`. Urgency (`coral*`, `urgentColors`) now maps to the Danger family. Charts use `chartColors` in order. Toast icons use `onInkSuccess/Error/Info` |
| Neutrals | `ink`/`text` #111827, `textSecondary` #374151, `muted` #64748B (secondary text), `subtle` #6B7280 (icons, placeholders), `canvas` #F8FAFC, `surface` #FFFFFF, `surfaceAlt`, `pressed` #F1F5F9, `border` #E5E7EB (hairline), `borderStrong` #8492A6 (control outline, 3.2:1) |
| Status pairs | `toneColors[tone] = {fg, bg, border}` for `success warning error info neutral`; each fg/bg is >= 5.7:1. `toneIcons[tone]` gives the matching icon. |
| Spacing | `spacing` xs4 sm8 md12 lg16 xl20 xxl24 xxxl32; `SCREEN_PADDING` 16 |
| Radii | `radius.card` 14, `button` 12, `input` 12, `chip` 8, `logo` 12, `sheet` 20 |
| Sizes | `MIN_TOUCH` 48, `CONTROL_HEIGHT` 52 (buttons, fields) |
| Elevation | `shadow.card` only (opacity .05). Everything else: 1px `colors.border`. |
| Type (Inter 400/500/600/700) | `display` 28/34, `title` 22/28, `heading` 18/24, `subhead` 16/22, `body` 15/22, `caption` 13/18, `overline` 12/16 uppercase +0.8 tracking, `button` 15/20. Legacy aliases: `section`=subhead, `meta`=caption. |

Fonts load in `app/_layout.tsx` behind the splash; on failure or after 4s the app falls back to the system font. Use `<Text variant=... tabular>` for all numbers (prices, counts, timers, CGPA). Do not set `fontFamily` yourself; pass `style={{ fontWeight: '600' }}` and `Text` picks the right Inter file.

Icons: one family (`Icon`, Material, outline variants where available), 20px inline / 24px actions and tabs. Meaning is never colour only: status always has icon + text.

## 2. Components

```tsx
// Buttons: 52dp, loading keeps width, async onPress auto-locks. size="sm" is 48dp.
<Button label="Apply now" onPress={apply} full />              // solid indigo
<Button label="Save draft" variant="secondary" onPress={...} />// outline
<Button label="Skip" variant="ghost" onPress={...} />          // text
<Button label="Withdraw" variant="danger" icon="delete-outline" onPress={...} />

// Fields: label above, 52dp, 2px indigo focus ring, error = icon + text
<TextField label="Full name" value={v} onChangeText={set} helper="As on your ID" error={err} />
<EmailField value={e} onChangeText={setE} />  <PhoneField value={p} onChangeText={setP} /> {/* +91 block */}
<PasswordField value={pw} onChangeText={setPw} showStrength />
<Select label="Branch" value={b} onChange={setB} options={[{value:'cse',label:'CSE'}]} />

// Surfaces
<Card>..</Card>  <Card onPress={open} padding={0}>..</Card>  <Card tinted>summary</Card>
<Chip label="Remote" selected onPress={toggle} />      // filter chip, check icon when selected
<Chip label="Bengaluru" icon="place" />                 // static tag
<Badge label="Eligible" tone="success" />               // tinted bg + icon + text
<CompanyLogo name="Infosys" logoUrl={url} size={44} />  // 44 lists / 56 detail; initials fallback, muted tint from name
<Avatar name="Asha Rao" />
<ListRow title="Notifications" subtitle="3 new" icon="notifications-none" onPress={...} last />
<SectionHeader title="Closing soon" action={{ label: 'See all', onPress }} />
<ProgressBar value={0.6} label="Profile 60% complete" />   // flat 6px
<Countdown deadline={iso} serverOffsetMs={off} compact />  // danger text + timer icon under 1h
<Skeleton height={72} />   // static, no shimmer
<EmptyState title="No drives yet" message=".." actionLabel="Refresh" onAction={..} icon="work-outline" />
<ErrorState message={errMessage(e)} onRetry={refetch} />
<Sheet visible onClose title="Filters">..</Sheet>        // 150ms fade only
const toast = useToast(); toast.show('Saved', 'success');

// Navigation / layout
<Screen scroll padded onRefresh={...} footer={<Button .../>} keyboard />
<Header title=".." onBack={..} right={<HeaderAction icon="search" label="Search" onPress={..} />} variant="plain|bar|teal" (teal = white large-title bar) />
<ScreenHero eyebrow="Good morning" title="Asha" subtitle=".." right={..}>{summaryCard}</ScreenHero>
const tabOptions = useTabScreenOptions(); <Tabs screenOptions={tabOptions}> // white bar, hairline, 24px icons, indigo active
<SegmentedControl .../>  // pill switch for 2-3 short options (form choices)
<SegmentedTabs value onChange options={[{value:'open',label:'Open',count:12}]} /> // underline tabs for views
<SearchBar value={q} onChangeText={setQ} placeholder="Search roles or companies" />
```

New patterns:

```tsx
<DriveCard drive={d} onPress={() => router.push(`/(student)/drive/${d.id}`)} onToggleSave={() => toggle(d)} serverOffsetMs={off} />
<DriveCard drive={d} variant="compact" onPress={..} />  // dense: home carousels, saved lists
<StatTile label="Applied" value={12} icon="assignment" hint="+2 this week" />   // put two per row in flex:1 slots
<MetricRow label="Aptitude score" value="82 / 100" />
<KeyValueList items={[{label:'Package',value:'₹12 LPA'},{label:'Location',value:'Pune'}]} inline />
<StepIndicator steps={['Details','Documents','Review']} current={1} />   // flat segmented bar + "Step 2 of 3"
<Banner tone="warning" title="Profile incomplete" message="Add your CGPA to apply." action={{label:'Complete profile', onPress}} />
<TimelineList items={[{title:'Applied',time:'3 Nov',state:'done'},{title:'Interview',state:'current'},{title:'Offer'}]} />
<CodeBlock label="Invite code" code="PLC-2026-AB12" />                    // monospace, selectable
<TestTimerBar remainingMs={rem} totalMs={total} />                         // sticky top of a test screen
<BrandLogo size={56} onDark />
```

DriveCard rules: role max 2 lines, company 1 line, locations show 2 then `+N`, package 1 line with tabular numbers, deadline in danger text with timer icon when under 24h, "Closed" muted, badge = Applied / Eligible / Not eligible / Eligibility pending, bookmark is a 48dp button hidden when `onToggleSave` is omitted.

## 3. Do / Don't

Do: use `Card` + `SectionHeader` to group; keep one primary `Button` per screen/footers; pair every colour with text/icon; use `tabular` for numbers; use `Skeleton` for loading and `EmptyState`/`ErrorState` for empty/failed; use `Screen` for safe areas; let text wrap (`numberOfLines` only on titles you also truncate sensibly).

Don't: use solid status colours (`*Solid`) as small text; use the text-safe status tokens instead; add `Animated` slide/scale/spring/pop; add decorative circles/blobs/gradients; nest cards in cards; put raw hex colours or `fontFamily` in screens; create touch targets under 48dp; block screenshots; show status by colour alone.

## 4. Layout recipes

All screens: `<Screen>` supplies the canvas and safe area. Content padding 16, vertical gap 12-16, section gap 24.

List screen (Opportunities, Applications): `<Screen padded>` -> `Header variant="plain"` title -> `SearchBar` -> `SegmentedTabs` or a horizontal row of `Chip` filters -> `FlatList` of `DriveCard` (`ItemSeparatorComponent` 12px) -> `EmptyState` / `ErrorState` / 4x `Skeleton height={140}` for states. Pull to refresh via `RefreshControl`.

Detail screen (Drive detail): `<Screen padded={false} edges={['bottom']} footer={<Button label="Apply" full/>}>` -> `Header variant="bar"` with back + bookmark `HeaderAction` -> scroll body: `CompanyLogo size={56}` + role (`title`) + company; `Banner` for eligibility problems; `Card` with `KeyValueList` (package, location, deadline, `Countdown`); sections with `SectionHeader` + body text; rounds as `TimelineList`.

Form screen (Apply, Profile edit, Register): `Header variant="bar"` or `ScreenHero` (auth) -> `StepIndicator` if multi-step -> `Card` containing fields (gap 16) -> sticky `footer` with the primary `Button full` (and optional ghost "Back"). Server errors: field `error`, otherwise a `Banner tone="error"` above the footer.

Dashboard (student home / officer dashboard): `<Screen padded={false} edges={['bottom']} scroll>` -> `ScreenHero eyebrow="Good morning" title={name}` with a `Card` child (profile completeness `ProgressBar` or key stat) overlapping the band -> padded body: row of two `StatTile`s, `SectionHeader` "Closing soon" + compact `DriveCard`s, `ListRow`s for shortcuts, `Banner` for alerts.

Test-taking screen: `<Screen edges={['bottom']} padded={false} footer={nav buttons}>` -> `TestTimerBar` pinned at the top (below the status bar: wrap with `useSafeAreaInsets` or place `Screen` edges top) -> question number `overline` + question `heading` -> options as `Card onPress` rows with a check icon on the selected one (no colour-only state) -> question palette with `Chip`s; no animations between questions (swap content directly).

Auth: `ScreenHero brand` (welcome) or `ScreenHero title onBack` (login/register) with the form inside a `Card` overlapping the band.
