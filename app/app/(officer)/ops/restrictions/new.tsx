import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Select, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useRestrictionMutations } from '@/api/ops';
import type { RestrictionScope } from '@/api/opsTypes';
import { confirm } from '@/features/pipeline/kit';
import { DateTimeFields, Group, isDate, istToIso, OpsPage, useBack, useOnce } from '@/features/ops/kit';
import { StudentPicker, type PickedStudent } from '@/features/ops/StudentPicker';
import { SCOPE_LABEL } from '@/features/ops/restrictionParts';

const SCOPE_HELP: Record<RestrictionScope, string> = {
  student: 'One student, all drives.', company: 'Everyone, for one company (or one student for that company).', drive: 'Everyone, for one drive id.',
  department: 'A whole department.', batch: 'A graduating year.', tenant: 'Every student, every drive.',
};

export default function NewRestriction() {
  const toast = useToast();
  const back = useBack('/(officer)/ops/restrictions');
  const m = useRestrictionMutations();
  const [scope, setScope] = useState<RestrictionScope>('student');
  const [scopeValue, setScopeValue] = useState('');
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [evidence, setEvidence] = useState('');
  const [sd, setSd] = useState(''); const [st, setSt] = useState('');
  const [ed, setEd] = useState(''); const [et, setEt] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const needsValue = ['company', 'drive', 'department', 'batch'].includes(scope);
  const canNarrow = scope === 'company' || scope === 'drive';

  const [submit, busy] = useOnce(async () => {
    const e: Record<string, string> = {};
    if (scope === 'student' && !student) e.studentId = 'Choose a student';
    if (needsValue && !scopeValue.trim()) e.scopeValue = scope === 'batch' ? 'Enter a year' : 'Required';
    if (scope === 'batch' && scopeValue.trim() && !/^\d{4}$/.test(scopeValue.trim())) e.scopeValue = 'Enter a 4-digit year';
    if (reason.trim().length < 3) e.reason = 'At least 3 characters';
    if (message.trim().length < 5) e.studentMessage = 'At least 5 characters';
    if (sd && !isDate(sd)) e.startsAt = 'Use YYYY-MM-DD';
    if (ed && !isDate(ed)) e.endsAt = 'Use YYYY-MM-DD';
    const startsAt = sd ? istToIso(sd, st || '00:00') : null;
    const endsAt = ed ? istToIso(ed, et || '23:59') : null;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) e.endsAt = 'End must be after start';
    setErrs(e); setBanner(null);
    if (Object.keys(e).length) return;
    try {
      const r = await m.create({
        scope, studentId: student?.id, scopeValue: scope === 'student' ? student!.id : needsValue ? scopeValue.trim() : undefined,
        reason: reason.trim(), studentMessage: message.trim(), evidenceNotes: evidence.trim() || undefined,
        startsAt: startsAt ?? undefined, endsAt: endsAt ?? undefined,
      });
      toast.show(r.restriction.status === 'active' ? 'Restriction is active' : 'Sent for approval by another officer', 'success');
      back();
    } catch (x) { setErrs(fieldErrors(x)); setBanner(errMessage(x)); }
  });

  return (
    <OpsPage title="New restriction" keyboard footer={<Button label="Create restriction" full loading={busy} onPress={() => (['tenant', 'department', 'batch'].includes(scope)
      ? confirm('Create a wide restriction?', scope === 'tenant' ? 'This blocks every student from applying once it takes effect.' : `This blocks a whole ${scope === 'batch' ? 'batch' : 'department'} from applying once it takes effect.`, 'Create', () => void submit())
      : void submit())} />}>
      <Group title="Who is affected">
        <Select label="Applies to" value={scope} onChange={(v) => { setScope(v as RestrictionScope); setErrs({}); }} options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <Text variant="caption" color={colors.muted}>{SCOPE_HELP[scope]}</Text>
        {needsValue ? (
          <TextField label={scope === 'company' ? 'Company name' : scope === 'drive' ? 'Drive id' : scope === 'department' ? 'Department' : 'Batch year'} value={scopeValue} onChangeText={setScopeValue}
            keyboardType={scope === 'batch' ? 'number-pad' : 'default'} maxLength={scope === 'batch' ? 4 : 120} error={errs.scopeValue} />
        ) : null}
        {scope === 'student' || canNarrow ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" color={colors.muted}>{canNarrow ? 'Limit to one student (optional)' : 'Student'}</Text>
            <Text variant="body">{student ? `${student.name}${student.sub ? ` · ${student.sub}` : ''}` : 'No student chosen'}</Text>
            {errs.studentId ? <Text variant="caption" color={colors.error}>{errs.studentId}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              <Button label={student ? 'Change student' : 'Choose student'} variant="secondary" icon="person-search" onPress={() => setPickOpen(true)} />
              {student ? <Button label="Clear" variant="ghost" onPress={() => setStudent(null)} /> : null}
            </View>
          </View>
        ) : null}
      </Group>
      <Group title="Why">
        <TextField label="Internal reason" value={reason} onChangeText={setReason} multiline maxLength={500} error={errs.reason} helper="Officers only. Students never see this." />
        <TextField label="Message shown to the student" value={message} onChangeText={setMessage} multiline maxLength={300} error={errs.studentMessage} helper="Be respectful and specific. They can appeal from their profile." />
        <TextField label="Evidence notes (optional)" value={evidence} onChangeText={setEvidence} multiline maxLength={2000} error={errs.evidenceNotes} helper="Officers only." />
      </Group>
      <Group title="When">
        <DateTimeFields label="Starts (optional)" date={sd} time={st} onDate={setSd} onTime={setSt} error={errs.startsAt} />
        <DateTimeFields label="Ends (optional)" date={ed} time={et} onDate={setEd} onTime={setEt} error={errs.endsAt} />
      </Group>
      <Banner tone="info" message="Depending on your settings, another officer may need to approve this before it takes effect. You cannot approve your own request." />
      {banner ? <Banner tone="error" message={banner} /> : null}
      <StudentPicker visible={pickOpen} onClose={() => setPickOpen(false)} onPick={(s) => { setStudent(s[0]); setPickOpen(false); }} />
    </OpsPage>
  );
}
