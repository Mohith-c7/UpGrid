import React from 'react';
import { View } from 'react-native';
import { Badge, Banner, Button, Card, Chip, Skeleton, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import { useCandidateSummary } from '@/api/ai';
import type { CandidateSummaryResult } from '@/api/aiTypes';
import { AiErrorBanner } from './kit';

export interface CandidateSummaryCardProps {
  /** Application to summarise (apply-time snapshot only; no name, email or phone reaches the AI). */
  applicationId: string;
  /** Optional pasted resume text. */
  resumeText?: string;
  /** Generate on mount instead of waiting for a tap (costs one AI request). Default false. */
  autoLoad?: boolean;
  /** Called with the summary once generated. */
  onLoaded?: (r: CandidateSummaryResult) => void;
}

/** Factual, cited summary of a candidate versus the JD. Always a draft; never a hire or no-hire recommendation. */
export function CandidateSummaryCard({ applicationId, resumeText, autoLoad, onLoaded }: CandidateSummaryCardProps) {
  const m = useCandidateSummary();
  const [data, setData] = React.useState<CandidateSummaryResult | null>(null);
  const started = React.useRef(false);

  const run = React.useCallback(async () => {
    try {
      const r = await m.mutateAsync({ applicationId, resumeText: resumeText || undefined });
      setData(r);
      onLoaded?.(r);
    } catch { /* rendered via m.error */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, resumeText]);

  React.useEffect(() => {
    if (autoLoad && !started.current) { started.current = true; void run(); }
  }, [autoLoad, run]);

  React.useEffect(() => { setData(null); started.current = false; }, [applicationId]);

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
          <Text variant="subhead" style={{ flexShrink: 1 }}>AI candidate summary</Text>
          <Badge label="Draft" tone="warning" />
        </View>

        {m.isPending && !data ? (
          <View style={{ gap: spacing.sm }} accessibilityLabel="Generating summary">
            <Skeleton height={16} /><Skeleton height={16} width="85%" /><Skeleton height={16} width="70%" />
          </View>
        ) : null}

        {m.isError ? <AiErrorBanner error={m.error} onRetry={run} /> : null}

        {!data && !m.isPending && !m.isError ? (
          <Text variant="body" color={colors.textSecondary}>A short factual summary of what the application shows against the job description, with quotes. It does not recommend hiring or rejecting.</Text>
        ) : null}

        {data ? (
          <View style={{ gap: spacing.lg }}>
            <Text variant="body" selectable>{data.summary.factual_summary}</Text>

            {(data.summary.skills_vs_jd?.matched ?? []).length ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color={colors.muted}>Skills matched to the JD</Text>
                {(data.summary.skills_vs_jd?.matched ?? []).map((s, i) => (
                  <View key={i} style={{ gap: 2 }}>
                    <Chip label={s.skill} tone="success" icon="check" />
                    {s.citation ? <Text variant="caption" color={colors.textSecondary} style={{ fontStyle: 'italic' }}>{`"${s.citation}"`}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {(data.summary.skills_vs_jd?.not_evidenced ?? []).length ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color={colors.muted}>Not evidenced in the application</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {(data.summary.skills_vs_jd?.not_evidenced ?? []).map((s) => <Chip key={s} label={s} tone="warning" />)}
                </View>
              </View>
            ) : null}

            {(data.summary.citations ?? []).length ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color={colors.muted}>Citations</Text>
                {(data.summary.citations ?? []).map((c, i) => (
                  <View key={i} style={{ gap: spacing.xs }}>
                    <Text variant="body" style={{ fontStyle: 'italic' }}>{`"${c.quote}"`}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      <Badge label={c.source} tone="neutral" icon={false} />
                      {c.verified ? <Badge label="Verified in source" tone="success" /> : <Badge label="Not verified" tone="warning" />}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {(data.summary.notes ?? []).length ? <Banner tone="info" message={(data.summary.notes ?? []).join(' ')} /> : null}
            <Text variant="caption" color={colors.muted}>{data.disclaimer}</Text>
          </View>
        ) : null}

        {!m.isPending ? (
          <Button label={data ? 'Regenerate summary' : 'Generate summary'} icon={data ? 'refresh' : 'auto-awesome'} variant={data ? 'secondary' : 'primary'} size="sm" onPress={run} />
        ) : null}
      </View>
    </Card>
  );
}
