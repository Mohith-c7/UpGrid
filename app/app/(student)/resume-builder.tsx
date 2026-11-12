import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, ErrorState, SectionHeader, SegmentedControl, Skeleton, Text, TextField, useToast } from '@/ui';
import { colors, radius } from '@/theme';
import { Page, confirm, sp } from '@/features/student/me/kit';
import { useAuth, useProfile, useResumes } from '@/api/hooks';
import { useFeatures } from '@/config/features';
import { ApiError, errMessage } from '@/api/client';
import {
  LIMITS, TEMPLATES, buildDoc, draftFromProfile, emptyEducation, emptyExperience, emptyProject, safeFileName, validateDraft,
  type DraftErrors, type EducationItem, type ExperienceItem, type ProjectItem, type ResumeDraft, type TemplateId,
} from '@/features/resumeBuilder/model';
import { renderResumeHtml } from '@/features/resumeBuilder/html';
import { clearDraft, loadDraft, saveDraft } from '@/features/resumeBuilder/store';
import { makePdf, savePdfAsResume, sharePdf } from '@/features/resumeBuilder/exportPdf';
import { UploadError } from '@/features/uploads';

type Mode = 'edit' | 'preview';

function RemoveRow({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button label={label} icon="delete-outline" size="sm" variant="ghost" onPress={onPress} />;
}

export default function ResumeBuilderScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { flags, config } = useFeatures();
  const profileQ = useProfile();
  const resumesQ = useResumes();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/prep' as never)), [router]);

  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [showErrors, setShowErrors] = useState(false);
  const [label, setLabel] = useState('Built with resume builder');
  const [busy, setBusy] = useState<null | 'share' | 'save'>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const lock = useRef(false);

  /* hydrate: stored draft wins, else profile prefill. Nothing else is invented. */
  useEffect(() => {
    if (draft || !profileQ.data || !user) return;
    let alive = true;
    (async () => {
      const stored = await loadDraft(user.id);
      if (!alive) return;
      const base = draftFromProfile(profileQ.data, user);
      setDraft(stored ? { ...base, ...stored, education: stored.education?.length ? stored.education : base.education } : base);
    })();
    return () => { alive = false; };
  }, [draft, profileQ.data, user]);

  /* debounced local save */
  useEffect(() => {
    if (!draft || !user) return;
    const t = setTimeout(() => saveDraft(user.id, draft), 800);
    return () => clearTimeout(t);
  }, [draft, user]);

  const errors: DraftErrors = useMemo(() => (draft ? validateDraft(draft) : {}), [draft]);
  const errCount = Object.keys(errors).length;
  const e = (k: string) => (showErrors ? errors[k] : undefined);
  const set = useCallback((p: Partial<ResumeDraft>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);

  const html = useMemo(() => (draft && mode === 'preview' ? renderResumeHtml(buildDoc(draft), draft.template, { preview: true }) : ''), [draft, mode]);
  const resumeCount = (resumesQ.data ?? []).length;
  const canSave = flags.fileUploads === true;
  const fileName = draft ? safeFileName(draft.name) : 'Resume.pdf';

  const goPreview = () => {
    if (!draft) return;
    setShowErrors(true);
    if (errCount > 0) { toast.show('Fix the highlighted fields first', 'error'); return; }
    setMode('preview');
  };

  const pdf = async () => {
    if (!draft) throw new Error('Nothing to export');
    return makePdf(renderResumeHtml(buildDoc(draft), draft.template), fileName);
  };

  const share = async () => {
    if (lock.current) return;
    lock.current = true; setBusy('share');
    try { await sharePdf(await pdf()); } catch (x) { toast.show(errMessage(x), 'error'); } finally { lock.current = false; setBusy(null); }
  };

  const save = async () => {
    if (lock.current || !draft) return;
    const l = label.trim();
    if (l.length < 1 || l.length > 60) { toast.show('Give the resume a label of up to 60 characters', 'error'); return; }
    lock.current = true; setBusy('save');
    try {
      const uri = await pdf();
      await savePdfAsResume({ uri, fileName, label: l, limits: config.limits, isDefault: resumeCount === 0 });
      await resumesQ.refetch();
      setSavedOnce(true);
      toast.show('Saved to your resumes', 'success');
    } catch (x) {
      if (x instanceof ApiError && x.code === 'RESUME_LIMIT') toast.show('You already have 5 resumes. Delete one, or share the PDF instead.', 'error');
      else if (x instanceof UploadError || x instanceof ApiError) toast.show(`${x.message} You can still share the PDF.`, 'error');
      else toast.show(errMessage(x), 'error');
    } finally { lock.current = false; setBusy(null); }
  };

  const startOver = () => confirm('Start over?', 'This clears everything you typed and refills from your profile.', 'Start over', () => {
    if (user) clearDraft(user.id);
    setDraft(profileQ.data && user ? draftFromProfile(profileQ.data, user) : null);
    setShowErrors(false); setMode('edit'); setSavedOnce(false);
  });

  /* ------------------------------------------------------------ states */
  if (profileQ.isLoading || (profileQ.data && !draft)) {
    return <Page title="Resume builder" onBack={back}><View style={{ gap: sp.lg }}><Skeleton height={140} radius={14} /><Skeleton height={220} radius={14} /><Skeleton height={140} radius={14} /></View></Page>;
  }
  if (profileQ.isError || !draft) {
    return <Page title="Resume builder" onBack={back}><ErrorState message={errMessage(profileQ.error)} onRetry={() => void profileQ.refetch()} /></Page>;
  }

  /* ----------------------------------------------------------- preview */
  if (mode === 'preview') {
    const full = resumeCount >= 5;
    return (
      <Page
        title="Preview" subtitle="Same layout as the PDF" onBack={() => setMode('edit')} gap={sp.lg}
        footer={
          <View style={{ gap: sp.sm }}>
            <Button label="Share PDF" icon="share" full loading={busy === 'share'} disabled={busy === 'save'} onPress={share} />
            {canSave ? (
              <Button label={savedOnce ? 'Saved to resumes' : 'Save to my resumes'} icon="save-alt" variant="secondary" full loading={busy === 'save'}
                disabled={busy === 'share' || savedOnce || full} onPress={save} />
            ) : null}
          </View>
        }
      >
        <SegmentedControl value={draft.template} onChange={(v) => set({ template: v as TemplateId })} options={TEMPLATES.map((t) => ({ value: t.value, label: t.label }))} />
        <Text variant="caption" color={colors.muted}>{TEMPLATES.find((t) => t.value === draft.template)?.hint}. Single column, plain text, standard headings so applicant tracking systems can read it.</Text>
        <View style={{ height: 520, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface }}>
          <WebView
            originWhitelist={['about:blank']} source={{ html }} scalesPageToFit nestedScrollEnabled javaScriptEnabled={false}
            setBuiltInZoomControls={false} accessibilityLabel="Resume preview" style={{ backgroundColor: colors.surface }}
            onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:')}
          />
        </View>
        {canSave ? (
          <Card>
            <View style={{ gap: sp.md }}>
              <TextField label="Label in your resumes" value={label} onChangeText={setLabel} maxLength={60} helper={full ? 'You have 5 resumes already. Delete one to save this.' : 'Shown when you pick a resume to apply with.'} />
            </View>
          </Card>
        ) : (
          <Banner tone="info" message="File storage is off on this server, so the PDF cannot be saved to your resumes. Share it, then add it as a link from your cloud drive." />
        )}
        {savedOnce ? <Banner tone="success" message="Saved. You can choose it when you apply." action={{ label: 'View resumes', onPress: () => router.push('/(student)/profile/resumes' as never) }} /> : null}
      </Page>
    );
  }

  /* -------------------------------------------------------------- edit */
  const upEdu = (i: number, p: Partial<EducationItem>) => set({ education: draft.education.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const upProj = (i: number, p: Partial<ProjectItem>) => set({ projects: draft.projects.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const upExp = (i: number, p: Partial<ExperienceItem>) => set({ experience: draft.experience.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  return (
    <Page
      title="Resume builder" onBack={back} keyboard gap={sp.xl}
      right={<Button label="Start over" variant="ghost" size="sm" onPress={startOver} />}
      footer={<Button label="Preview resume" icon="visibility" full onPress={goPreview} />}
    >
      <Banner tone="info" message="Your name, contact, links, education and skills are filled from your profile. Projects, experience and achievements start empty: add only what is true. Your draft is kept on this device." />
      {showErrors && errCount > 0 ? <Banner tone="error" title={`Fix ${errCount} ${errCount === 1 ? 'item' : 'items'}`} message={errors.content ?? 'The highlighted fields need your attention before you can preview.'} /> : null}

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Contact" />
        <Card><View style={{ gap: sp.lg }}>
          <TextField label="Full name" value={draft.name} onChangeText={(v) => set({ name: v })} error={e('name')} maxLength={80} />
          <TextField label="Email" value={draft.email} onChangeText={(v) => set({ email: v })} error={e('email')} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
          <TextField label="Mobile" value={draft.phone} onChangeText={(v) => set({ phone: v })} error={e('phone')} keyboardType="phone-pad" maxLength={20} />
          <TextField label="City, state" value={draft.city} onChangeText={(v) => set({ city: v })} error={e('city')} maxLength={80} />
          <TextField label="LinkedIn (https)" value={draft.linkedin} onChangeText={(v) => set({ linkedin: v })} error={e('linkedin')} keyboardType="url" autoCapitalize="none" maxLength={300} />
          <TextField label="GitHub (https)" value={draft.github} onChangeText={(v) => set({ github: v })} error={e('github')} keyboardType="url" autoCapitalize="none" maxLength={300} />
          <TextField label="Portfolio (https)" value={draft.portfolio} onChangeText={(v) => set({ portfolio: v })} error={e('portfolio')} keyboardType="url" autoCapitalize="none" maxLength={300} />
        </View></Card>
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Summary" subtitle="Optional. One or two lines in your own words" />
        <Card><TextField label="Summary" value={draft.summary} onChangeText={(v) => set({ summary: v })} error={e('summary')} multiline maxLength={600} /></Card>
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Education" subtitle="From your profile. Change it in Profile > Academics to keep it verified" />
        {draft.education.map((x, i) => (
          <Card key={x.id}><View style={{ gap: sp.lg }}>
            <TextField label="Institution" value={x.institution} onChangeText={(v) => upEdu(i, { institution: v })} error={e(`edu.${i}.institution`)} maxLength={120} />
            <TextField label="Degree and branch" value={x.degree} onChangeText={(v) => upEdu(i, { degree: v })} maxLength={120} />
            <TextField label="Period" value={x.period} onChangeText={(v) => upEdu(i, { period: v })} maxLength={40} />
            <TextField label="Score" value={x.score} onChangeText={(v) => upEdu(i, { score: v })} maxLength={40} />
            <TextField label="Extra lines (one per line)" value={x.details} onChangeText={(v) => upEdu(i, { details: v })} error={e(`edu.${i}.details`)} multiline maxLength={400} />
            {draft.education.length > 1 ? <RemoveRow label="Remove education" onPress={() => set({ education: draft.education.filter((_, j) => j !== i) })} /> : null}
          </View></Card>
        ))}
        <Button label="Add education" icon="add" variant="secondary" full disabled={draft.education.length >= LIMITS.education} onPress={() => set({ education: [...draft.education, emptyEducation()] })} />
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Skills" subtitle="Separate with commas" />
        <Card><TextField label="Skills" value={draft.skills} onChangeText={(v) => set({ skills: v })} error={e('skills')} multiline maxLength={800} helper="For example: Java, SQL, React" /></Card>
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Projects" subtitle="One line per bullet" />
        {draft.projects.map((x, i) => (
          <Card key={x.id}><View style={{ gap: sp.lg }}>
            <TextField label="Project title" value={x.title} onChangeText={(v) => upProj(i, { title: v })} error={e(`proj.${i}.title`)} maxLength={100} />
            <TextField label="Link (https), optional" value={x.link} onChangeText={(v) => upProj(i, { link: v })} error={e(`proj.${i}.link`)} keyboardType="url" autoCapitalize="none" maxLength={300} />
            <TextField label="What you did (one bullet per line)" value={x.description} onChangeText={(v) => upProj(i, { description: v })} error={e(`proj.${i}.description`)} multiline maxLength={900} />
            <RemoveRow label="Remove project" onPress={() => set({ projects: draft.projects.filter((_, j) => j !== i) })} />
          </View></Card>
        ))}
        <Button label="Add project" icon="add" variant="secondary" full disabled={draft.projects.length >= LIMITS.projects} onPress={() => set({ projects: [...draft.projects, emptyProject()] })} />
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Experience" subtitle="Internships, work, volunteering" />
        {draft.experience.map((x, i) => (
          <Card key={x.id}><View style={{ gap: sp.lg }}>
            <TextField label="Role" value={x.role} onChangeText={(v) => upExp(i, { role: v })} error={e(`exp.${i}.role`)} maxLength={100} />
            <TextField label="Organisation" value={x.organisation} onChangeText={(v) => upExp(i, { organisation: v })} error={e(`exp.${i}.organisation`)} maxLength={100} />
            <TextField label="From" value={x.from} onChangeText={(v) => upExp(i, { from: v })} maxLength={20} helper="For example: Jun 2025" />
            <TextField label="To" value={x.to} onChangeText={(v) => upExp(i, { to: v })} maxLength={20} helper="For example: Aug 2025 or Present" />
            <TextField label="What you did (one bullet per line)" value={x.description} onChangeText={(v) => upExp(i, { description: v })} error={e(`exp.${i}.description`)} multiline maxLength={900} />
            <RemoveRow label="Remove experience" onPress={() => set({ experience: draft.experience.filter((_, j) => j !== i) })} />
          </View></Card>
        ))}
        <Button label="Add experience" icon="add" variant="secondary" full disabled={draft.experience.length >= LIMITS.experience} onPress={() => set({ experience: [...draft.experience, emptyExperience()] })} />
      </View>

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Achievements" subtitle="Certifications, awards, positions. One per line" />
        <Card><TextField label="Achievements" value={draft.achievements} onChangeText={(v) => set({ achievements: v })} error={e('achievements')} multiline maxLength={1200} /></Card>
      </View>

    </Page>
  );
}
