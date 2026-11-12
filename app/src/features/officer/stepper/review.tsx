import React from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, Card, CompanyLogo, Icon, KeyValueList, Sheet, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { spacing } from '../layout';
import { InlineNote, Row } from '../components/common';
import { ctcSummary, formatIST } from '../format';
import type { DriveDraft, EligibleCount } from '../types';
import { STEP_TITLES } from '../validation';

const WORK_MODE: Record<string, string> = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };

export function EligiblePanel({ loading, error, data, onRetry, saved }: { loading: boolean; error?: boolean; data?: EligibleCount; onRetry: () => void; saved: boolean }) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="groups" size={22} color={colors.primary} />
        <Text variant="subhead" style={{ flex: 1 }}>Who can apply</Text>
      </View>
      {!saved ? <Text variant="body" color={colors.muted}>Save the draft to see how many students are eligible.</Text>
        : loading ? <Skeleton height={72} radius={10} />
        : error ? <Banner tone="warning" message="Could not calculate the eligible count." action={{ label: 'Retry', onPress: onRetry }} />
        : data ? (
          <View style={{ gap: spacing[1] }}>
            <Text variant="display" tabular accessibilityLabel={`${data.eligible} eligible students`}>{data.eligible}</Text>
            <Text variant="caption" color={colors.muted} tabular>eligible students · {data.pending ?? 0} pending (missing data) · {data.notEligible ?? 0} not eligible</Text>
            {data.reasons?.map((r) => <Text key={r.criterion} variant="caption" tabular>{r.label ?? r.criterion}: {r.count} students blocked</Text>)}
            {data.eligible === 0 ? <InlineNote tone="warning">No student is eligible with these rules. Consider relaxing them.</InlineNote> : null}
          </View>
        ) : null}
      {saved && !loading ? <View style={{ flexDirection: 'row' }}><Button label="Refresh count" icon="refresh" size="sm" variant="ghost" onPress={onRetry} /></View> : null}
    </Card>
  );
}

function rulesText(r: DriveDraft['rules']): string {
  return [r.minCgpa != null && `CGPA ≥ ${r.minCgpa}`, r.min10th != null && `10th ≥ ${r.min10th}%`, r.min12th != null && `12th ≥ ${r.min12th}%`,
    r.maxActiveBacklogs != null && `Active backlogs ≤ ${r.maxActiveBacklogs}`, r.maxGapYears != null && `Gap years ≤ ${r.maxGapYears}`,
    (r.allowedBatches?.length ?? 0) > 0 && `Batch ${r.allowedBatches!.join(', ')}`, (r.allowedDepartments?.length ?? 0) > 0 && r.allowedDepartments!.join(', ')]
    .filter(Boolean).join(' · ') || 'Open to all students';
}

export function ReviewStep({ d, goTo, errorsByStep, eligible }: {
  d: DriveDraft; goTo: (s: number) => void; errorsByStep: { step: number; errors: Record<string, string> }[]; eligible: React.ReactNode;
}) {
  const section = (title: string, step: number, items: { label: string; value: string | number | null | undefined }[]) => (
    <Card key={title} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="subhead" style={{ flex: 1 }}>{title}</Text>
        <Button label="Edit" icon="edit" size="sm" variant="ghost" accessibilityLabel={`Edit ${title}`} onPress={() => goTo(step)} />
      </View>
      <KeyValueList items={items} />
    </Card>
  );
  return (
    <View style={{ gap: spacing[4] }}>
      {errorsByStep.length > 0 && (
        <Banner tone="error" title="Fix before publishing" message={`${errorsByStep.reduce((n, s) => n + Object.keys(s.errors).length, 0)} problem(s) in ${errorsByStep.map((s) => STEP_TITLES[s.step]).join(', ')}. Tap a section below to fix it.`} />
      )}
      {errorsByStep.map((s) => (
        <Card key={s.step} style={{ gap: 6, borderColor: colors.errorBorder }}>
          <Text variant="subhead">{STEP_TITLES[s.step]}</Text>
          {Object.values(s.errors).map((m, i) => <InlineNote key={i} tone="error">{m}</InlineNote>)}
          <View style={{ flexDirection: 'row' }}><Button label={`Go to ${STEP_TITLES[s.step]}`} size="sm" variant="secondary" onPress={() => goTo(s.step)} /></View>
        </Card>
      ))}
      {eligible}
      {section('Company and role', 0, [
        { label: 'Company', value: d.companyName }, { label: 'Role', value: d.role },
        { label: 'Work mode', value: WORK_MODE[d.workMode] ?? d.workMode }, { label: 'Locations', value: d.locations.join(', ') },
      ])}
      {section('Compensation', 3, [{ label: 'Package', value: ctcSummary(d.ctc) }])}
      {section('Eligibility', 4, [{ label: 'Rules', value: rulesText(d.rules) }])}
      {section('Process', 5, [
        { label: 'Extra questions', value: d.questions.length }, { label: 'Selection rounds', value: d.rounds.map((x) => x.name).filter(Boolean).join(' → ') || d.rounds.length },
      ])}
      {section('Timeline', 7, [{ label: 'Application deadline', value: formatIST(d.deadline) }, { label: 'Contact', value: [d.contactName, d.contactEmail].filter(Boolean).join(' · ') }])}
    </View>
  );
}

/** Student-facing preview: mirrors what the student drive screen shows. */
export function PreviewSheet({ d, visible, onClose }: { d: DriveDraft; visible: boolean; onClose: () => void }) {
  const r = d.rules;
  return (
    <Sheet visible={visible} onClose={onClose} title="Student preview">
      <View style={{ gap: spacing[3] }}>
        <Row gap={spacing[3]}>
          <CompanyLogo name={d.companyName || '?'} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" numberOfLines={2}>{d.companyName}</Text>
            <Text variant="body" numberOfLines={2}>{d.role}</Text>
          </View>
        </Row>
        <Row wrap><Badge label={WORK_MODE[d.workMode] ?? d.workMode} tone="info" />{d.locations.map((l) => <Badge key={l} label={l} tone="neutral" />)}</Row>
        <Text variant="section" tabular>{ctcSummary(d.ctc)}</Text>
        <Text variant="meta" tabular color={colors.muted}>Apply by {formatIST(d.deadline)}</Text>
        <Text variant="section">About the role</Text>
        <Text variant="body">{d.jd || 'No description'}</Text>
        {d.requirements ? <><Text variant="section">Requirements</Text><Text variant="body">{d.requirements}</Text></> : null}
        <Text variant="section">Eligibility</Text>
        <Text variant="body" tabular>{rulesText(r)}</Text>
        <Text variant="section">Selection process</Text>
        {d.rounds.map((x, i) => <Text key={i} variant="body">{i + 1}. {x.name}{x.notes ? ` — ${x.notes}` : ''}</Text>)}
        {d.questions.length > 0 && <>
          <Text variant="section">Questions you will answer</Text>
          {d.questions.map((q) => <Text key={q.id} variant="body">• {q.label}{q.required ? ' *' : ''}</Text>)}
        </>}
        {d.policyNote ? <Text variant="meta" color={colors.muted}>{d.policyNote}</Text> : null}
      </View>
    </Sheet>
  );
}
