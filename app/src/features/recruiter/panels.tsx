import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorState, Icon, SectionHeader, SegmentedControl, Select, Sheet, Skeleton, Text, TextField, TimelineList, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { errMessage, fieldErrors } from '@/api/client';
import { useAuth } from '@/api/hooks';
import {
  fetchResumeUrl, useAddNote, useDecision, useDeleteNote, useProposeOutcome, useRubric, useScorecards, useSubmitScorecard,
} from '@/api/recruiter';
import type { CandidateDetail, Decision, Recommendation, RecruiterPermissions, Scorecard } from '@/api/recruiterTypes';
import { formatDateTimeIST, timeAgo } from '@/lib/format';
import { can, DECISION_META, fmt, OFFER_META, RECOMMENDATION_LABEL, ROUND_STATUS_META, StatusBadge, statusMeta } from './kit';

/* ------------------------------------------------------------------ shared snapshot */
const FIELD_LABELS: { key: string; label: string; format?: (v: unknown, d: CandidateDetail) => string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'registrationNumber', label: 'Registration number' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Mobile', format: (v, d) => d.fields.phoneDisplay ?? String(v) },
  { key: 'department', label: 'Department' },
  { key: 'program', label: 'Program' },
  { key: 'batchYear', label: 'Batch' },
  { key: 'cgpa', label: 'CGPA', format: (v, d) => `${v}${d.fields.cgpaScale ? ` / ${d.fields.cgpaScale}` : ''}` },
  { key: 'tenthPercent', label: '10th', format: (v) => `${v}%` },
  { key: 'twelfthPercent', label: '12th', format: (v) => `${v}%` },
  { key: 'activeBacklogs', label: 'Active backlogs' },
  { key: 'gapYears', label: 'Gap years' },
  { key: 'linkedin', label: 'LinkedIn' },
];

/** Renders ONLY the apply-time snapshot (`fields`). Never the live profile. */
export function SnapshotCard({ d }: { d: CandidateDetail }) {
  // Only the fields the candidate shared when applying. `fieldKeys` is that list; a key the server happens to send outside it is not shown.
  const shared = d.fieldKeys ?? [];
  const rows = shared.length ? FIELD_LABELS.filter((f) => shared.includes(f.key)) : FIELD_LABELS.filter((f) => (d.fields as unknown as Record<string, unknown>)[f.key] != null);
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="caption" color={colors.muted}>Details the candidate shared when applying. They do not update if the profile changes.</Text>
      {rows.map((f) => {
        const raw = (d.fields as unknown as Record<string, unknown>)[f.key];
        const v = raw === null || raw === undefined || raw === '' ? null : raw;
        const ver = d.verification?.[f.key];
        return (
          <View key={f.key} style={{ gap: 2 }}>
            <Text variant="overline" color={colors.muted}>{f.label}</Text>
            <Text variant="body" selectable tabular>{v === null ? 'Not provided' : f.format ? f.format(v, d) : String(v)}</Text>
            {ver === 'verified' ? <Badge label="Verified by placement cell" tone="success" /> : null}
          </View>
        );
      })}
    </Card>
  );
}

