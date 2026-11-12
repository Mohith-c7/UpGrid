import { useCopy } from '@/lib/copy';
import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { Banner, Button, Checkbox, CodeBlock, EmailField, Sheet, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRecruiterActions } from '@/api/pipeline';
import { RECRUITER_PERMISSIONS, type InviteResult, type PermissionMap, type RecruiterPermission } from '@/api/pipelineTypes';
import { validateEmail } from '@/lib/validation';
import { sp, useOnce } from '../kit';

export const PERMISSION_LABEL: Record<RecruiterPermission, string> = {
  viewCandidates: 'View candidates', shortlist: 'Shortlist or reject', notes: 'Add notes', scorecards: 'Submit scorecards', proposeSlots: 'Propose interview slots',
  proposeOutcomes: 'Propose select or reject', proposeOffers: 'Propose offers', uploadResults: 'Upload round results', markAttendance: 'Mark attendance', message: 'Message the drive team',
};
export const allPermissions = (v: boolean): PermissionMap => Object.fromEntries(RECRUITER_PERMISSIONS.map((k) => [k, v])) as PermissionMap;

/** Permission checklist: 48dp rows, text labels (never colour only). */
export function PermissionList({ value, onChange }: { value: PermissionMap; onChange: (v: PermissionMap) => void }) {
  return (
    <View>
      {RECRUITER_PERMISSIONS.map((k) => (
        <Checkbox key={k} checked={!!value[k]} onChange={(c) => onChange({ ...value, [k]: c })}>
          <Text variant="body">{PERMISSION_LABEL[k]}</Text>
        </Checkbox>
      ))}
    </View>
  );
}

/** Share the one-time invite token. The token is shown once by the server. */
export function TokenPanel({ token, emailSent, email }: { token: string; emailSent?: boolean; email: string }) {
  const toast = useToast();
  const copy = useCopy();
  return (
    <View style={{ gap: sp.md }}>
      <Banner tone={emailSent ? 'success' : 'warning'}
        message={emailSent ? `An invite email was sent to ${email}. You can also share the code below.` : `No email was sent, so share the code below with ${email} yourself.`} />
      <CodeBlock label="Invite code (shown once)" code={token} />
      <Text variant="caption" color={colors.muted}>They enter this code when registering as a recruiter. It expires in 7 days. If you lose it, use Resend to issue a new one.</Text>
      <Button label="Copy invite code" icon="content-copy" variant="secondary" full onPress={() => copy(token, 'Invite code')} />
      <Button label="Share invite code" icon="share" variant="secondary" full
        onPress={async () => { try { await Share.share({ message: `Placement OS recruiter invite for ${email}\nInvite code: ${token}` }); } catch { toast.show('Could not open the share sheet', 'error'); } }} />
    </View>
  );
}

export function InviteSheet({ driveId, visible, onClose }: { driveId: string; visible: boolean; onClose: () => void }) {
  const { invite } = useRecruiterActions(driveId);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<PermissionMap>(allPermissions(true));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  useEffect(() => { if (visible) { setEmail(''); setName(''); setPerms(allPermissions(true)); setErrors({}); setFormError(null); setResult(null); } }, [visible]);

  const [send, busy] = useOnce(async () => {
    const em = validateEmail(email);
    const errs: Record<string, string> = {};
    if (!em.ok) errs.email = em.error;
    const nm = name.trim();
    if (nm && (nm.length < 2 || nm.length > 80)) errs.name = 'Name must be 2 to 80 characters';
    if (!Object.values(perms).some(Boolean)) errs.perms = 'Give at least one permission';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setFormError(null);
    try {
      setResult(await invite.mutateAsync({ email: em.ok ? em.value : email.trim(), name: nm || undefined, permissions: perms }));
    } catch (e: any) {
      const f = e?.fields as Record<string, string> | undefined;
      if (f?.email) setErrors({ email: f.email });
      else setFormError(pipeError(e));
    }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title={result ? 'Invite sent' : 'Invite a recruiter'}>
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        {result ? (
          <>
            {result.member ? <Banner tone="success" message={`${result.member.name || result.member.email} already has a recruiter account and was added to this drive. They were notified in the app.`} /> : null}
            {result.inviteToken ? <TokenPanel token={result.inviteToken} emailSent={result.emailSent} email={email.trim()} /> : null}
            <Button label="Done" full onPress={onClose} />
          </>
        ) : (
          <>
            <EmailField value={email} onChangeText={(t) => { setEmail(t); setErrors((x) => ({ ...x, email: '' })); }} error={errors.email || null} />
            <TextField label="Name (optional)" value={name} onChangeText={(t) => { setName(t); setErrors((x) => ({ ...x, name: '' })); }} error={errors.name || null} maxLength={80} />
            <Text variant="subhead">Permissions</Text>
            <PermissionList value={perms} onChange={(p) => { setPerms(p); setErrors((x) => ({ ...x, perms: '' })); }} />
            {errors.perms ? <Banner tone="error" message={errors.perms} /> : null}
            {formError ? <Banner tone="error" message={formError} /> : null}
            <Button label="Send invite" full loading={busy} onPress={() => send()} />
          </>
        )}
      </View>
    </Sheet>
  );
}
