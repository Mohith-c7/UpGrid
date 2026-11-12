import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { pipeError, useRoundActions, useRounds } from '@/api/pipeline';
import type { Round } from '@/api/pipelineTypes';
import { Boundary, confirm, formatIST, KIND_LABEL, Page, sp, useOnce } from '@/features/pipeline/kit';
import { RoundForm } from '@/features/pipeline/officer/RoundForm';

const MAX_ROUNDS = 12;

export default function RoundsBuilder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const driveId = String(id);
  const router = useRouter();
  const toast = useToast();
  const q = useRounds(driveId);
  const act = useRoundActions(driveId);
  const [editing, setEditing] = useState<Round | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rounds = [...(q.data ?? [])].sort((a, b) => a.seq - b.seq);
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/(officer)/drive/${driveId}/pipeline` as never));

  /** No drag: swap with the neighbour and send the full new order. Buttons lock while the request runs. */
  const [move] = useOnce(async (index: number, dir: -1 | 1) => {
    const ids = rounds.map((r) => r.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setError(null);
    try { await act.reorder.mutateAsync(ids); } catch (e) { setError(pipeError(e)); }
  });
  const [remove] = useOnce(async (r: Round) => {
    setError(null);
    try { await act.remove.mutateAsync(r.id); toast.show('Round deleted', 'success'); } catch (e) { setError(pipeError(e)); }
  });
  const [publish] = useOnce(async (r: Round) => {
    setError(null);
    try { const res = await act.publish.mutateAsync(r.id); toast.show(`Results published. ${res.notified} student${res.notified === 1 ? '' : 's'} notified.`, 'success'); }
    catch (e) { setError(pipeError(e)); }
  });
  const locked = act.reorder.isPending;
  const total = (r: Round) => Object.values(r.counts ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

  return (
    <Page title="Rounds" onBack={back} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={<Button label="Add a round" icon="add" full disabled={rounds.length >= MAX_ROUNDS} onPress={() => { setEditing(null); setFormOpen(true); }} />}>
      <Boundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => { void q.refetch(); }} rows={3} height={150}
        isEmpty={rounds.length === 0} empty={{ icon: 'format-list-numbered', title: 'No rounds yet', message: 'Add the rounds in the order candidates go through them, for example aptitude, technical, HR.', actionLabel: 'Add a round', onAction: () => { setEditing(null); setFormOpen(true); } }}>
        {error ? <Banner tone="error" message={error} /> : null}
        {rounds.length >= MAX_ROUNDS ? <Banner tone="info" message="A drive can have at most 12 rounds." /> : null}
        {rounds.map((r, i) => (
          <Card key={r.id}>
            <View style={{ gap: sp.sm }}>
              <Text variant="overline" color={colors.muted}>{`Round ${r.seq}`}</Text>
              <Text variant="subhead">{r.name}</Text>
              <Text variant="caption" color={colors.muted}>
                {[KIND_LABEL[r.kind] ?? r.kind, r.mode ? (r.mode === 'online' ? 'Online' : 'In person') : null, r.scheduledAt ? formatIST(r.scheduledAt) : null].filter(Boolean).join(' · ')}
              </Text>
              {r.description ? <Text variant="body" color={colors.textSecondary}>{r.description}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Badge label={`${total(r)} candidate${total(r) === 1 ? '' : 's'}`} tone="neutral" icon="people-outline" />
                {r.resultsPublishedAt ? <Badge label={`Results published ${formatIST(r.resultsPublishedAt)}`} tone="success" icon="campaign" /> : <Badge label="Results not published" tone="warning" icon="visibility-off" />}
              </View>
              <Button label="Open candidates" icon="groups" full onPress={() => router.push(`/(officer)/drive/${driveId}/round/${r.id}` as never)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Button label="Move up" icon="arrow-upward" size="sm" variant="secondary" disabled={i === 0 || locked} onPress={() => move(i, -1)} />
                <Button label="Move down" icon="arrow-downward" size="sm" variant="secondary" disabled={i === rounds.length - 1 || locked} onPress={() => move(i, 1)} />
                <Button label="Edit" icon="edit" size="sm" variant="secondary" onPress={() => { setEditing(r); setFormOpen(true); }} />
                <Button label={r.resultsPublishedAt ? 'Publish again' : 'Publish results'} icon="campaign" size="sm" variant="secondary"
                  onPress={() => confirm('Publish results for this round?', 'Students will see passed, not passed and on hold results for this round and are notified. Publish only after you have uploaded every result.', 'Publish results', () => { void publish(r); }, false)} />
                <Button label="Delete" icon="delete-outline" size="sm" variant="danger"
                  onPress={() => confirm('Delete this round?', total(r) > 0 ? 'This round has candidates and the server will refuse to delete it.' : `"${r.name}" will be removed.`, 'Delete round', () => { void remove(r); })} />
              </View>
            </View>
          </Card>
        ))}
      </Boundary>
      <RoundForm driveId={driveId} visible={formOpen} round={editing} onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); toast.show(editing ? 'Round updated' : 'Round added', 'success'); }} />
    </Page>
  );
}
