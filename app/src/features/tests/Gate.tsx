import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { EmptyState, ErrorState, Skeleton } from '@/ui';
import { useServerOffset } from '@/api/hooks';
import { useTestsFeatures } from '@/api/tests';
import type { Bucket, MyAssessmentItem } from '@/api/testsTypes';
import { sp } from './kit';
import { SCREEN_PADDING } from '@/theme';

const Pad = ({ children }: { children: React.ReactNode }) => <View style={{ padding: SCREEN_PADDING, gap: sp.md }}>{children}</View>;

/** Renders children only when the server has `features.assessments` on. */
export function TestsGate({ children, needCode }: { children: React.ReactNode; needCode?: boolean }) {
  const f = useTestsFeatures();
  if (f.loading) {
    return (
      <Pad>
        <Skeleton height={72} />
        <Skeleton height={72} />
      </Pad>
    );
  }
  if (f.failed) return <Pad><ErrorState title="Could not check availability" message="Check your connection and try again." onRetry={f.retry} /></Pad>;
  if (!f.assessments) {
    return <Pad><EmptyState icon="assignment-late" title="Tests are not available" message="Online tests have not been switched on for your placement cell yet." /></Pad>;
  }
  if (needCode && !f.codeExecution) {
    return <Pad><EmptyState icon="code-off" title="Coding practice is off" message="Running code is not set up right now, so coding problems are unavailable. Please check back later." /></Pad>;
  }
  return <>{children}</>;
}

/** Server-corrected "now" in ms, refreshed every `everyMs`. */
export function useServerNow(everyMs = 1000): number {
  const offset = useServerOffset();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return useMemo(() => Date.now() + offset, [tick, offset]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Bucket recomputed against server time so a test moves to Live the moment its window opens. */
export function effectiveBucket(t: Pick<MyAssessmentItem, 'bucket' | 'opensAt' | 'closesAt' | 'activeAttempt' | 'attemptsUsed' | 'attemptsAllowed'>, nowMs: number): Bucket {
  if (t.activeAttempt && Date.parse(t.activeAttempt.deadlineAt) > nowMs) return 'live';
  if (t.opensAt && nowMs < Date.parse(t.opensAt)) return 'upcoming';
  if (t.closesAt && nowMs >= Date.parse(t.closesAt)) return 'past';
  if (t.bucket === 'upcoming') return t.attemptsUsed >= t.attemptsAllowed ? 'past' : 'live';
  return t.bucket;
}
