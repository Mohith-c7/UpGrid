import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Chip, EmptyState, SectionHeader, Select, SegmentedControl, Skeleton, Text, TextField } from '@/ui';
import { Icon } from '@/ui';
import { colors, MIN_TOUCH, radius, toneColors } from '@/theme';
import { Page, sp } from '@/features/student/me/kit';
import { flatten, useDrives, useResumes } from '@/api/hooks';
import { aiErrorKind, useResumeReview } from '@/api/ai';
import type { ResumeReview, ResumeReviewResult, RewriteSuggestion } from '@/api/aiTypes';
import { AiErrorBanner, AiGate, AI_ROUTES, ConsentPanel, QuotaMeter, CopyShareRow } from '@/features/ai/kit';

const MIN_CHARS = 50;
const MAX_CHARS = 12000;

export default function ResumeReviewScreen() {
  const router = useRouter();
  const [result, setResult] = React.useState<ResumeReviewResult | null>(null);
  return (
    <Page
      title="Resume review"
      keyboard
      onBack={() => (router.canGoBack() ? router.back() : router.replace(AI_ROUTES.hub as never))}
    >
      <AiGate>
        {(status) =>
          !status.consent.granted ? (
            <View style={{ gap: sp.lg }}>
              <Banner tone="info" title="Permission needed" message="Resume review reads your resume text, so it needs your permission first." />
              <ConsentPanel granted={false} compact />
            </View>
          ) : result ? (
            <ReviewResult data={result} onAgain={() => setResult(null)} />
          ) : (
            <ReviewForm quota={status.quota} onDone={setResult} onConsent={() => router.push(AI_ROUTES.consent as never)} />
          )
        }
      </AiGate>
    </Page>
  );
}