export function AnswersCard({ d }: { d: CandidateDetail }) {
  if (!d.answers.length) return null;
  return (
    <Card style={{ gap: 12 }}>
      {d.answers.map((a) => (
        <View key={a.id} style={{ gap: 2 }}>
          <Text variant="overline" color={colors.muted}>{a.label}</Text>
          <Text variant="body" selectable>{Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? 'Yes' : 'No') : a.value == null || a.value === '' ? 'No answer' : String(a.value)}</Text>
        </View>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------------ resume */
export function ResumeButton({ driveId, appId, label }: { driveId: string; appId: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try {
      const r = await fetchResumeUrl(driveId, appId); // fresh signed URL on every tap (valid ~5 minutes)
      if (!/^https?:\/\//i.test(r.url)) throw new Error('This resume link is not valid.');
      await Linking.openURL(r.url);
    } catch (e) {
      setError(errMessage(e).includes('open') ? 'No app on this phone can open the resume. Try again after installing a PDF viewer.' : errMessage(e));
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Button label={`Open resume${label ? `: ${label}` : ''}`} icon="description" variant="secondary" full onPress={open} />
      {error ? <Banner tone="error" message={error} /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ working decision */
export function DecisionCard({ driveId, d, perms }: { driveId: string; d: CandidateDetail; perms?: RecruiterPermissions }) {
  const toast = useToast();
  const m = useDecision(driveId);
  const [confirm, setConfirm] = useState<Decision | 'clear' | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const meta = d.decision ? DECISION_META[d.decision] : null;
  const allowed = can(perms, 'shortlist');

  const submit = async () => {
    if (!confirm) return;
    const r = reason.trim();
    if (confirm === 'rejected' && (r.length < 3 || r.length > 500)) { setErr('Give a reason of 3 to 500 characters.'); return; }
    try {
      await m.mutateAsync({ applicationId: d.applicationId, decision: confirm, reason: r || undefined });
      toast.show(confirm === 'clear' ? 'Decision cleared' : `Marked ${DECISION_META[confirm].label.toLowerCase()}`, 'success');
      setConfirm(null); setReason(''); setErr(null);
    } catch (e) {
      setErr(errMessage(e));
    }
  };
  const title = confirm === 'rejected' ? 'Reject this candidate?' : confirm === 'shortlisted' ? 'Shortlist this candidate?' : confirm === 'on_hold' ? 'Put this candidate on hold?' : 'Clear your decision?';
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Text variant="subhead">Working decision</Text>
        {meta ? <Badge label={meta.label} tone={meta.tone} icon={meta.icon as never} /> : <Badge label="Not decided" tone="neutral" />}
      </View>
      {d.decisionReason ? <Text variant="caption" color={colors.muted}>Reason: {d.decisionReason}</Text> : null}
      <Text variant="caption" color={colors.muted}>This is your working list. It does not change the application status; propose an outcome for that.</Text>
      {allowed ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button size="sm" label="Shortlist" icon="check" variant={d.decision === 'shortlisted' ? 'secondary' : 'primary'} onPress={() => { setReason(''); setErr(null); setConfirm('shortlisted'); }} />
            <Button size="sm" label="On hold" icon="pause" variant="secondary" onPress={() => { setReason(''); setErr(null); setConfirm('on_hold'); }} />
            <Button size="sm" label="Reject" icon="close" variant="danger" onPress={() => { setReason(''); setErr(null); setConfirm('rejected'); }} />
          </View>
          {d.decision ? <Button size="sm" label="Clear decision" variant="ghost" onPress={() => { setErr(null); setConfirm('clear'); }} /> : null}
        </View>
      ) : null}
      <Sheet visible={!!confirm} onClose={() => { if (!m.isPending) setConfirm(null); }} title={title}>
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text variant="body">{d.fields.name ?? d.reference}</Text>
          {confirm === 'rejected' || confirm === 'on_hold' ? (
            <TextField label={confirm === 'rejected' ? 'Reason (required)' : 'Note (optional)'} value={reason} onChangeText={(t) => { setReason(t); setErr(null); }} multiline maxLength={500} error={confirm === 'rejected' ? err : null} />
          ) : null}
          {err && confirm !== 'rejected' ? <Banner tone="error" message={err} /> : null}
          <Button label="Confirm" variant={confirm === 'rejected' ? 'danger' : 'primary'} full loading={m.isPending} onPress={submit} />
          <Button label="Cancel" variant="ghost" full disabled={m.isPending} onPress={() => setConfirm(null)} />
        </View>
      </Sheet>
    </Card>
  );
}

/* ------------------------------------------------------------------ notes */
export function NotesCard({ driveId, d, perms }: { driveId: string; d: CandidateDetail; perms?: RecruiterPermissions }) {
  const toast = useToast();
  const { user } = useAuth();
  const add = useAddNote(driveId, d.applicationId);
  const del = useDeleteNote(driveId, d.applicationId);
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<'team' | 'private'>('team');
  const [err, setErr] = useState<string | null>(null);
  const allowed = can(perms, 'notes');

  const submit = async () => {
    const b = body.trim();
    if (!b) { setErr('Write a note first.'); return; }
    if (b.length > 2000) { setErr('Notes can be up to 2000 characters.'); return; }
    try {
      await add.mutateAsync({ body: b, visibility: vis });
      setBody(''); setErr(null);
      toast.show('Note saved', 'success');
    } catch (e) {
      setErr(errMessage(e));
    }
  };
  return (
    <View style={{ gap: 12 }}>
      {d.notes.length === 0 ? <Text variant="caption" color={colors.muted}>No notes yet. Students never see notes.</Text> : null}
      {d.notes.map((n) => (
        <Card key={n.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Text variant="caption" style={{ fontWeight: '600' }}>{n.author.name}</Text>
            <Badge label={n.visibility === 'private' ? 'Only you' : 'Team'} tone="neutral" icon={n.visibility === 'private' ? 'lock-outline' : 'group'} />
          </View>
          <Text variant="body" selectable>{n.body}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="caption" color={colors.muted}>{timeAgo(n.createdAt)}</Text>
            {n.author.id === user?.id ? (
              <Button size="sm" variant="ghost" label="Delete" icon="delete-outline" loading={del.isPending && del.variables === n.id} onPress={() => Alert.alert('Delete this note?', 'It is removed for everyone who could see it.', [
                { text: 'Keep', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => { try { await del.mutateAsync(n.id); } catch (e) { toast.show(errMessage(e), 'error'); } } },
              ])} />
            ) : null}
          </View>
        </Card>
      ))}
      {allowed ? (
        <Card style={{ gap: 12 }}>
          <TextField label="Add a note" value={body} onChangeText={(t) => { setBody(t); setErr(null); }} multiline maxLength={2000} error={err} />
          <SegmentedControl value={vis} onChange={(v) => setVis(v === 'private' ? 'private' : 'team')} options={[{ value: 'team', label: 'Team can see' }, { value: 'private', label: 'Only me' }]} />
          <Button label="Save note" full loading={add.isPending} disabled={!body.trim()} onPress={submit} />
        </Card>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ blind scorecard */
const RECS: Recommendation[] = ['strong_hire', 'hire', 'no_hire', 'strong_no_hire'];

function ScorecardView({ s, mine }: { s: Scorecard; mine?: boolean }) {
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Text variant="subhead">{mine ? 'Your scorecard' : s.recruiter.name}</Text>
        <Badge label={RECOMMENDATION_LABEL[s.recommendation] ?? s.recommendation} tone={s.recommendation.includes('no') ? 'error' : 'success'} />
      </View>
      <Text variant="caption" color={colors.muted} tabular>Overall {fmt(s.overall)} of 5{s.revision > 1 ? `, revision ${s.revision}` : ''}</Text>
      {s.ratings.map((r) => (
        <View key={r.itemId} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text variant="body" style={{ flex: 1 }}>{r.label}</Text>
          <Text variant="body" tabular style={{ fontWeight: '600' }}>{r.rating} / 5</Text>
        </View>
      ))}
      {s.comments ? <Text variant="body" selectable>{s.comments}</Text> : null}
    </Card>
  );
}

export function ScorecardSection({ driveId, d, perms, blind }: { driveId: string; d: CandidateDetail; perms?: RecruiterPermissions; blind: boolean }) {
  const toast = useToast();
  const { user } = useAuth();
  const eligibleRounds = d.rounds.filter((r) => !r.waitlisted);
  const [roundId, setRoundId] = useState<string>(eligibleRounds[eligibleRounds.length - 1]?.roundId ?? '');
  useEffect(() => { if (!roundId && eligibleRounds[0]) setRoundId(eligibleRounds[eligibleRounds.length - 1].roundId); }, [eligibleRounds, roundId]);

  const rubric = useRubric(driveId, roundId || undefined);
  const cards = useScorecards(driveId, d.applicationId, roundId || undefined);
  const submit = useSubmitScorecard(driveId, d.applicationId);
  const mine = cards.data?.items.find((c) => c.recruiter.id === user?.id);
  const others = (cards.data?.items ?? []).filter((c) => c.recruiter.id !== user?.id);

  const [editing, setEditing] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState('');
  const [rec, setRec] = useState<Recommendation | ''>('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const allowed = can(perms, 'scorecards');

  useEffect(() => { setEditing(false); setConfirm(false); }, [roundId]);

  const startEdit = () => {
    setRatings(mine ? Object.fromEntries(mine.ratings.map((r) => [r.itemId, r.rating])) : {});
    setComments(mine?.comments ?? '');
    setRec(mine?.recommendation ?? '');
    setErrs({}); setFormErr(null); setEditing(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    (rubric.data?.items ?? []).forEach((i) => { if (!ratings[i.id]) e[i.id] = 'Rate this item from 1 to 5.'; });
    if (!rec) e.recommendation = 'Choose a recommendation.';
    if (comments.length > 2000) e.comments = 'Comments can be up to 2000 characters.';
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const doSubmit = async () => {
    try {
      await submit.mutateAsync({
        roundId, recommendation: rec as Recommendation, comments: comments.trim() || undefined,
        ratings: (rubric.data?.items ?? []).map((i) => ({ itemId: i.id, rating: ratings[i.id] })),
      });
      setConfirm(false); setEditing(false);
      toast.show('Scorecard submitted', 'success');
    } catch (e) {
      setConfirm(false);
      const fe = fieldErrors(e);
      const next: Record<string, string> = {};
      Object.entries(fe).forEach(([k, v]) => { next[k.replace(/^ratings\./, '')] = v; });
      setErrs(next);
      setFormErr(errMessage(e));
    }
  };

  if (!eligibleRounds.length)
    return <EmptyState icon="rule" title="Not in a round yet" message="Scorecards open once the candidate is added to a round." />;

  return (
    <View style={{ gap: 12 }}>
      <Select label="Round" value={roundId} onChange={setRoundId} options={eligibleRounds.map((r) => ({ value: r.roundId, label: `${r.seq}. ${r.name}` }))} />
      {rubric.isLoading || cards.isLoading ? <Skeleton height={120} radius={14} /> : null}
      {rubric.isError ? <ErrorState message={errMessage(rubric.error)} onRetry={() => void rubric.refetch()} /> : null}
      {!rubric.isLoading && !rubric.isError && !rubric.data ? (
        <Banner tone="info" title="No rubric yet" message="The placement cell has not set scoring criteria for this round, so scorecards cannot be submitted." />
      ) : null}
      {cards.isError ? <ErrorState message={errMessage(cards.error)} onRetry={() => void cards.refetch()} /> : null}

      {mine && !editing ? (
        <>
          <ScorecardView s={mine} mine />
          {allowed && rubric.data ? <Button label="Edit my scorecard" variant="secondary" full onPress={startEdit} /> : null}
        </>
      ) : null}

      {!mine && !editing && rubric.data && allowed ? (
        <Button label="Score this candidate" icon="rate-review" full onPress={startEdit} />
      ) : null}

      {editing && rubric.data ? (
        <Card style={{ gap: 16 }}>
          {blind && !mine ? <Banner tone="info" message="Scorecards are blind. You will see other recruiters' scores only after you submit yours." /> : null}
          {rubric.data.items.map((i) => (
            <View key={i.id} style={{ gap: 6 }}>
              <Text variant="subhead">{i.label}</Text>
              {i.description ? <Text variant="caption" color={colors.muted}>{i.description}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                {[1, 2, 3, 4, 5].map((n) => {
                  const sel = ratings[i.id] === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => { setRatings((p) => ({ ...p, [i.id]: n })); setErrs((p) => ({ ...p, [i.id]: '' })); }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: sel }}
                      accessibilityLabel={`${i.label}: ${n} of 5`}
                      style={{ flex: 1, minWidth: MIN_TOUCH - 8, minHeight: MIN_TOUCH, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.borderStrong, backgroundColor: sel ? colors.primary : colors.surface }}
                    >
                      <Text variant="subhead" tabular color={sel ? colors.surface : colors.ink}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" color={colors.muted}>1 weak</Text>
                <Text variant="caption" color={colors.muted}>5 excellent</Text>
              </View>
              {errs[i.id] ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errs[i.id]}</Text></View> : null}
            </View>
          ))}
          <View style={{ gap: 6 }}>
            <Text variant="subhead">Recommendation</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {RECS.map((r) => <Chip key={r} label={RECOMMENDATION_LABEL[r]} selected={rec === r} onPress={() => { setRec(r); setErrs((p) => ({ ...p, recommendation: '' })); }} />)}
            </View>
            {errs.recommendation ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="error-outline" size={20} color={colors.error} /><Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{errs.recommendation}</Text></View> : null}
          </View>
          <TextField label="Comments (optional)" value={comments} onChangeText={setComments} multiline maxLength={2000} error={errs.comments || null} />
          {formErr ? <Banner tone="error" message={formErr} /> : null}
          <Button label={mine ? 'Update scorecard' : 'Submit scorecard'} full onPress={() => { setFormErr(null); if (validate()) setConfirm(true); }} />
          <Button label="Cancel" variant="ghost" full onPress={() => setEditing(false)} />
        </Card>
      ) : null}

      {(cards.data?.hiddenCount ?? 0) > 0 ? (
        <Banner tone="info" icon="visibility-off" title="Other scorecards hidden" message={`${cards.data?.hiddenCount} other scorecard${cards.data?.hiddenCount === 1 ? ' is' : 's are'} hidden until you submit yours.`} />
      ) : null}
      {others.length ? (
        <View style={{ gap: 12 }}>
          <Text variant="subhead">Other recruiters</Text>
          {others.map((s) => <ScorecardView key={s.id} s={s} />)}
        </View>
      ) : null}

      <Sheet visible={confirm} onClose={() => { if (!submit.isPending) setConfirm(false); }} title="Submit scorecard?">
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text variant="body">{blind && !mine ? 'Once submitted you can still edit it, and other recruiters\' scorecards for this round are revealed to you.' : 'Your updated scorecard replaces the previous one. The revision is recorded.'}</Text>
          <Button label="Submit" full loading={submit.isPending} onPress={doSubmit} />
          <Button label="Review again" variant="ghost" full disabled={submit.isPending} onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </View>
  );
}

/* ------------------------------------------------------------------ outcome proposal */
export function OutcomeCard({ driveId, d, perms }: { driveId: string; d: CandidateDetail; perms?: RecruiterPermissions }) {
  const toast = useToast();
  const m = useProposeOutcome(driveId, d.applicationId);
  const [kind, setKind] = useState<'select' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const o = d.outcome;
  const allowed = can(perms, 'proposeOutcomes');
  const final = ['selected', 'rejected', 'offer_issued', 'offer_accepted', 'offer_declined', 'joined', 'withdrawn'].includes(d.status);

  const submit = async () => {
    if (!kind) return;
    const r = reason.trim();
    if (kind === 'reject' && (r.length < 3 || r.length > 500)) { setErr('Give a reason of 3 to 500 characters.'); return; }
    try {
      await m.mutateAsync({ kind, reason: r || undefined });
      toast.show('Proposal sent to the placement cell', 'success');
      setKind(null); setReason(''); setErr(null);
    } catch (e) {
      setErr(errMessage(e));
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="subhead">Selection outcome</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Text variant="caption" color={colors.muted}>Application status</Text>
        <StatusBadge status={d.status} />
      </View>
      {o ? (
        <Banner
          tone={o.status === 'pending' ? 'warning' : o.status === 'approved' ? 'success' : 'neutral'}
          title={`${o.kind === 'select' ? 'Selection' : 'Rejection'} proposal ${o.status === 'pending' ? 'awaiting approval' : o.status}`}
          message={[o.reason, o.decisionNote ? `Officer note: ${o.decisionNote}` : null].filter(Boolean).join('\n') || 'The placement cell decides the final status.'}
        />
      ) : null}
      {allowed && o?.status !== 'pending' && !final ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button size="sm" label="Propose select" icon="check" onPress={() => { setReason(''); setErr(null); setKind('select'); }} />
          <Button size="sm" label="Propose reject" icon="close" variant="danger" onPress={() => { setReason(''); setErr(null); setKind('reject'); }} />
        </View>
      ) : null}
      {!allowed ? null : <Text variant="caption" color={colors.muted}>Proposals go to the placement cell. The application status only changes when an officer approves.</Text>}
      <Sheet visible={!!kind} onClose={() => { if (!m.isPending) setKind(null); }} title={kind === 'select' ? 'Propose selection?' : 'Propose rejection?'}>
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text variant="body">{d.fields.name ?? d.reference}</Text>
          <TextField label={kind === 'reject' ? 'Reason (required)' : 'Reason (optional)'} value={reason} onChangeText={(t) => { setReason(t); setErr(null); }} multiline maxLength={500} error={err} />
          <Button label="Send proposal" variant={kind === 'reject' ? 'danger' : 'primary'} full loading={m.isPending} onPress={submit} />
          <Button label="Cancel" variant="ghost" full disabled={m.isPending} onPress={() => setKind(null)} />
        </View>
      </Sheet>
    </Card>
  );
}

/* ------------------------------------------------------------------ rounds + history */
export function RoundsCard({ d }: { d: CandidateDetail }) {
  if (!d.rounds.length) return <Text variant="caption" color={colors.muted}>Not added to any round yet.</Text>;
  return (
    <Card padding={0}>
      {d.rounds.map((r, i) => {
        const m = ROUND_STATUS_META[r.status] ?? { label: r.status, tone: 'neutral' as const };
        return (
          <View key={r.roundId} style={{ padding: 14, gap: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <Text variant="subhead">{r.seq}. {r.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Badge label={m.label} tone={m.tone} />
              {r.waitlisted ? <Badge label="Waitlisted" tone="warning" /> : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export function HistoryCard({ d }: { d: CandidateDetail }) {
  if (!d.events.length) return null;
  return (
    <Card>
      <TimelineList
        items={d.events.map((e, i) => ({
          title: `${statusMeta(e.status).label}${e.note ? `: ${e.note}` : ''}`,
          time: formatDateTimeIST(e.createdAt),
          state: i === d.events.length - 1 ? 'current' : 'done',
        }))}
      />
    </Card>
  );
}

export function OfferStatusLine({ d }: { d: CandidateDetail }) {
  if (!d.offer) return null;
  const m = OFFER_META[d.offer.status] ?? { label: d.offer.status, tone: 'neutral' as const };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Text variant="caption" color={colors.muted}>Offer</Text>
      <Badge label={m.label} tone={m.tone} />
    </View>
  );
}

export { SectionHeader };
