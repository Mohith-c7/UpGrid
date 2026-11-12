import React, { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Button, Checkbox, Select, Text, TextField, useToast } from '@/ui';
import { colors } from "@/theme";
import { ApiError, errMessage, fieldErrors } from '@/api/client';
import { useCrmCompany, useCrmMutations } from '@/api/ops';
import type { CompanyContact, CompanyInput, CompanyStage } from '@/api/opsTypes';
import { STAGES } from '@/features/ops/crm';
import { Async, Group, OpsPage, useBack, useGo, useOnce } from '@/features/ops/kit';

/** Add a company, or edit one when opened with ?id=. Handles the 409 duplicate warning with "Add anyway". */
export default function CompanyForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const toast = useToast();
  const go = useGo();
  const back = useBack('/(officer)/ops/companies');
  const q = useCrmCompany(id);
  const m = useCrmMutations();
  const [name, setName] = useState(''); const [website, setWebsite] = useState(''); const [industry, setIndustry] = useState(''); const [hq, setHq] = useState('');
  const [notes, setNotes] = useState(''); const [tags, setTags] = useState(''); const [verified, setVerified] = useState(false); const [stage, setStage] = useState<CompanyStage>('prospect');
  const [cName, setCName] = useState(''); const [cRole, setCRole] = useState(''); const [cEmail, setCEmail] = useState(''); const [cPhone, setCPhone] = useState('');
  const [extraContacts, setExtraContacts] = useState<CompanyContact[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    const c = q.data;
    if (editing && c && !loaded) {
      setName(c.name); setWebsite(c.website ?? ''); setIndustry(c.industry ?? ''); setHq(c.hq ?? ''); setNotes(c.notes ?? ''); setTags((c.tags ?? []).join(', '));
      setVerified(c.verified); setStage(c.stage);
      const [first, ...rest] = c.contacts ?? [];
      if (first) { setCName(first.name); setCRole(first.role ?? ''); setCEmail(first.email ?? ''); setCPhone(first.phone ?? ''); }
      setExtraContacts(rest); setLoaded(true);
    }
  }, [q.data, editing, loaded]);

  const run = async (force: boolean) => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter the company name';
    if (website.trim() && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website.trim())) e.website = 'Start with https://';
    if (cEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail.trim())) e.contactEmail = 'Enter a valid email';
    if (cPhone.trim() && !/^[6-9]\d{9}$/.test(cPhone.replace(/\D/g, '').slice(-10))) e.contactPhone = 'Enter a valid 10-digit mobile number starting with 6 to 9';
    setErrs(e); setBanner(null); setDup(null);
    if (Object.keys(e).length) return;
    const contacts: CompanyContact[] = [
      ...(cName.trim() ? [{ name: cName.trim(), role: cRole.trim() || undefined, email: cEmail.trim() || undefined, phone: cPhone.trim() ? cPhone.replace(/\D/g, '').slice(-10) : undefined }] : []), ...extraContacts,
    ];
    const body: CompanyInput = {
      name: name.trim(), website: website.trim() || undefined, industry: industry.trim() || undefined, hq: hq.trim() || undefined, notes: notes.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean), verified, contacts, stage,
    };
    try {
      if (editing) { await m.update(id!, body); toast.show('Company saved', 'success'); back(); }
      else {
        const r = await m.create(force ? { ...body, force: true } : body);
        toast.show('Company added', 'success');
        const newId = (r as { company?: { id: string } }).company?.id;
        if (newId) go(`/(officer)/ops/companies/${newId}`); else back();
      }
    } catch (x) {
      if (x instanceof ApiError && x.code === 'DUPLICATE_COMPANY') { setDup(x.fields?.existingId ?? ''); setBanner(x.message); }
      else { setErrs(fieldErrors(x)); setBanner(errMessage(x)); }
    }
  };
  const [submit, busy] = useOnce(() => run(false));
  const [force, forcing] = useOnce(() => run(true));

  return (
    <OpsPage title={editing ? 'Edit company' : 'Add company'} back="/(officer)/ops/companies" keyboard footer={<Button label={editing ? 'Save company' : 'Add company'} full loading={busy} onPress={() => submit()} />}>
      <Async isLoading={editing && q.isLoading} isError={editing && q.isError} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {dup !== null ? (
          <Banner tone="warning" title="This looks like a duplicate" message={banner ?? 'A company with the same name or website already exists.'} />
        ) : banner ? <Banner tone="error" message={banner} /> : null}
        {dup !== null ? (
          <>
            {dup ? <Button label="Open the existing company" variant="secondary" full onPress={() => go(`/(officer)/ops/companies/${dup}`)} /> : null}
            <Button label="Add anyway" variant="secondary" full loading={forcing} onPress={() => force()} />
          </>
        ) : null}
        <Group title="Company">
          <TextField label="Name" value={name} onChangeText={setName} maxLength={120} error={errs.name} />
          <TextField label="Website" value={website} onChangeText={setWebsite} keyboardType="url" autoCapitalize="none" maxLength={300} error={errs.website} placeholder="https://" />
          <TextField label="Industry" value={industry} onChangeText={setIndustry} maxLength={80} />
          <TextField label="Headquarters" value={hq} onChangeText={setHq} maxLength={80} />
          <Select label="Outreach stage" value={stage} onChange={(v) => setStage(v as CompanyStage)} options={STAGES} />
          <Checkbox checked={verified} onChange={setVerified}><Text variant="body">Verified company</Text></Checkbox>
        </Group>
        <Group title="Main contact">
          <TextField label="Name" value={cName} onChangeText={setCName} maxLength={80} />
          <TextField label="Role" value={cRole} onChangeText={setCRole} maxLength={80} />
          <TextField label="Email" value={cEmail} onChangeText={setCEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} error={errs.contactEmail} />
          <TextField label="Mobile" value={cPhone} onChangeText={setCPhone} keyboardType="phone-pad" maxLength={14} error={errs.contactPhone} prefix="+91" />
          {extraContacts.length ? <Text variant="caption" color={colors.muted}>{extraContacts.length} more {extraContacts.length === 1 ? 'contact is' : 'contacts are'} kept as they are.</Text> : null}
        </Group>
        <Group title="Notes">
          <TextField label="Tags" value={tags} onChangeText={setTags} helper="Separate with commas" maxLength={200} />
          <TextField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
        </Group>
      </Async>
    </OpsPage>
  );
}
