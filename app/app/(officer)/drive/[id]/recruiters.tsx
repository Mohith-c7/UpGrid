import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Chip, SectionHeader, Sheet, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRecruiterActions, useRecruiters } from '@/api/pipeline';
import { RECRUITER_PERMISSIONS, type PermissionMap, type RecruiterInvite, type RecruiterMember } from '@/api/pipelineTypes';
import { Boundary, confirm, formatIST, Page, ReasonSheet, sp, useOnce } from '@/features/pipeline/kit';
import { InviteSheet, PermissionList, TokenPanel } from '@/features/pipeline/officer/InviteSheet';

const INVITE_TONE = { pending: 'info', expired: 'warning', revoked: 'neutral', accepted: 'success' } as const;
const INVITE_LABEL = { pending: 'Invite pending', expired: 'Invite expired', revoked: 'Invite revoked', accepted: 'Accepted' } as const;

export default function Recruiters() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const [showRevoked, setShowRevoked] = useState(false);
  const q = useRecruiters(driveId, showRevoked);
  const act = useRecruiterActions(driveId);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<RecruiterMember | null>(null);
  const [editPerms, setEditPerms] = useState<PermissionMap | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<RecruiterMember | null>(null);
  const [resent, setResent] = useState<{ invite: RecruiterInvite; token?: string; emailSent?: boolean } | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));
  const members = q.data?.members ?? [];
  const invites = (q.data?.invites ?? []).filter((i) => i.status !== 'accepted');

  const [savePerms, savingPerms] = useOnce(async () => {
    if (!editing || !editPerms) return;
    if (!Object.values(editPerms).some(Boolean)) { setEditError('Give at least one permission, or revoke the recruiter instead.'); return; }
    setEditError(null);
    try { await act.setPermissions.mutateAsync({ userId: editing.userId, permissions: editPerms }); toast.show('Permissions updated', 'success'); setEditing(null); }
    catch (e) { setEditError(pipeError(e)); }
  });
  const [resend] = useOnce(async (inv: RecruiterInvite) => {
    try { const r = await act.resend.mutateAsync(inv.id); setResent({ invite: inv, token: r.inviteToken, emailSent: r.emailSent }); }
    catch (e) { toast.show(pipeError(e), 'error'); }
  });
  const [revokeInvite] = useOnce(async (inv: RecruiterInvite) => {
    try { await act.revokeInvite.mutateAsync(inv.id); toast.show('Invite revoked', 'success'); }
    catch (e) { toast.show(pipeError(e), 'error'); }
  });

  const count = (m: RecruiterMember) => RECRUITER_PERMISSIONS.filter((k) => m.permissions?.[k]).length;

  return (
    <Page title="Recruiters" onBack={back} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={<Button label="Invite a recruiter" icon="person-add" full onPress={() => setInviting(true)} />}>
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={110}
        isEmpty={members.length === 0 && invites.length === 0}
        empty={{ icon: 'groups', title: 'No recruiters yet', message: 'Invite the company contacts who will shortlist and interview. They only see the fields students shared when applying.', actionLabel: 'Invite a recruiter', onAction: () => setInviting(true) }}>
        <Chip label={'Show revoked members'} selected={showRevoked} onPress={() => setShowRevoked((v) => !v)} />

        {members.length > 0 ? <SectionHeader title="Members" /> : null}
        {members.map((m) => (
          <Card key={m.userId}>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">{m.name}</Text>
              <Text variant="caption" color={colors.muted}>{m.email}</Text>
              {m.revokedAt ? <Badge label={`Revoked ${formatIST(m.revokedAt)}`} tone="neutral" icon="block" /> : <Badge label={`${count(m)} of ${RECRUITER_PERMISSIONS.length} permissions`} tone="info" icon="verified-user" />}
              <Text variant="caption" color={colors.muted}>{`Added ${formatIST(m.addedAt)}`}</Text>
              {!m.revokedAt ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  <Button label="Permissions" size="sm" variant="secondary" icon="tune" onPress={() => { setEditing(m); setEditPerms({ ...m.permissions }); setEditError(null); }} />
                  <Button label="Revoke access" size="sm" variant="danger" icon="block" onPress={() => setRevoking(m)} />
                </View>
              ) : null}
            </View>
          </Card>
        ))}

        {invites.length > 0 ? <SectionHeader title="Invites" /> : null}
        {invites.map((i) => (
          <Card key={i.id}>
            <View style={{ gap: sp.sm }}>
              <Text variant="subhead">{i.name || i.email}</Text>
              {i.name ? <Text variant="caption" color={colors.muted}>{i.email}</Text> : null}
              <Badge label={INVITE_LABEL[i.status]} tone={INVITE_TONE[i.status]} icon={i.status === 'pending' ? 'hourglass-empty' : i.status === 'expired' ? 'timer-off' : 'block'} />
              <Text variant="caption" color={colors.muted}>{i.status === 'expired' ? `Expired ${formatIST(i.expiresAt)}` : `Expires ${formatIST(i.expiresAt)}`}</Text>
              {i.status === 'pending' || i.status === 'expired' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  <Button label="Resend" size="sm" variant="secondary" icon="send" onPress={() => resend(i)} />
                  <Button label="Revoke" size="sm" variant="danger" icon="block"
                    onPress={() => confirm('Revoke this invite?', `${i.email} will no longer be able to register with it.`, 'Revoke invite', () => { void revokeInvite(i); })} />
                </View>
              ) : null}
            </View>
          </Card>
        ))}
      </Boundary>

      <InviteSheet driveId={driveId} visible={inviting} onClose={() => setInviting(false)} />

      <Sheet visible={!!editing} onClose={() => { if (!savingPerms) setEditing(null); }} title={editing ? `Permissions for ${editing.name}` : ''}>
        {editing && editPerms ? (
          <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
            <PermissionList value={editPerms} onChange={setEditPerms} />
            {editError ? <Banner tone="error" message={editError} /> : null}
            <Button label="Save permissions" full loading={savingPerms} onPress={() => savePerms()} />
            <Button label="Cancel" variant="ghost" full disabled={savingPerms} onPress={() => setEditing(null)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!resent} onClose={() => setResent(null)} title="Invite re-issued">
        {resent ? (
          <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
            {resent.token ? <TokenPanel token={resent.token} emailSent={resent.emailSent} email={resent.invite.email} /> : <Banner tone="success" message="Invite re-issued." />}
            <Button label="Done" full onPress={() => setResent(null)} />
          </View>
        ) : null}
      </Sheet>

      <ReasonSheet
        visible={!!revoking} onClose={() => setRevoking(null)} title={revoking ? `Revoke ${revoking.name}?` : ''} required={false} label="Reason"
        description="They lose access to this drive immediately. Their notes and scorecards stay on record."
        confirmLabel="Revoke access"
        onSubmit={async (reason) => {
          await act.revokeMember.mutateAsync({ userId: revoking!.userId, reason: reason || undefined });
          toast.show('Access revoked', 'success');
          setRevoking(null);
        }}
      />
    </Page>
  );
}
