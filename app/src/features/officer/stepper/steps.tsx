import React from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, EmailField, Select, SegmentedControl, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { spacing } from '../layout';
import { InlineNote, Row } from '../components/common';
import type { DriveDraft, DriveQuestion, QuestionType } from '../types';
import type { Errors } from '../validation';
import { ISTDateTimeField, NumField, TagsInput, Toggle } from './fields';
import { LogoUploader } from '@/features/uploads';

export interface StepProps { d: DriveDraft; set: (p: Partial<DriveDraft>) => void; e: Errors; serverOffsetMs: number }
const gap = { gap: spacing[4] } as const;

export function CompanyStep({ d, set, e }: StepProps) {
  return (
    <View style={gap}>
      <TextField label="Company name" helper="Required"  value={d.companyName} onChangeText={(v) => set({ companyName: v })} error={e.companyName} maxLength={100} />
      <TextField label="Industry" value={d.industry} onChangeText={(v) => set({ industry: v })} maxLength={80} />
      <LogoUploader companyName={d.companyName} currentUrl={d.logoUrl} onChange={(v) => set({ logoFileId: v ? v.fileId : null, logoUrl: v ? v.previewUrl : null })} />
    </View>
  );
}

export function RoleStep({ d, set, e }: StepProps) {
  return (
    <View style={gap}>
      <TextField label="Role title" helper="Required" value={d.role} onChangeText={(v) => set({ role: v })} error={e.role} maxLength={100} />
      <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Work mode</Text>
      <SegmentedControl value={d.workMode} onChange={(v: any) => set({ workMode: v })}
        options={[{ value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' }]} />
      <TagsInput label={d.workMode === 'remote' ? 'Locations (optional)' : 'Locations'} values={d.locations} onChange={(v) => set({ locations: v })} error={e.locations} />
    </View>
  );
}

export function JdStep({ d, set, e }: StepProps) {
  return (
    <View style={gap}>
      <TextField label="Job description" value={d.jd} onChangeText={(v) => set({ jd: v })} multiline maxLength={5000} error={e.jd} helper="At least 50 characters. Shown to students." />
      <TextField label="Requirements / skills" value={d.requirements} onChangeText={(v) => set({ requirements: v })} multiline maxLength={2000} />
    </View>
  );
}

export function CompStep({ d, set, e }: StepProps) {
  const c = d.ctc;
  const upd = (p: Partial<typeof c>) => set({ ctc: { ...c, ...p } });
  const total = (c.fixedLpa ?? 0) + (c.variableLpa ?? 0);
  return (
    <View style={gap}>
      <Text variant="meta" color={colors.muted}>The fixed amount is required to publish. Variable, bonus and ESOP are optional.</Text>
      <SegmentedControl value={c.kind ?? 'annual'} onChange={(v: any) => upd({ kind: v })}
        options={[{ value: 'annual', label: 'Annual (LPA)' }, { value: 'stipend_monthly', label: 'Stipend / month' }]} />
      <NumField label={c.kind === 'stipend_monthly' ? 'Monthly stipend (₹)' : 'Fixed (LPA)'} helper={e.fixedLpa ? undefined : 'Required'} prefix="₹" value={c.fixedLpa} onValue={(v) => upd({ fixedLpa: v })} error={e.fixedLpa} decimals={2} intDigits={c.kind === 'stipend_monthly' ? 7 : 4} />
      {c.kind !== 'stipend_monthly' && (
        <>
          <NumField label="Variable (LPA), optional" prefix="₹" value={c.variableLpa} onValue={(v) => upd({ variableLpa: v })} error={e.variableLpa} />
          <NumField label="Joining / other bonus (LPA), optional" prefix="₹" value={c.bonusLpa} onValue={(v) => upd({ bonusLpa: v })} error={e.bonusLpa} />
          {c.fixedLpa != null && <Text variant="meta" color={colors.muted} tabular>Fixed + variable = ₹{total.toFixed(2)} LPA</Text>}
          <TextField label="ESOP note, optional" value={c.esopNote ?? ''} onChangeText={(v) => upd({ esopNote: v })} maxLength={200} />
          <Toggle label="Company has shared a pay breakdown" value={!!c.breakdownProvided} onChange={(v) => upd({ breakdownProvided: v })} />
          {!c.breakdownProvided ? <Text variant="meta" color={colors.muted}>Students will see “Breakdown not provided” next to the pay.</Text> : null}
        </>
      )}
    </View>
  );
}

export function EligibilityStep({ d, set, e }: StepProps) {
  const r = d.rules;
  const upd = (p: Partial<typeof r>) => set({ rules: { ...r, ...p } });
  const y = new Date().getFullYear();
  const years = [y, y + 1, y + 2, y + 3];
  const batches = r.allowedBatches ?? [];
  return (
    <View style={gap}>
      <NumField label="Minimum CGPA (0–10)" value={r.minCgpa} onValue={(v) => upd({ minCgpa: v })} error={e.minCgpa} />
      <NumField label="Minimum 10th % (0–100)" value={r.min10th} onValue={(v) => upd({ min10th: v })} error={e.min10th} />
      <NumField label="Minimum 12th % (0–100)" value={r.min12th} onValue={(v) => upd({ min12th: v })} error={e.min12th} />
      <NumField label="Max active backlogs (0–50)" integer value={r.maxActiveBacklogs} onValue={(v) => upd({ maxActiveBacklogs: v })} error={e.maxActiveBacklogs} />
      <NumField label="Max gap years (0–10)" integer value={r.maxGapYears} onValue={(v) => upd({ maxGapYears: v })} error={e.maxGapYears} />
      <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Batch years (select at least one)</Text>
      <Row wrap>{years.map((yr) => (
        <Chip key={yr} label={String(yr)} selected={batches.includes(yr)}
          onPress={() => upd({ allowedBatches: batches.includes(yr) ? batches.filter((b) => b !== yr) : [...batches, yr].sort() })} />
      ))}</Row>
      {e.allowedBatches ? <InlineNote tone="error">{e.allowedBatches}</InlineNote> : null}
      <TagsInput label="Allowed departments (leave empty for all)" values={r.allowedDepartments ?? []} onChange={(v) => upd({ allowedDepartments: v })} />
    </View>
  );
}

const QTYPES: { t: QuestionType; l: string }[] = [
  { t: 'short_text', l: 'Short text' }, { t: 'long_text', l: 'Long text' }, { t: 'number', l: 'Number' }, { t: 'date', l: 'Date' },
  { t: 'single_select', l: 'Single choice' }, { t: 'multi_select', l: 'Multi choice' }, { t: 'yes_no', l: 'Yes / No' },
  { t: 'url', l: 'Link (https)' }, { t: 'declaration', l: 'Declaration' },
];

export function QuestionsStep({ d, set, e }: StepProps) {
  const upd = (i: number, p: Partial<DriveQuestion>) => set({ questions: d.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const add = () => set({ questions: [...d.questions, { id: `q_${Date.now().toString(36)}${d.questions.length}`, label: '', type: 'short_text' as QuestionType, required: true }].slice(0, 15) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= d.questions.length) return;
    const a = [...d.questions]; [a[i], a[j]] = [a[j], a[i]]; set({ questions: a });
  };
  return (
    <View style={gap}>
      <Text variant="meta" color={colors.muted}>Name, email, CGPA and resume are filled from the student's profile. Add only extra questions.</Text>
      {d.questions.length === 0 && <InlineNote>No extra questions yet. That is fine.</InlineNote>}
      {d.questions.map((q, i) => (
        <Card key={q.id}>
          <View style={{ gap: spacing[3] }}>
            <Text variant="subhead">Question {i + 1}</Text>
            <Select label="Answer type" value={q.type} options={QTYPES.map((x) => ({ value: x.t, label: x.l }))} onChange={(v) => { const t = v as QuestionType; upd(i, { type: t, required: t === 'declaration' ? true : q.required }); }} />
            <TextField label="Question text" value={q.label} onChangeText={(v) => upd(i, { label: v })} maxLength={200} error={e[`q${i}`]} />
            {(q.type === 'single_select' || q.type === 'multi_select') && (
              <TextField label="Options (one per line)" multiline value={(q.options ?? []).join('\n')} onChangeText={(v) => upd(i, { options: v.split('\n').slice(0, 15) })} />
            )}
            {(q.type === 'short_text' || q.type === 'long_text') && (
              <NumField label="Max length (optional)" integer value={q.maxLength ?? null} onValue={(v) => upd(i, { maxLength: v ?? undefined })} />
            )}
            <TextField label="Help text" value={q.helpText ?? ''} onChangeText={(v) => upd(i, { helpText: v })} maxLength={200} />
            <Row wrap>
              <Toggle label="Required" value={q.required} onChange={(v) => upd(i, { required: q.type === 'declaration' ? true : v })} />
              <Button label="Move up" icon="arrow-upward" size="sm" variant="ghost" disabled={i === 0} onPress={() => move(i, -1)} />
              <Button label="Move down" icon="arrow-downward" size="sm" variant="ghost" disabled={i === d.questions.length - 1} onPress={() => move(i, 1)} />
              <Button label="Remove" icon="delete-outline" size="sm" variant="ghost" onPress={() => set({ questions: d.questions.filter((_, j) => j !== i) })} />
            </Row>
          </View>
        </Card>
      ))}
      <Button label="Add question" variant="secondary" icon="add" full disabled={d.questions.length >= 15} onPress={add} />
    </View>
  );
}

export function RoundsStep({ d, set, e }: StepProps) {
  const upd = (i: number, p: Partial<(typeof d.rounds)[number]>) => set({ rounds: d.rounds.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return (
    <View style={gap}>
      {e.rounds ? <InlineNote tone="error">{e.rounds}</InlineNote> : null}
      {d.rounds.map((r, i) => (
        <Card key={i}>
          <View style={{ gap: spacing[3] }}>
            <Text variant="subhead">Round {i + 1}</Text>
            <TextField label="Round name" value={r.name} onChangeText={(v) => upd(i, { name: v })} maxLength={80} error={e[`r${i}`]} />
            <TextField label="Mode / notes" value={r.notes ?? ''} onChangeText={(v) => upd(i, { notes: v })} maxLength={200} />
            <Button label="Remove round" icon="delete-outline" size="sm" variant="ghost" onPress={() => set({ rounds: d.rounds.filter((_, j) => j !== i) })} />
          </View>
        </Card>
      ))}
      <Button label="Add round" variant="secondary" icon="add" full disabled={d.rounds.length >= 10} onPress={() => set({ rounds: [...d.rounds, { name: '' }] })} />
    </View>
  );
}

export function TimelineStep({ d, set, e, serverOffsetMs }: StepProps) {
  return (
    <View style={gap}>
      <ISTDateTimeField label="Application deadline" value={d.deadline} onChange={(v) => set({ deadline: v })} error={e.deadline} serverOffsetMs={serverOffsetMs} />
      <TextField label="Contact name" value={d.contactName} onChangeText={(v) => set({ contactName: v })} maxLength={80} />
      <EmailField label="Contact email (optional)" value={d.contactEmail} onChangeText={(v) => set({ contactEmail: v })} error={e.contactEmail} validate={d.contactEmail.trim().length > 0} />
      <TextField label="Policy note (shown to students)" value={d.policyNote} onChangeText={(v) => set({ policyNote: v })} multiline maxLength={500} />
    </View>
  );
}
