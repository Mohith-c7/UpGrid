import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, CodeBlock, EmptyState, ErrorState, Icon, SegmentedTabs, Sheet, Text, TextField, useToast } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { errMessage } from '@/api/client';
import { flatten } from '@/api/hooks';
import { useAttendanceToken, useMarkAttendance, useRecruiterDrive, useRoundCandidates, useRoundStatus } from '@/api/recruiter';
import type { RoundCandidate, RoundCandidateStatus } from '@/api/recruiterTypes';
import { formatDateTimeIST } from '@/lib/format';
import { can, Page, ROUND_STATUS_META, SkeletonList, useBack } from '@/features/recruiter/kit';

const TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' }, { value: 'invited', label: 'Invited' }, { value: 'attended', label: 'Present' }, { value: 'absent', label: 'Absent' },
  { value: 'passed', label: 'Passed' }, { value: 'failed', label: 'Failed' }, { value: 'on_hold', label: 'On hold' },
];
const ACTIONS: { status: RoundCandidateStatus; label: string; kind: 'attendance' | 'result' }[] = [
  { status: 'attended', label: 'Present', kind: 'attendance' },
  { status: 'absent', label: 'Absent', kind: 'attendance' },
  { status: 'passed', label: 'Passed', kind: 'result' },
  { status: 'failed', label: 'Failed', kind: 'result' },
  { status: 'on_hold', label: 'On hold', kind: 'result' },
];