function ReviewForm({ quota, onDone, onConsent }: { quota: any; onDone: (r: ResumeReviewResult) => void; onConsent: () => void }) {
  const resumes = useResumes();
  const drives = useDrives({ status: 'open', limit: 20 });
  const review = useResumeReview();
  const [mode, setMode] = React.useState<'pick' | 'paste'>('paste');
  const [resumeId, setResumeId] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [driveId, setDriveId] = React.useState('');
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (resumeId == null && resumes.data?.length) {
      setResumeId((resumes.data.find((r) => r.isDefault) ?? resumes.data[0]).id);
    }
  }, [resumes.data, resumeId]);

  const driveOptions = React.useMemo(
    () => [{ value: '', label: 'No drive (general review)' }, ...flatten(drives.data).map((d) => ({ value: d.id, label: `${d.company.name} - ${d.role}` }))],
    [drives.data],
  );
  const tooShort = text.trim().length < MIN_CHARS;
  const canSubmit = mode === 'pick' ? !!resumeId : !tooShort;
  const out = !!quota && quota.remaining <= 0;

  const submit = async () => {
    setHint(null);
    try {
      const body = mode === 'pick' ? { resumeId: resumeId!, driveId: driveId || undefined } : { text: text.trim(), driveId: driveId || undefined };
      onDone(await review.mutateAsync(body));
    } catch (e) {
      if (aiErrorKind(e) === 'resume_unreadable') {
        setMode('paste');
        setHint('That resume is stored as a link, which the AI cannot open. Paste the text of your resume below instead.');
      }
    }
  };

  return (
    <View style={{ gap: sp.xl }}>
      <Card tinted>
        <View style={{ gap: sp.md }}>
          <Text variant="body" color={colors.textSecondary}>Get an advisory score and wording suggestions. Recruiters and the placement cell never see this score.</Text>
          <QuotaMeter quota={quota} />
        </View>
      </Card>

      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as 'pick' | 'paste')}
        options={[{ value: 'paste', label: 'Paste text' }, { value: 'pick', label: 'Saved resume' }]}
      />

      {hint ? <Banner tone="info" message={hint} /> : null}

      {mode === 'pick' ? (
        resumes.isLoading ? (
          <Skeleton height={72} radius={14} />
        ) : resumes.isError ? (
          <Banner tone="error" message="Could not load your resumes. Switch to Paste text or try again." action={{ label: 'Retry', onPress: () => void resumes.refetch() }} />
        ) : (resumes.data ?? []).length === 0 ? (
          <EmptyState icon="description" title="No saved resumes" message="Add a resume link in your profile, or paste the text instead." actionLabel="Paste text" onAction={() => setMode('paste')} />
        ) : (
          <View style={{ gap: sp.sm }}>
            <Text variant="caption" color={colors.muted}>Only uploaded files can be read. Link resumes need pasted text.</Text>
            {(resumes.data ?? []).map((r) => {
              const sel = r.id === resumeId;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setResumeId(r.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel, checked: sel }}
                  accessibilityLabel={`${r.label}${r.isDefault ? ', default' : ''}`}
                  style={{
                    minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: radius.card, borderWidth: sel ? 2 : 1,
                    borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primaryTint : colors.surface,
                  }}
                >
                  <Icon name={sel ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} color={sel ? colors.primary : colors.subtle} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body" style={{ fontWeight: '600' }} numberOfLines={2}>{r.label}</Text>
                    {r.isDefault ? <Text variant="caption" color={colors.muted}>Default</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )
      ) : (
        <TextField
          label="Resume text"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={MAX_CHARS}
          placeholder="Paste your resume here"
          helper={`${text.trim().length} / ${MAX_CHARS} characters. Do not include phone or address.`}
          error={text.length > 0 && tooShort ? `Add at least ${MIN_CHARS} characters` : null}
        />
      )}

      <Select label="Match to a drive (optional)" value={driveId} onChange={setDriveId} options={driveOptions} />

      {review.isError ? <AiErrorBanner error={review.error} onRetry={submit} onConsent={onConsent} /> : null}
      <Button label={review.isPending ? 'Reviewing...' : 'Review my resume'} icon="auto-awesome" full loading={review.isPending} disabled={!canSubmit || out} onPress={submit} />
      {out ? <Text variant="caption" color={colors.muted} align="center">Daily AI limit reached. Try again after 5:30 AM IST.</Text> : null}
    </View>
  );
}

/** Text with [X] placeholders highlighted (icon-free but bold + tinted so it is not colour-only: the brackets stay visible). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\[X\])/g);
  return (
    <Text variant="body" selectable>
      {parts.map((p, i) =>
        p === '[X]' ? (
          <Text key={i} variant="body" style={{ fontWeight: '700', backgroundColor: toneColors.warning.bg }} color={toneColors.warning.fg}>{'[X]'}</Text>
        ) : (
          <Text key={i} variant="body">{p}</Text>
        ),
      )}
    </Text>
  );
}

function Suggestion({ s }: { s: RewriteSuggestion }) {
  return (
    <Card>
      <View style={{ gap: sp.md }}>
        <View style={{ gap: sp.sm }}>
          <Text variant="subhead">{s.section}</Text>
          {s.needs_student_input ? <View style={{ flexDirection: 'row' }}><Badge label="Needs your input" tone="warning" icon="edit" /></View> : null}
        </View>
        <View style={{ gap: sp.xs }}>
          <Text variant="overline" color={colors.muted}>Before</Text>
          <View style={{ padding: sp.md, borderRadius: radius.button, backgroundColor: colors.neutralBg }}>
            <Text variant="body" selectable>{s.before}</Text>
          </View>
        </View>
        <View style={{ gap: sp.xs }}>
          <Text variant="overline" color={colors.primaryDark}>After</Text>
          <View style={{ padding: sp.md, borderRadius: radius.button, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: colors.primaryTint2 }}>
            <Highlighted text={s.after} />
          </View>
        </View>
        {s.needs_student_input ? (
          <Banner tone="warning" message="Replace each [X] with your real number before using this line. We never invent figures." />
        ) : null}
        <CopyShareRow text={s.after} label="Line" />
      </View>
    </Card>
  );
}

function ListBlock({ title, items, icon }: { title: string; items: string[]; icon: 'check-circle' | 'error-outline' }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: sp.sm }}>
      <SectionHeader title={title} />
      <Card>
        <View style={{ gap: sp.md }}>
          {items.map((t, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: sp.sm }}>
              <Icon name={icon} size={20} color={icon === 'check-circle' ? colors.success : colors.warning} />
              <Text variant="body" style={{ flex: 1, minWidth: 0 }}>{t}</Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

function ReviewResult({ data, onAgain }: { data: ResumeReviewResult; onAgain: () => void }) {
  const r: ResumeReview = data.review;
  const score = Math.max(0, Math.min(100, Math.round(r.score ?? 0)));
  return (
    <View style={{ gap: sp.xl }}>
      <Card tinted>
        <View style={{ gap: sp.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm, flexWrap: 'wrap' }}>
            <Text variant="display" tabular>{String(score)}</Text>
            <Text variant="subhead" color={colors.muted}>/ 100</Text>
          </View>
          <View style={{ flexDirection: 'row' }}><Badge label="Advisory score" tone="info" icon="info-outline" /></View>
          <Text variant="caption" color={colors.muted}>{data.disclaimer}</Text>
          {data.usage?.cached ? <Text variant="caption" color={colors.muted}>Same resume as before, so this result was reused and did not use your quota.</Text> : null}
        </View>
      </Card>

      <ListBlock title="Strengths" items={r.strengths ?? []} icon="check-circle" />
      <ListBlock title="Gaps" items={r.gaps ?? []} icon="error-outline" />

      {(r.ats_keywords_missing ?? []).length ? (
        <View style={{ gap: sp.sm }}>
          <SectionHeader title="Keywords to consider" subtitle="Only add these if they are true for you." />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {(r.ats_keywords_missing ?? []).map((k) => <Chip key={k} label={k} />)}
          </View>
        </View>
      ) : null}

      {r.jd_match ? (
        <View style={{ gap: sp.sm }}>
          <SectionHeader title="Match with the drive" />
          <Card>
            <View style={{ gap: sp.md }}>
              <Text variant="heading" tabular>{`${Math.round(r.jd_match.percent)}% skills match`}</Text>
              {(r.jd_match.matched_skills ?? []).length ? (
                <View style={{ gap: sp.xs }}>
                  <Text variant="caption" color={colors.muted}>Matched</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>{(r.jd_match.matched_skills ?? []).map((k) => <Chip key={k} label={k} tone="success" icon="check" />)}</View>
                </View>
              ) : null}
              {(r.jd_match.missing_skills ?? []).length ? (
                <View style={{ gap: sp.xs }}>
                  <Text variant="caption" color={colors.muted}>Not found in your resume</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>{(r.jd_match.missing_skills ?? []).map((k) => <Chip key={k} label={k} tone="warning" />)}</View>
                </View>
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Suggested rewrites" />
        {(r.rewrite_suggestions ?? []).length === 0 ? (
          <EmptyState icon="thumb-up-off-alt" title="No rewrites suggested" message="Nothing in your resume needed rewording." />
        ) : (
          (r.rewrite_suggestions ?? []).map((s, i) => <Suggestion key={i} s={s} />)
        )}
      </View>

      <Button label="Review another resume" variant="secondary" icon="refresh" full onPress={onAgain} />
    </View>
  );
}
