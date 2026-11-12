import React from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, EmptyState, ErrorState, ProgressBar, Skeleton, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import { aiErrorInfo, useAiStatus, useSetAiConsent, type AiErrorKind } from '@/api/ai';
import { useFeatures } from '@/config/features';
import type { AiQuota, AiStatus } from '@/api/aiTypes';
import { errMessage } from '@/api/client';
import { useCopy } from '@/lib/copy';

export const AI_ROUTES = {
  hub: '/(student)/ai',
  chat: '/(student)/ai/chat',
  history: '/(student)/ai/history',
  consent: '/(student)/ai/consent',
  resume: '/(student)/ai/resume-review',
  mock: '/(student)/ai/mock-interview',
} as const;

export const CONSENT_TEXT =
  'Let Placement OS AI use my profile summary (department, batch, CGPA, skills), my resume text and my application/drive details to personalise answers, and let placement officers and recruiters use AI tools (draft interview questions, factual summaries) on the details I share when I apply. Contact details are never sent to the AI, AI output is only a draft reviewed by a person, and it never decides eligibility or selection. I can turn this off any time.';

/** IST wall-clock for the daily reset (00:00 UTC). */
export const RESET_LABEL = 'Resets daily at 5:30 AM IST';

export const TYPE_LABEL: Record<'hr' | 'technical' | 'behavioural' | 'coding_concepts', string> = {
  hr: 'HR', technical: 'Technical', behavioural: 'Behavioural', coding_concepts: 'Coding concepts',
};

export function useGo() {
  const router = useRouter();
  return React.useCallback((path: string) => router.push(path as never), [router]);
}

/** Copy (direct, via the clipboard) and Share buttons for an AI draft; nothing is sent automatically. */
export function CopyShareRow({ text, label = 'Draft' }: { text: string; label?: string }) {
  const copy = useCopy();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      <Button label="Copy" icon="content-copy" variant="secondary" size="sm" onPress={() => copy(text, label)} />
      <Button label="Share" icon="share" variant="ghost" size="sm" onPress={() => shareText(text)} />
    </View>
  );
}

/** Share sheet (lets the user send the text elsewhere). */
export async function shareText(message: string) {
  try { await Share.share({ message }); } catch { /* user dismissed */ }
}

export function QuotaMeter({ quota }: { quota?: AiQuota | null }) {
  if (!quota) return null;
  const used = Math.max(0, Math.min(quota.limit, quota.used));
  const left = Math.max(0, quota.remaining);
  return (
    <View style={{ gap: spacing.sm }} accessible accessibilityLabel={`${left} of ${quota.limit} AI requests left today`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text variant="caption" color={colors.muted}>AI requests today</Text>
        <Text variant="caption" tabular style={{ fontWeight: '600' }}>{`${left} left of ${quota.limit}`}</Text>
      </View>
      <ProgressBar value={quota.limit ? used / quota.limit : 0} tone={left === 0 ? 'error' : left <= 3 ? 'warning' : 'brand'} />
      <Text variant="caption" color={colors.muted}>{RESET_LABEL}</Text>
    </View>
  );
}

/**
 * Wrap an AI screen body. Resolves: feature flag off / AI not configured / AI disabled / loading / offline-error.
 * Children receive the live status (quota + consent).
 */
export function AiGate({ children }: { children: (status: AiStatus) => React.ReactNode }) {
  const { flags, status: flagsStatus } = useFeatures();
  const flagsLoading = flagsStatus === 'loading';
  const on = flags.ai === true;
  const status = useAiStatus(on);
  if (flagsLoading || (on && status.isLoading)) {
    return (
      <View style={{ gap: spacing.md }} accessibilityLabel="Loading">
        <Skeleton height={96} radius={14} />
        <Skeleton height={96} radius={14} />
      </View>
    );
  }
  if (!on) {
    return <EmptyState icon="auto-awesome" title="AI tools are not available" message="Your placement cell has not turned on the AI features. Everything else in the app works as usual." />;
  }
  if (status.isError) {
    return <ErrorState message={errMessage(status.error)} onRetry={() => void status.refetch()} />;
  }
  const s = status.data;
  if (!s) return null;
  if (!s.configured) {
    return <EmptyState icon="settings-suggest" title="AI is not set up yet" message="The AI features need to be configured by the app owner. Please check back later." />;
  }
  if (!s.enabled || !s.available) {
    return <EmptyState icon="pause-circle-outline" title="AI is turned off" message="The AI features are paused right now. Please check back later." />;
  }
  return <>{children(s)}</>;
}

/** Inline banner for a failed AI call: picks wording by error kind and links to consent when needed. */
export function AiErrorBanner({ error, onRetry, onConsent }: { error: unknown; onRetry?: () => void; onConsent?: () => void }) {
  const info = aiErrorInfo(error);
  const tone = info.kind === 'quota' || info.kind === 'rate' || info.kind === 'consent' ? 'warning' : 'error';
  const action =
    info.kind === 'consent' && onConsent ? { label: 'Open AI privacy', onPress: onConsent } : info.retryable && onRetry ? { label: 'Try again', onPress: onRetry } : undefined;
  return <Banner tone={tone} title={info.title} message={info.message} action={action} />;
}

export function isKind(e: unknown, ...k: AiErrorKind[]) {
  return k.includes(aiErrorInfo(e).kind);
}

/** The consent text plus Accept / Turn off. Used on the consent screen and as an inline gate. */
export function ConsentPanel({ granted, onChanged, compact }: { granted: boolean; onChanged?: (granted: boolean) => void; compact?: boolean }) {
  const set = useSetAiConsent();
  const [error, setError] = React.useState<string | null>(null);
  const change = async (next: boolean) => {
    setError(null);
    try {
      await set.mutateAsync({ granted: next });
      onChanged?.(next);
    } catch (e) {
      setError(errMessage(e));
    }
  };
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <Text variant="subhead">Your permission</Text>
        <Text variant="body" color={colors.textSecondary}>{CONSENT_TEXT}</Text>
        {!compact ? (
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" color={colors.muted}>{'• Without permission you can still ask general placement questions.'}</Text>
            <Text variant="caption" color={colors.muted}>{'• AI scores and tips are advisory. They are never shown to recruiters or the placement cell.'}</Text>
          </View>
        ) : null}
        {error ? <Banner tone="error" message={error} /> : null}
        {granted ? (
          <Button label="Turn off AI personalisation" variant="secondary" icon="block" full loading={set.isPending} onPress={() => change(false)} />
        ) : (
          <Button label="I agree, turn on" icon="check" full loading={set.isPending} onPress={() => change(true)} />
        )}
      </View>
    </Card>
  );
}
