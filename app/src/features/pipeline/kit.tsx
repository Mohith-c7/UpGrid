/** Shared building blocks for the hiring-pipeline screens (student + officer). Uses only design-system components. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, EmptyState, ErrorState, Sheet, Text, TextField, type IconName } from '@/ui';
import { colors, type Tone, urgentColors } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { isOfflineError, pipeError } from '@/api/pipeline';
import type { RoundCandStatus, RoundKind, StudentRoundStatus } from '@/api/pipelineTypes';
import { SkeletonList, sp, useOnce } from '@/features/student/me/kit';

export { Page, confirm, formatIST, sp, useOnce, SkeletonList, RowGroup } from '@/features/student/me/kit';

/* ------------------------------------------------------------- labels */
export const KIND_LABEL: Record<RoundKind, string> = {
  aptitude: 'Aptitude', assessment: 'Assessment', coding: 'Coding', technical: 'Technical interview', hr: 'HR interview', gd: 'Group discussion', custom: 'Other',
};
export const KIND_OPTIONS = (Object.keys(KIND_LABEL) as RoundKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));

export const CAND_LABEL: Record<RoundCandStatus, string> = {
  pending: 'Not invited yet', invited: 'Invited', attended: 'Attended', absent: 'Absent', passed: 'Passed', failed: 'Not passed', on_hold: 'On hold',
};
const CAND_TONE: Record<RoundCandStatus, Tone> = { pending: 'neutral', invited: 'info', attended: 'info', absent: 'warning', passed: 'success', failed: 'error', on_hold: 'warning' };
const CAND_ICON: Record<RoundCandStatus, IconName> = {
  pending: 'schedule', invited: 'mail-outline', attended: 'how-to-reg', absent: 'person-off', passed: 'check-circle-outline', failed: 'cancel', on_hold: 'pause-circle-outline',
};
export function CandidateStatusBadge({ status }: { status: RoundCandStatus }) {
  return <Badge label={CAND_LABEL[status] ?? status} tone={CAND_TONE[status] ?? 'neutral'} icon={CAND_ICON[status] ?? 'label-outline'} />;
}

/** Student-facing round status wording. `pending_results` = the cell has a result but has not published it. */
export const STUDENT_ROUND_LABEL: Record<StudentRoundStatus, string> = {
  pending: 'Upcoming', invited: 'You are invited', attended: 'Attended', absent: 'Marked absent', passed: 'Cleared', failed: 'Not selected',
  on_hold: 'On hold', pending_results: 'Result awaited',
};
const STUDENT_ROUND_TONE: Record<StudentRoundStatus, Tone> = {
  pending: 'neutral', invited: 'info', attended: 'info', absent: 'warning', passed: 'success', failed: 'error', on_hold: 'warning', pending_results: 'neutral',
};
const STUDENT_ROUND_ICON: Record<StudentRoundStatus, IconName> = {
  pending: 'schedule', invited: 'mail-outline', attended: 'how-to-reg', absent: 'person-off', passed: 'check-circle-outline', failed: 'block', on_hold: 'pause-circle-outline', pending_results: 'hourglass-empty',
};
export function StudentRoundBadge({ status }: { status: StudentRoundStatus }) {
  return <Badge label={STUDENT_ROUND_LABEL[status] ?? status} tone={STUDENT_ROUND_TONE[status] ?? 'neutral'} icon={STUDENT_ROUND_ICON[status] ?? 'label-outline'} />;
}

/* ----------------------------------------------------------- states */
/** Loading / error (network-aware) / empty. Children render when there is data. */
export function Boundary({
  isLoading, isError, error, onRetry, isEmpty, empty, rows = 3, height = 96, children,
}: {
  isLoading: boolean; isError: boolean; error?: unknown; onRetry: () => void; isEmpty?: boolean; rows?: number; height?: number;
  empty?: { title: string; message: string; icon?: IconName; actionLabel?: string; onAction?: () => void }; children: React.ReactNode;
}) {
  if (isLoading) return <SkeletonList rows={rows} height={height} />;
  if (isError) {
    return <ErrorState message={isOfflineError(error) ? 'You appear to be offline or the server is unreachable. Check your connection and retry.' : pipeError(error)} onRetry={onRetry} />;
  }
  if (isEmpty && empty) return <EmptyState {...empty} />;
  return <>{children}</>;
}

/** Footer for paginated lists: loads more or shows a retry when the next page failed. */
export function LoadMore({ hasMore, loading, failed, onMore }: { hasMore: boolean; loading: boolean; failed: boolean; onMore: () => void }) {
  if (failed) return <Banner tone="warning" message="Could not load more." action={{ label: 'Retry', onPress: onMore }} />;
  if (!hasMore) return null;
  return <Button label="Load more" variant="secondary" full loading={loading} onPress={onMore} />;
}

/* ---------------------------------------------------- reason sheet */
/** Bottom sheet that asks for a short reason (decline, reject, revoke, cancel). Errors stay inside the sheet. */
export function ReasonSheet({
  visible, onClose, title, description, label = 'Reason', minLength = 3, maxLength = 300, required = true, confirmLabel, danger = true, onSubmit,
}: {
  visible: boolean; onClose: () => void; title: string; description?: string; label?: string; minLength?: number; maxLength?: number; required?: boolean;
  confirmLabel: string; danger?: boolean; onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setReason(''); setError(null); } }, [visible]);
  const [run, busy] = useOnce(async () => {
    const r = reason.trim();
    if ((required || r.length > 0) && r.length < minLength) { setError(`Enter at least ${minLength} characters.`); return; }
    setError(null);
    try { await onSubmit(r); } catch (e) { setError(pipeError(e)); }
  });
  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }} title={title}>
      <View style={{ gap: sp.md, paddingBottom: sp.sm }}>
        {description ? <Text variant="body" color={colors.textSecondary}>{description}</Text> : null}
        <TextField label={required ? label : `${label} (optional)`} value={reason} onChangeText={(t) => { setReason(t); setError(null); }} multiline maxLength={maxLength} />
        {error ? <Banner tone="error" message={error} /> : null}
        <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} full loading={busy} onPress={() => run()} />
        <Button label="Go back" variant="ghost" full disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------ expiry countdown */
function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} left`;
}
/** Remaining time to `iso` by SERVER time (device clock + server offset). */
export function useRemainingMs(iso?: string | null, offsetMs?: number): number | null {
  const target = iso ? Date.parse(iso) : NaN;
  const calc = () => (Number.isNaN(target) ? null : target - (Date.now() + (offsetMs ?? getServerOffsetMs())));
  const [rem, setRem] = useState<number | null>(calc);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const r = calc();
      setRem(r);
      if (r !== null && r > 0) t = setTimeout(tick, r < 3600_000 ? 1000 : 30_000);
    };
    tick();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, offsetMs]);
  return rem;
}
export function ExpiryText({ iso, offsetMs }: { iso?: string | null; offsetMs?: number }) {
  const rem = useRemainingMs(iso, offsetMs);
  if (rem === null) return null;
  const expired = rem <= 0;
  const urgent = !expired && rem < 24 * 3600_000;
  return (
    <Text variant="subhead" tabular color={expired ? colors.muted : urgent ? urgentColors.fg : colors.ink}>
      {expired ? 'Expired' : fmtLeft(rem)}
    </Text>
  );
}