export default function RoundScreen() {
  const { id, roundId } = useLocalSearchParams<{ id: string; roundId: string }>();
  const back = useBack(`/(recruiter)/drive/${id}/rounds`);
  const toast = useToast();
  const drive = useRecruiterDrive(id);
  const perms = drive.data?.permissions;
  const round = drive.data?.rounds.find((r) => r.id === roundId);
  const blind = drive.data?.settings.blindScorecards ?? true; // blind: no averages of scores this recruiter cannot see yet
  const [tab, setTab] = useState('');
  const q = useRoundCandidates(id, roundId, tab || undefined);
  const items = useMemo(() => flatten(q.data), [q.data]);
  const counts = q.data?.pages[0]?.counts;

  const attendance = useMarkAttendance(id, roundId);
  const status = useRoundStatus(id, roundId);
  const tokenM = useAttendanceToken(id, roundId);
  const canAttend = can(perms, 'markAttendance');
  const canResult = can(perms, 'uploadResults');

  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<RoundCandidate | null>(null);
  const [remark, setRemark] = useState('');
  const [sheetErr, setSheetErr] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);

  const toggle = (appId: string) => setPicked((p) => { const n = new Set(p); if (n.has(appId)) n.delete(appId); else n.add(appId); return n; });

  const bulkMark = async (present: boolean) => {
    try {
      const r = await attendance.mutateAsync([...picked].map((applicationId) => ({ applicationId, present })));
      toast.show(`${r.updated ?? 0} updated${r.failed?.length ? `, ${r.failed.length} failed: ${r.failed[0].reason}` : ''}`, r.failed?.length ? 'info' : 'success');
      setPicked(new Set()); setSelecting(false);
    } catch (e) { toast.show(errMessage(e), 'error'); }
  };

  const applyOne = async (s: RoundCandidateStatus) => {
    if (!target) return;
    setSheetErr(null);
    try {
      const r = await status.mutateAsync([{ applicationId: target.applicationId, status: s, remark: remark.trim() || undefined }]);
      if (r.failed?.length) { setSheetErr(r.failed[0].reason); return; }
      toast.show(`${target.name} marked ${ROUND_STATUS_META[s]?.label.toLowerCase() ?? s}`, 'success');
      setTarget(null); setRemark('');
    } catch (e) { setSheetErr(errMessage(e)); }
  };

  const mintToken = async () => {
    try { await tokenM.mutateAsync({ validMinutes: 60 }); } catch { /* shown from tokenM.error */ }
  };
  // Making a new code cancels the one students are already using, so reopening the sheet shows the live code instead of replacing it.
  const makeToken = async () => {
    setTokenOpen(true);
    const live = tokenM.data && Date.parse(tokenM.data.validUntil) > Date.now() + 60_000;
    if (!live && !tokenM.isPending) await mintToken();
  };

  const tabs = TABS.map((t) => ({ ...t, count: t.value ? counts?.[t.value] : undefined }));

  return (
    <Page title={round?.name ?? 'Round'} subtitle={round?.scheduledAt ? formatDateTimeIST(round.scheduledAt) : 'Attendance and results'} onBack={back} scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <SegmentedTabs value={tab} onChange={setTab} options={tabs} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 }}>
          {canAttend ? <Button size="sm" variant="secondary" icon={selecting ? 'close' : 'checklist'} label={selecting ? 'Cancel selection' : 'Select'} onPress={() => { setSelecting(!selecting); setPicked(new Set()); }} /> : null}
          {canAttend ? <Button size="sm" variant="secondary" icon="qr-code" label="Attendance code" onPress={makeToken} /> : null}
        </View>
      </View>
      {q.isLoading ? <View style={{ padding: 16 }}><SkeletonList rows={4} height={84} /></View> : q.isError && !items.length ? <View style={{ padding: 16 }}><ErrorState message={errMessage(q.error)} onRetry={() => void q.refetch()} /></View> : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.applicationId}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No candidates here" message={tab ? 'No candidates have this status in the round.' : 'Candidates appear after the placement cell adds them to this round.'} actionLabel="Refresh" onAction={() => void q.refetch()} />}
          renderItem={({ item }) => {
            const m = ROUND_STATUS_META[item.status] ?? { label: item.status, tone: 'neutral' as const };
            const sel = picked.has(item.applicationId);
            return (
              <Card padding={0} style={sel ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
                <Pressable
                  onPress={() => (selecting ? toggle(item.applicationId) : (canAttend || canResult) ? (setSheetErr(null), setRemark(item.remark ?? ''), setTarget(item)) : undefined)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${m.label}`}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 14, minHeight: MIN_TOUCH, borderRadius: 14, backgroundColor: pressed ? colors.pressed : 'transparent' })}
                >
                  {selecting ? <Icon name={sel ? 'check-box' : 'check-box-outline-blank'} size={24} color={sel ? colors.primary : colors.muted} /> : null}
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text variant="subhead">{item.name}</Text>
                    <Text variant="caption" color={colors.muted} tabular>{[item.reference, item.department, !blind && item.avgScore != null ? `Score ${item.avgScore.toFixed(2)}` : null].filter(Boolean).join('  |  ')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <Badge label={m.label} tone={m.tone} />
                      {item.waitlisted ? <Badge label={`Waitlisted${item.waitlistRank ? ` #${item.waitlistRank}` : ''}`} tone="warning" /> : null}
                    </View>
                    {item.remark ? <Text variant="caption" color={colors.muted}>{item.remark}</Text> : null}
                  </View>
                  {!selecting && (canAttend || canResult) ? <Icon name="chevron-right" size={24} color={colors.subtle} /> : null}
                </Pressable>
              </Card>
            );
          }}
        />
      )}
      {selecting ? (
        <View style={{ padding: 12, gap: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text variant="caption" color={colors.muted} tabular>{picked.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button label="Present" icon="check" full disabled={!picked.size} loading={attendance.isPending} onPress={() => bulkMark(true)} /></View>
            <View style={{ flex: 1 }}><Button label="Absent" icon="close" variant="secondary" full disabled={!picked.size || attendance.isPending} onPress={() => bulkMark(false)} /></View>
          </View>
        </View>
      ) : null}

      <Sheet visible={!!target} onClose={() => { if (!status.isPending) setTarget(null); }} title={target?.name ?? ''}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text variant="caption" color={colors.muted}>Current status: {target ? (ROUND_STATUS_META[target.status]?.label ?? target.status) : ''}</Text>
          <TextField label="Remark (optional)" value={remark} onChangeText={setRemark} maxLength={300} multiline />
          {sheetErr ? <Banner tone="error" message={sheetErr} /> : null}
          {ACTIONS.filter((a) => (a.kind === 'attendance' ? canAttend : canResult)).map((a) => (
            <Button key={a.status} label={`Mark ${a.label.toLowerCase()}`} variant={target?.status === a.status ? 'secondary' : a.status === 'failed' ? 'danger' : 'secondary'} full disabled={status.isPending} onPress={() => applyOne(a.status)} />
          ))}
          <Button label="Close" variant="ghost" full onPress={() => setTarget(null)} />
        </View>
      </Sheet>

      <Sheet visible={tokenOpen} onClose={() => setTokenOpen(false)} title="Attendance code">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          {tokenM.isPending ? <Text variant="body">Creating code</Text> : null}
          {tokenM.isError ? <Banner tone="error" message={errMessage(tokenM.error)} action={{ label: 'Try again', onPress: () => void mintToken() }} /> : null}
          {tokenM.data ? (
            <>
              <Text variant="body">Students scan or enter this code in the app. It is shown once. Making a new code cancels this one.</Text>
              <CodeBlock label="Attendance code" code={tokenM.data.qrPayload} />
              <Text variant="caption" color={colors.muted} tabular>Valid until {formatDateTimeIST(tokenM.data.validUntil)}</Text>
              <Button label="Make a new code" variant="ghost" full loading={tokenM.isPending} onPress={() => Alert.alert('Make a new code?', 'The current code stops working at once. Students who have not marked attendance yet need the new code.', [{ text: 'Keep current code', style: 'cancel' }, { text: 'Make new code', style: 'destructive', onPress: () => void mintToken() }])} />
            </>
          ) : null}
          <Button label="Done" full onPress={() => setTokenOpen(false)} />
        </View>
      </Sheet>
    </Page>
  );
}
