import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, Icon, KeyValueList, SectionHeader, SegmentedControl, Select, Text, TextField } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import type { AssessmentSettings, AudiencePreview, AudienceType, Section, SectionQuestion } from '@/api/assessments';
import { getServerOffsetMs } from '@/api/client';
import { dateLabel, describeIST, PickerRow, timeLabel, useISTPicker } from '@/features/officer/components/pickers';
import { nowISTParts, type ISTParts } from '@/features/officer/format';
import { DifficultyBadge, NumberField, Pill, TYPE_LABEL, ToggleRow, fmtNum, parseNum } from '../kit';
import { questionCount, totalMarks, type BuilderForm, type Problem } from './model';
import { AutoPickSheet, BankPickerSheet, MarksSheet, StudentPickerSheet, toSectionQuestion } from './pickers';

export type Patch = (p: Partial<BuilderForm>) => void;
export interface DriveOption { value: string; label: string }

/* ======================= 1. details ======================= */
export function StepDetails({ f, patch, drives, errors }: { f: BuilderForm; patch: Patch; drives: DriveOption[]; errors: Record<string, string> }) {
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <TextField label="Test title" value={f.title} onChangeText={(t) => patch({ title: t })} maxLength={150} error={errors.title} placeholder="For example Infosys online assessment" />
        <TextField label="Instructions for students (markdown)" value={f.instructions} onChangeText={(t) => patch({ instructions: t })} multiline helper="Shown before the test starts." />
        <NumberField label="Duration (minutes)" integer value={f.duration} onChange={(t) => patch({ duration: t })} error={errors.durationMinutes} helper="1 to 600. Each student gets this long from the moment they start." />
      </Card>
      <Card style={{ gap: 10 }}>
        <ToggleRow label="Practice set" hint="Open to all students, unlimited attempts, never ranked. No schedule needed." value={f.practice} onChange={(v) => patch({ practice: v, ...(v ? { audience: { type: 'all_students' as AudienceType } } : {}) })} />
        <Select label="Attach to a drive (optional)" value={f.driveId ?? ''} placeholder="No drive"
          onChange={(v) => patch({ driveId: v || null, audience: f.audience.driveId !== undefined || f.audience.type === 'drive_applicants' || f.audience.type === 'all_eligible' ? { ...f.audience, driveId: v || null } : f.audience })}
          options={[{ value: '', label: 'No drive' }, ...drives]} />
        <Text variant="caption" color={colors.muted}>Linking a drive lets you target its applicants and shortlist them into the next round from the results.</Text>
      </Card>
    </View>
  );
}

