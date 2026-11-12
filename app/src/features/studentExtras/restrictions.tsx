import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import { ApiError } from '@/api/client';
import { useSession } from '@/state/session';
import { useFeature } from '@/config/features';
import { useAppealRestriction, useMyRestrictions } from '@/api/studentExtras';
import type { MyRestriction } from '@/api/studentExtrasTypes';
import { formatDateIST } from '@/lib/format';
import { validateText } from '@/lib/validation';

export const RESTRICTIONS_ROUTE = '/(student)/restrictions';

const SCOPE_LABEL: Record<string, string> = {
  student: 'Applies to you', company: 'One company', drive: 'One drive', department: 'Your department', batch: 'Your batch', tenant: 'All students',
};
export const scopeLabel = (s: string) => SCOPE_LABEL[s] ?? 'Restriction';

/** "12 Nov 2026 to 30 Nov 2026" / "From ..." / "Until ..." / "Until further notice". IST. */
export function durationText(r: Pick<MyRestriction, 'startsAt' | 'endsAt'>): string {
  const s = r.startsAt ? formatDateIST(r.startsAt) : null;
  const e = r.endsAt ? formatDateIST(r.endsAt) : null;
  if (s && e) return `${s} to ${e}`;
  if (e) return `Until ${e}`;
  if (s) return `From ${s}, until further notice`;
  return 'Until further notice';
}

/** Hook used by banners: only student sessions on a server that has the restrictions module query anything. */
export function useStudentRestrictions() {
  const { role } = useSession();
  const on = useFeature('opsRestrictions');
  const q = useMyRestrictions(role === 'student' && on);
  return { ...q, items: q.data ?? [], enabled: on && role === 'student' };
}

/** Drop into Home / drive screens. Renders nothing when there is no active restriction (or while loading / on error). */
export function RestrictionBanner() {
  const router = useRouter();
  const { items } = useStudentRestrictions();
  if (items.length === 0) return null;
  const first = items[0];
  const extra = items.length - 1;
  return (
    <Banner
      tone="warning"
      icon="gpp-maybe"
      title={items.length === 1 ? 'Some applications are restricted for you' : `${items.length} restrictions apply to you`}
      message={`${first.message}${extra > 0 ? ` (+${extra} more)` : ''}`}
      action={{ label: items.some((r) => r.canAppeal && !r.appeal) ? 'View details and appeal' : 'View details', onPress: () => router.push(RESTRICTIONS_ROUTE as never) }}
    />
  );
}

export function AppealBadge({ appeal }: { appeal: MyRestriction['appeal'] }) {
  if (!appeal) return null;
  if (appeal.status === 'pending') return <Badge label="Appeal under review" tone="info" icon="hourglass-empty" />;
  if (appeal.status === 'overturned') return <Badge label="Appeal accepted" tone="success" icon="check-circle" />;
  if (appeal.status === 'upheld') return <Badge label="Appeal decided: restriction stays" tone="neutral" icon="info-outline" />;
  return <Badge label={`Appeal ${appeal.status}`} tone="neutral" icon="info-outline" />;
}

function AppealForm({ restriction }: { restriction: MyRestriction }) {
  const toast = useToast();
  const m = useAppealRestriction();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const v = validateText(text, { required: true, label: 'Your appeal' });
    const len = text.trim().length;
    if (!v.ok) { setErr(v.error); return; }
    if (len < 10) { setErr('Write at least 10 characters so the placement cell understands your request.'); return; }
    if (len > 1000) { setErr('Keep your appeal under 1000 characters.'); return; }
    setErr(null);
    try {
      await m.mutateAsync({ id: restriction.id, message: text.trim() });
      setSent(true);
      toast.show('Appeal sent to the placement cell', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'APPEAL_EXISTS') { toast.show('You already have an appeal waiting for review.', 'info'); return; }
      if (e instanceof ApiError && e.fields?.message) { setErr(e.fields.message); return; }
      toast.show(e instanceof Error ? e.message : 'Could not send the appeal. Try again.', 'error');
    }
  };

  if (sent) return <Banner tone="success" message="Your appeal was sent. You will get a notification when the placement cell decides." />;
  return (
    <View style={{ gap: 12 }}>
      <TextField
        label="Why should this be reviewed?" value={text} onChangeText={(t) => { setText(t); if (err) setErr(null); }}
        multiline maxLength={1000} error={err} helper="Facts help: dates, documents, what changed."
      />
      <Button label="Send appeal" icon="send" full loading={m.isPending} onPress={submit} />
    </View>
  );
}

export function RestrictionCard({ r, highlight }: { r: MyRestriction; highlight?: boolean }) {
  const router = useRouter();
  const pending = r.appeal?.status === 'pending';
  return (
    <Card style={highlight ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Badge label={scopeLabel(r.scope)} tone="warning" icon="gpp-maybe" />
          <AppealBadge appeal={r.appeal} />
        </View>
        <Text variant="body">{r.message}</Text>
        <View style={{ gap: 2 }}>
          <Text variant="caption" color={colors.muted}>Duration</Text>
          <Text variant="body" tabular style={{ fontWeight: '600' }}>{durationText(r)}</Text>
        </View>
        {r.appeal?.decisionNote ? (
          <View style={{ gap: 2 }}>
            <Text variant="caption" color={colors.muted}>Note from the placement cell</Text>
            <Text variant="body">{r.appeal.decisionNote}</Text>
          </View>
        ) : null}
        {pending ? (
          <Text variant="caption" color={colors.muted}>Your appeal is with the placement cell. You cannot send another while it is under review.</Text>
        ) : r.canAppeal && !r.appeal ? (
          <AppealForm restriction={r} />
        ) : r.appeal?.status === 'overturned' ? null : (
          <View style={{ gap: 8 }}>
            <Text variant="caption" color={colors.muted}>
              {r.appeal ? 'This appeal has been decided.' : 'An appeal is not available for this restriction.'} If you think something is wrong, ask the placement cell.
            </Text>
            <Button label="Contact the placement cell" size="sm" variant="secondary" icon="support-agent" onPress={() => router.push('/(student)/support/new?category=eligibility' as never)} />
          </View>
        )}
      </View>
    </Card>
  );
}
