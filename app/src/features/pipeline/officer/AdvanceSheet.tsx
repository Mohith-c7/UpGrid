import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, Select, Sheet, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRoundCandidateActions } from '@/api/pipeline';
import type { AdvancePerson, AdvancePreview, AdvanceResult, Round } from '@/api/pipelineTypes';
import { newIdempotencyKey } from '@/lib/idempotency';
import { sp, useOnce } from '../kit';

const SKIP_LABEL: Record<string, string> = {
  not_passed: 'Has not passed this round', already_in_target: 'Already in the next round', application_inactive: 'Application is no longer active', waitlisted: 'Is on the waitlist',
};

function PeopleList({ title, people }: { title: string; people: AdvancePerson[] }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, 8);
  return (
    <View style={{ gap: 2 }}>
      <Text variant="subhead">{`${title} (${people.length})`}</Text>
      {shown.map((p) => (
        <Text key={p.applicationId} variant="body" color={colors.textSecondary}>{`${p.name ?? 'Candidate'}${p.avgScore != null ? `, avg score ${p.avgScore}` : ''}`}</Text>
      ))}
      {people.length > shown.length ? <Text variant="caption" color={colors.muted}>{`and ${people.length - shown.length} more`}</Text> : null}
    </View>
  );
}

/** Advance preview then confirm. One idempotency key per previewed plan, reused on retries so a double tap or a flaky network cannot move people twice. */
export function AdvanceSheet({
  driveId, round, rounds, selectedIds, visible, onClose,
}: { driveId: string; round: Round; rounds: Round[]; selectedIds: string[]; visible: boolean; onClose: () => void }) {
  const { advancePreview, advance } = useRoundCandidateActions(driveId, round.id);
  const [toRoundId, setToRoundId] = useState('');
  const [capacity, setCapacity] = useState('');
  const [useSelection, setUseSelection] = useState(false);
  const [preview, setPreview] = useState<AdvancePreview | null>(null);
  const [done, setDone] = useState<AdvanceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const others = rounds.filter((r) => r.id !== round.id).sort((a, b) => a.seq - b.seq);

  useEffect(() => {
    if (!visible) return;
    setToRoundId(''); setCapacity(''); setUseSelection(selectedIds.length > 0); setPreview(null); setDone(null); setError(null); keyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const build = () => {
    const cap = capacity.trim() ? Number(capacity) : undefined;
    return {
      ...(useSelection && selectedIds.length ? { applicationIds: selectedIds } : {}),
      ...(toRoundId ? { toRoundId } : {}),
      ...(cap !== undefined ? { capacity: cap } : {}),
    };
  };
  const reset = () => { setPreview(null); setError(null); };

  const [runPreview, previewing] = useOnce(async () => {
    const cap = capacity.trim();
    if (cap && (!/^\d+$/.test(cap) || Number(cap) < 1 || Number(cap) > 1000)) { setError('Capacity must be a whole number from 1 to 1000, or empty for everyone.'); return; }
    setError(null);
    try { setPreview(await advancePreview.mutateAsync(build())); keyRef.current = newIdempotencyKey(); }
    catch (e) { setError(pipeError(e)); }
  });
  const [confirmGo, going] = useOnce(async () => {
    setError(null);
    try { setDone(await advance.mutateAsync({ ...build(), idempotencyKey: keyRef.current })); }
    catch (e) { setError(`${pipeError(e)} You can press Confirm again safely, nobody is moved twice.`); }
  });

  return (
    <Sheet visible={visible} onClose={() => { if (!going && !previewing) onClose(); }} title={`Advance from ${round.name}`}>
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        {done ? (
          <>
            <Banner tone="success" title={done.replayed ? 'Already done' : 'Advanced'}
              message={`${done.moved.length} invited to the next round, ${done.waitlisted.length} waitlisted, ${done.skipped.length} skipped.${done.replayed ? ' This request had already been applied, so nothing changed.' : ''}`} />
            <Button label="Done" full onPress={onClose} />
          </>
        ) : (
          <>
            <Text variant="body" color={colors.textSecondary}>Moves candidates who passed this round into the next round. You see exactly who moves before anything is saved.</Text>
            <Select label="Move into" value={toRoundId} onChange={(v) => { setToRoundId(v); reset(); }} placeholder="Next round (default)"
              options={[{ value: '', label: 'Next round (default)' }, ...others.map((r) => ({ value: r.id, label: `Round ${r.seq}: ${r.name}` }))]} />
            <TextField label="Capacity (optional)" value={capacity} onChangeText={(t) => { setCapacity(t.replace(/[^0-9]/g, '')); reset(); }} keyboardType="number-pad" maxLength={4}
              helper="Invite the best N by average score, waitlist the rest. Leave empty to invite everyone who passed." />
            {selectedIds.length > 0 ? (
              <Button label={useSelection ? `Only the ${selectedIds.length} selected candidates (tap to use everyone who passed)` : 'Everyone who passed (tap to use only selected)'} variant="secondary" full
                onPress={() => { setUseSelection((v) => !v); reset(); }} />
            ) : null}
            <Button label={preview ? 'Refresh preview' : 'Preview'} variant={preview ? 'secondary' : 'primary'} icon="visibility" full loading={previewing} onPress={() => runPreview()} />
            {preview ? (
              <Card tinted>
                <View style={{ gap: sp.md }}>
                  <Text variant="subhead">{`${preview.fromRound.name} to ${preview.toRound.name}`}</Text>
                  <PeopleList title="Will be invited" people={preview.toInvite} />
                  <PeopleList title="Will be waitlisted" people={preview.toWaitlist} />
                  {preview.skipped.length > 0 ? (
                    <View style={{ gap: 2 }}>
                      <Text variant="subhead">{`Skipped (${preview.skipped.length})`}</Text>
                      {preview.skipped.slice(0, 6).map((s) => <Text key={s.applicationId} variant="caption" color={colors.textSecondary}>{`${s.name ?? 'Candidate'}: ${SKIP_LABEL[s.reason] ?? s.reason}`}</Text>)}
                      {preview.skipped.length > 6 ? <Text variant="caption" color={colors.muted}>{`and ${preview.skipped.length - 6} more`}</Text> : null}
                    </View>
                  ) : null}
                  {preview.toInvite.length + preview.toWaitlist.length === 0 ? <Banner tone="warning" message="Nobody would move. Check that results are uploaded as passed." /> : null}
                </View>
              </Card>
            ) : null}
            {error ? <Banner tone="error" message={error} /> : null}
            {preview && preview.toInvite.length + preview.toWaitlist.length > 0 ? (
              <Button label={`Confirm: invite ${preview.toInvite.length}${preview.toWaitlist.length ? `, waitlist ${preview.toWaitlist.length}` : ''}`} full loading={going} onPress={() => confirmGo()} />
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}