/* ======================= 2. sections and questions ======================= */
function move<T>(a: T[], i: number, d: number): T[] {
  const j = i + d; if (j < 0 || j >= a.length) return a;
  const n = [...a]; [n[i], n[j]] = [n[j], n[i]]; return n;
}
const IconBtn = ({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    style={({ pressed }) => ({ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1, backgroundColor: pressed ? colors.pressed : 'transparent', borderRadius: 12 })}>
    <Icon name={icon} size={22} color={colors.muted} />
  </Pressable>
);

export function StepQuestions({ f, patch }: { f: BuilderForm; patch: Patch }) {
  const [bankFor, setBankFor] = useState<number | null>(null);
  const [autoFor, setAutoFor] = useState<number | null>(null);
  const [marksFor, setMarksFor] = useState<{ s: number; q: number } | null>(null);
  const used = new Set(f.sections.flatMap((s) => s.questions.map((q) => q.questionId)));
  const setSection = (i: number, p: Partial<Section>) => patch({ sections: f.sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setQuestions = (i: number, qs: SectionQuestion[]) => setSection(i, { questions: qs });
  const timed = f.sections.some((s) => s.timeLimitMinutes);
  const target = marksFor ? f.sections[marksFor.s]?.questions[marksFor.q] ?? null : null;
  return (
    <View style={{ gap: 16 }}>
      <Banner tone="info" message={`${questionCount(f)} question${questionCount(f) === 1 ? '' : 's'}, ${fmtNum(totalMarks(f))} marks. Add questions from the bank or auto-pick by topic and difficulty.`} />
      {timed ? <Banner tone="warning" title="Sequential sections" message="A section with a time limit makes the test sequential: students move forward one section at a time and cannot return to earlier sections." /> : null}
      {f.sections.map((s, si) => (
        <Card key={s.id ?? `n${si}`} style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
            <View style={{ flex: 1, minWidth: 0 }}><TextField label={`Section ${si + 1} title`} value={s.title} onChangeText={(t) => setSection(si, { title: t })} maxLength={80} /></View>
            <IconBtn icon="arrow-upward" label={`Move section ${si + 1} up`} disabled={si === 0} onPress={() => patch({ sections: move(f.sections, si, -1) })} />
            <IconBtn icon="arrow-downward" label={`Move section ${si + 1} down`} disabled={si === f.sections.length - 1} onPress={() => patch({ sections: move(f.sections, si, 1) })} />
          </View>
          <NumberField label="Section time limit in minutes (optional)" integer value={s.timeLimitMinutes ? String(s.timeLimitMinutes) : ''} onChange={(t) => setSection(si, { timeLimitMinutes: t ? Number(t) : null })} placeholder="No limit" />
          <CutoffField value={s.cutoffMarks ?? null} onValue={(n) => setSection(si, { cutoffMarks: n })} />

          {s.questions.length === 0 ? <Text variant="caption" color={colors.muted}>No questions in this section yet.</Text> : null}
          {s.questions.map((q, qi) => (
            <View key={`${q.questionId}-${qi}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 6 }}>
              <Text variant="body" numberOfLines={3} style={{ fontWeight: '500' }}>{qi + 1}. {q.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Badge label={TYPE_LABEL[q.type]} tone="info" /><DifficultyBadge d={q.difficulty} />
              </View>
              <Pill icon="stars" text={`${fmtNum(q.marks)} marks${q.negativeMarks ? `, -${fmtNum(q.negativeMarks)} if wrong` : ''}`} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <IconBtn icon="edit" label={`Edit marks for question ${qi + 1}`} onPress={() => setMarksFor({ s: si, q: qi })} />
                <IconBtn icon="arrow-upward" label={`Move question ${qi + 1} up`} disabled={qi === 0} onPress={() => setQuestions(si, move(s.questions, qi, -1))} />
                <IconBtn icon="arrow-downward" label={`Move question ${qi + 1} down`} disabled={qi === s.questions.length - 1} onPress={() => setQuestions(si, move(s.questions, qi, 1))} />
                <IconBtn icon="delete-outline" label={`Remove question ${qi + 1}`} onPress={() => setQuestions(si, s.questions.filter((_, k) => k !== qi))} />
              </View>
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label="Add from bank" icon="library-add" variant="secondary" size="sm" onPress={() => setBankFor(si)} />
            <Button label="Auto-pick" icon="shuffle" variant="secondary" size="sm" onPress={() => setAutoFor(si)} />
            {f.sections.length > 1 ? <Button label="Remove section" icon="delete-outline" variant="ghost" size="sm" onPress={() => patch({ sections: f.sections.filter((_, j) => j !== si) })} /> : null}
          </View>
        </Card>
      ))}
      <Button label="Add section" icon="add" variant="secondary" full onPress={() => patch({ sections: [...f.sections, { title: `Section ${f.sections.length + 1}`, timeLimitMinutes: null, cutoffMarks: null, questions: [] }] })} />

      <BankPickerSheet visible={bankFor !== null} onClose={() => setBankFor(null)} excluded={used}
        onAdd={(qs) => bankFor !== null && setQuestions(bankFor, [...f.sections[bankFor].questions, ...qs.map(toSectionQuestion)])} />
      <AutoPickSheet visible={autoFor !== null} onClose={() => setAutoFor(null)} excluded={used}
        onAdd={(qs) => autoFor !== null && setQuestions(autoFor, [...f.sections[autoFor].questions, ...qs.map(toSectionQuestion)])} />
      <MarksSheet q={target} onClose={() => setMarksFor(null)}
        onSave={(m, n) => marksFor && setQuestions(marksFor.s, f.sections[marksFor.s].questions.map((q, k) => (k === marksFor.q ? { ...q, marks: m, negativeMarks: n } : q)))} />
    </View>
  );
}

/* ======================= 3. rules ======================= */
export function StepRules({ f, patch, errors }: { f: BuilderForm; patch: Patch; errors: Record<string, string> }) {
  const [bulkMarks, setBulkMarks] = useState(''); const [bulkNeg, setBulkNeg] = useState('');
  const st = f.settings;
  const setS = (p: Partial<AssessmentSettings>) => patch({ settings: { ...st, ...p } });
  const bm = parseNum(bulkMarks); const bn = bulkNeg.trim() === '' ? 0 : parseNum(bulkNeg);
  const bulkErr = bulkMarks.trim() !== '' && (bm === null || bm < 0.25 || bm > 100) ? 'Marks must be 0.25 to 100.' : null;
  const bulkNegErr = bn === null || bn < 0 || (bm !== null && bn > bm) ? 'Negative marks must be 0 up to the marks.' : null;
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 6 }}>
        <Text variant="subhead">Marking</Text>
        <ToggleRow label="Negative marking" hint="Wrong answers lose the negative marks set on each question. Unanswered never loses marks." value={st.negativeMarking} onChange={(v) => setS({ negativeMarking: v })} />
        <View style={{ gap: 6, paddingTop: 6 }}>
          <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Pass cutoff</Text>
          <SegmentedControl value={f.cutoffType} onChange={(v) => patch({ cutoffType: v as any })} options={[{ value: 'none', label: 'None' }, { value: 'marks', label: 'Marks' }, { value: 'percent', label: 'Percent' }]} />
          {f.cutoffType !== 'none' ? <NumberField label={f.cutoffType === 'marks' ? 'Minimum marks to pass' : 'Minimum percent to pass'} value={f.cutoffValue} onChange={(t) => patch({ cutoffValue: t })} error={errors['settings.passCutoff'] ?? null} helper={`Total marks: ${fmtNum(totalMarks(f))}`} /> : null}
        </View>
      </Card>

      <Card style={{ gap: 6 }}>
        <Text variant="subhead">Set marks for every question</Text>
        <Text variant="caption" color={colors.muted}>Overrides the marks of all {questionCount(f)} questions. You can still edit single questions in the previous step.</Text>
        <NumberField label="Marks per question" value={bulkMarks} onChange={setBulkMarks} error={bulkErr} />
        <NumberField label="Negative marks per question" value={bulkNeg} onChange={setBulkNeg} error={bulkMarks.trim() !== '' ? bulkNegErr : null} />
        <Button label="Apply to all questions" variant="secondary" full disabled={bm === null || !!bulkErr || !!bulkNegErr || questionCount(f) === 0}
          onPress={() => patch({ sections: f.sections.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, marks: bm!, negativeMarks: bn ?? 0 })) })) })} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Text variant="subhead">Shuffling and attempts</Text>
        <ToggleRow label="Shuffle question order" hint="Each student sees questions in a different order within a section." value={st.randomiseQuestions} onChange={(v) => setS({ randomiseQuestions: v })} />
        <ToggleRow label="Shuffle options" hint="Multiple-choice options appear in a different order." value={st.randomiseOptions} onChange={(v) => setS({ randomiseOptions: v })} />
        <ToggleRow label="Allow answer review" hint="After results are released, students see their answers, the key and explanations." value={st.allowReview} onChange={(v) => setS({ allowReview: v })} />
        {!f.practice ? (
          <>
            <ToggleRow label="Rank students" value={st.rankingEnabled} onChange={(v) => setS({ rankingEnabled: v })} />
            <NumberField label="Attempts allowed" integer value={f.maxAttempts} onChange={(t) => patch({ maxAttempts: t })} helper="1 to 10. The best attempt counts." />
          </>
        ) : null}
      </Card>

      <Card style={{ gap: 6 }}>
        <Text variant="subhead">Proctoring (light)</Text>
        <Text variant="caption" color={colors.muted}>Switching apps or losing focus is logged and counted as a warning. Screenshots are never blocked.</Text>
        <ToggleRow label="Count focus loss as warnings" value={st.proctoring.enabled} onChange={(v) => setS({ proctoring: { ...st.proctoring, enabled: v } })} />
        {st.proctoring.enabled ? (
          <>
            <NumberField label="Maximum warnings" integer value={f.maxWarnings} onChange={(t) => patch({ maxWarnings: t })} helper="1 to 20" />
            <ToggleRow label="Auto-submit at the limit" hint="The attempt is submitted as soon as warnings reach the maximum." value={st.proctoring.autoSubmit} onChange={(v) => setS({ proctoring: { ...st.proctoring, autoSubmit: v } })} />
          </>
        ) : null}
      </Card>
    </View>
  );
}

/* ======================= 4. audience ======================= */
const AUD_OPTIONS: { value: AudienceType; label: string }[] = [
  { value: 'drive_applicants', label: 'Applicants of a drive' },
  { value: 'all_eligible', label: 'Eligible students of a drive' },
  { value: 'students', label: 'Specific students' },
  { value: 'cohort', label: 'A cohort' },
  { value: 'all_students', label: 'All students' },
];
const APP_STATUSES = ['submitted', 'screening', 'assessment', 'interview', 'selected'];

export function StepAudience({ f, patch, drives, preview, previewBusy, previewError, stale, onPreview }: {
  f: BuilderForm; patch: Patch; drives: DriveOption[]; preview: AudiencePreview | null; previewBusy: boolean; previewError: string | null; stale: boolean; onPreview: () => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const a = f.audience;
  if (f.practice) return <Banner tone="info" title="Practice set" message="Practice sets are open to all students, so there is no audience to choose." />;
  const needsDrive = a.type === 'drive_applicants' || a.type === 'all_eligible';
  const ids = a.studentIds ?? [];
  const setA = (p: Partial<typeof a>) => patch({ audience: { ...a, ...p } });
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <Select label="Who can take this test" value={a.type} options={AUD_OPTIONS}
          onChange={(v) => patch({ audience: { type: v as AudienceType, driveId: v === 'drive_applicants' || v === 'all_eligible' ? (a.driveId ?? f.driveId) : undefined, statuses: v === 'drive_applicants' ? (a.statuses ?? ['submitted', 'screening', 'assessment']) : undefined } })} />
        {needsDrive ? (
          <Select label="Drive" value={a.driveId ?? f.driveId ?? ''} placeholder="Choose a drive" options={drives} onChange={(v) => { setA({ driveId: v }); if (!f.driveId) patch({ driveId: v, audience: { ...a, driveId: v } }); }} />
        ) : null}
        {a.type === 'drive_applicants' ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Application status</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {APP_STATUSES.map((s) => {
                const on = (a.statuses ?? []).includes(s);
                return <Chip key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} selected={on} onPress={() => setA({ statuses: on ? (a.statuses ?? []).filter((x) => x !== s) : [...(a.statuses ?? []), s] })} />;
              })}
            </View>
            <Text variant="caption" color={colors.muted}>Only applicants currently in one of these statuses are included.</Text>
          </View>
        ) : null}
        {a.type === 'all_eligible' ? <Text variant="caption" color={colors.muted}>Everyone whose eligibility for the drive is Eligible.</Text> : null}
        {a.type === 'students' ? (
          <View style={{ gap: 8 }}>
            <Text variant="body">{ids.length} student{ids.length === 1 ? '' : 's'} selected</Text>
            {ids.slice(0, 5).map((id) => <Text key={id} variant="caption" color={colors.muted} numberOfLines={1}>{f.studentNames[id] ?? id}</Text>)}
            {ids.length > 5 ? <Text variant="caption" color={colors.muted}>and {ids.length - 5} more</Text> : null}
            <Button label={ids.length ? 'Change students' : 'Choose students'} icon="person-add" variant="secondary" size="sm" onPress={() => setPickOpen(true)} />
          </View>
        ) : null}
        {a.type === 'cohort' ? <TextField label="Cohort ID" value={a.cohortId ?? ''} onChangeText={(t) => setA({ cohortId: t })} autoCapitalize="none" helper="Publishing fails if cohorts are not set up on the server." /> : null}
      </Card>

      <SectionHeader title="Audience preview" />
      <Card style={{ gap: 10 }}>
        <Text variant="caption" color={colors.muted}>Resolves who would receive this test right now. Saves your draft first.</Text>
        <Button label={preview ? 'Refresh preview' : 'Preview audience'} icon="groups" variant="secondary" full loading={previewBusy} onPress={onPreview} />
        {previewError ? <Banner tone="error" message={previewError} /> : null}
        {preview && !previewError ? (
          <View style={{ gap: 8 }}>
            {stale ? <Banner tone="warning" message="You changed the audience after this preview. Refresh it." /> : null}
            <Text variant="title" tabular>{preview.count} <Text variant="body" color={colors.muted}>student{preview.count === 1 ? '' : 's'}</Text></Text>
            {preview.count === 0 ? <Banner tone="warning" message="Nobody matches yet. A test cannot be published without at least one student." /> : null}
            {preview.unresolved ? <Banner tone="warning" message={preview.unresolved} /> : null}
            {preview.sample?.length ? <Text variant="caption" color={colors.muted}>For example: {preview.sample.map((s) => s.name).join(', ')}</Text> : null}
          </View>
        ) : null}
      </Card>
      <StudentPickerSheet visible={pickOpen} onClose={() => setPickOpen(false)}
        selected={Object.fromEntries(ids.map((id) => [id, f.studentNames[id] ?? id]))}
        onDone={(m) => patch({ audience: { ...a, studentIds: Object.keys(m) }, studentNames: { ...f.studentNames, ...m } })} />
    </View>
  );
}

/* ======================= 5. schedule ======================= */
function WhenField({ label, value, onChange, error }: { label: string; value: ISTParts | null; onChange: (p: ISTParts) => void; error?: string | null }) {
  const seed = (): ISTParts => { const n = nowISTParts(getServerOffsetMs()); const t = new Date(Date.UTC(n.y, n.m - 1, n.d + 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 10, mm: 0 }; };
  const cur = value ?? seed();
  const dt = useISTPicker(cur, onChange);
  return (
    <View style={{ gap: 8 }}>
      <PickerRow label={`${label} (date)`} icon="event" value={value ? dateLabel(value) : 'Not set'} onPress={() => { if (!value) onChange(cur); dt.open('date'); }} error={error} />
      <PickerRow label={`${label} (time)`} icon="schedule" value={value ? `${timeLabel(value)} IST` : 'Not set'} onPress={() => { if (!value) onChange(cur); dt.open('time'); }} />
      {dt.iosPicker}
    </View>
  );
}

export function StepSchedule({ f, patch, errors }: { f: BuilderForm; patch: Patch; errors: Record<string, string> }) {
  const st = f.settings;
  const dur = parseNum(f.duration);
  return (
    <View style={{ gap: 16 }}>
      {f.practice ? <Banner tone="info" message="Practice sets are always open. Only result visibility applies." /> : (
        <Card style={{ gap: 14 }}>
          <WhenField label="Opens" value={f.opens} onChange={(p) => patch({ opens: p })} error={errors.opensAt} />
          <WhenField label="Closes" value={f.closes} onChange={(p) => patch({ closes: p })} error={errors.closesAt} />
          <Text variant="caption" color={colors.muted}>All times are IST. Students can start any time inside the window and get {dur ?? '?'} minutes from their start, ending at the close at the latest. The window should be longer than the duration.</Text>
        </Card>
      )}
      <Card style={{ gap: 10 }}>
        <Text variant="subhead">Result visibility</Text>
        <SegmentedControl value={f.practice ? 'immediate' : st.resultVisibility} onChange={(v) => patch({ settings: { ...st, resultVisibility: v as any } })}
          options={[{ value: 'immediate', label: 'Immediately' }, { value: 'after_close', label: 'After close' }, { value: 'manual', label: 'When I release' }]} />
        <Text variant="caption" color={colors.muted}>
          {st.resultVisibility === 'immediate' ? 'Students see their score as soon as grading finishes.' : st.resultVisibility === 'after_close' ? 'Students see results once the test window has closed.' : 'Results stay hidden until you publish them from the results screen.'}
        </Text>
      </Card>
    </View>
  );
}

/* ======================= 6. review ======================= */
export function StepReview({ f, problems, serverLines, drives, onJump, onPreview }: {
  f: BuilderForm; problems: Problem[]; serverLines: { step: number; text: string }[]; drives: DriveOption[]; onJump: (step: number) => void; onPreview: () => void;
}) {
  const drive = drives.find((d) => d.value === f.driveId)?.label;
  const aud = AUD_OPTIONS.find((o) => o.value === f.audience.type)?.label;
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 10 }}>
        <Text variant="subhead" numberOfLines={3}>{f.title || 'Untitled test'}</Text>
        <KeyValueList items={[
          { label: 'Questions', value: String(questionCount(f)) },
          { label: 'Total marks', value: fmtNum(totalMarks(f)) },
          { label: 'Duration', value: `${f.duration || '?'} min` },
          { label: 'Sections', value: String(f.sections.length) },
          { label: 'Drive', value: drive ?? 'None' },
          { label: 'Audience', value: f.practice ? 'All students (practice)' : aud ?? '-' },
          { label: 'Opens', value: f.practice ? 'Always open' : f.opens ? describeIST(f.opens) : 'Not set' },
          { label: 'Closes', value: f.practice ? 'Never' : f.closes ? describeIST(f.closes) : 'Not set' },
          { label: 'Results', value: f.settings.resultVisibility === 'immediate' ? 'Immediately' : f.settings.resultVisibility === 'after_close' ? 'After close' : 'Manual release' },
          { label: 'Negative marking', value: f.settings.negativeMarking ? 'On' : 'Off' },
          { label: 'Proctoring', value: f.settings.proctoring.enabled ? `On, ${f.maxWarnings} warnings${f.settings.proctoring.autoSubmit ? ', auto-submit' : ''}` : 'Off' },
        ]} />
        <Button label="Preview as a student" icon="visibility" variant="secondary" full onPress={onPreview} />
      </Card>

      {serverLines.length ? (
        <Banner tone="error" title="The server found problems" message={serverLines.map((l) => `- ${l.text}`).join('\n')} action={{ label: 'Go to first problem', onPress: () => onJump(Math.min(...serverLines.map((l) => l.step))) }} />
      ) : null}
      {problems.length ? (
        <Card style={{ gap: 4 }}>
          <Text variant="subhead">To fix before publishing</Text>
          {problems.map((p, i) => (
            <Pressable key={i} onPress={() => onJump(p.step)} accessibilityRole="button" accessibilityLabel={`${p.text} Go to step ${p.step + 1}`} style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="error-outline" size={20} color={colors.warning} />
              <Text variant="caption" style={{ flex: 1 }}>{p.text}</Text>
              <Icon name="chevron-right" size={22} color={colors.subtle} />
            </Pressable>
          ))}
        </Card>
      ) : serverLines.length === 0 ? <Banner tone="success" message="Everything looks complete. Publishing notifies the audience and cannot be undone, though you can archive the test." /> : null}
    </View>
  );
}

/** Keeps what the officer typed ("2." or "2.5") locally; writing the parsed number back on every key would eat the decimal point. */
function CutoffField({ value, onValue }: { value: number | null; onValue: (n: number | null) => void }) {
  const [text, setText] = React.useState(value != null ? String(value) : '');
  return (
    <NumberField label="Section cutoff marks (optional)" value={text} placeholder="No cutoff"
      onChange={(t) => { setText(t); onValue(parseNum(t)); }} />
  );
}
