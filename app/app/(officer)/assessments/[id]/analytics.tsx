import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Card, EmptyState, ErrorState, KeyValueList, SectionHeader, Skeleton, StatTile, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useAnalytics } from '@/api/assessments';
import { DifficultyBadge, FlatBar, Frame, TYPE_LABEL, fmtDuration, fmtNum } from '@/features/assessments/kit';

function hardness(idx: number | null, attempted: number): { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' } {
  if (idx === null || attempted === 0) return { label: 'No data', tone: 'neutral' };
  if (idx >= 0.85) return { label: 'Very easy', tone: 'warning' };
  if (idx >= 0.6) return { label: 'Easy', tone: 'success' };
  if (idx >= 0.3) return { label: 'Moderate', tone: 'success' };
  if (idx >= 0.1) return { label: 'Hard', tone: 'warning' };
  return { label: 'Very hard', tone: 'error' };
}

export default function AnalyticsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAnalytics(id);
  const d = q.data;
  const maxBucket = d ? Math.max(1, ...d.distribution.buckets.map((b) => b.count)) : 1;
  return (
    <Frame title="Analytics" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
      {q.isLoading ? <><Skeleton height={100} radius={14} /><Skeleton height={260} radius={14} /><Skeleton height={200} radius={14} /></>
        : q.isError || !d ? <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} />
        : d.summary.participants === 0 ? <EmptyState icon="insights" title="No submissions yet" message="Analytics appear once students submit." />
        : (
          <>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <StatTile label="Submitted" value={d.summary.participants} icon="assignment-turned-in" />
              <StatTile label="Pass rate" value={d.summary.passRate == null ? '-' : `${fmtNum(d.summary.passRate, 0)}%`} icon="check-circle-outline" />
            </View>
            <Card padding={0} style={{ paddingHorizontal: 16 }}>
              <KeyValueList items={[
                { label: 'Average score', value: fmtNum(d.summary.avg) },
                { label: 'Median', value: fmtNum(d.summary.median) },
                { label: 'Highest', value: fmtNum(d.summary.max) },
                { label: 'Lowest', value: fmtNum(d.summary.min) },
                { label: 'Spread (std dev, percent)', value: fmtNum(d.distribution.stdDev, 1) },
              ]} />
            </Card>
            {d.summary.pendingEvaluation > 0 ? <Banner tone="warning" message={`${d.summary.pendingEvaluation} attempts are still being evaluated and are not in these numbers yet.`} /> : null}

            <SectionHeader title="Score distribution" subtitle="Students per score band (percent of total marks)" />
            <Card style={{ gap: 10 }}>
              {d.distribution.buckets.map((b) => (
                <FlatBar key={b.fromPercent} label={`${b.fromPercent} to ${b.toPercent}%`} value={b.count} max={maxBucket} text={`${b.count} student${b.count === 1 ? '' : 's'}`} />
              ))}
            </Card>

            {d.sections.length > 1 ? (
              <>
                <SectionHeader title="Sections" subtitle="Average score against section maximum" />
                <Card style={{ gap: 10 }}>
                  {d.sections.map((s) => <FlatBar key={s.id} label={s.title} value={s.avgScore ?? 0} max={s.maxScore} text={`${fmtNum(s.avgScore, 1)} / ${fmtNum(s.maxScore)}`} />)}
                </Card>
              </>
            ) : null}

            <SectionHeader title="Questions" subtitle="Difficulty index is the share of attempters who got it fully right" />
            {d.questions.map((x) => {
              const h = hardness(x.difficultyIndex, x.attempted);
              return (
                <Card key={x.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <Text variant="overline" color={colors.muted}>Question {x.number}</Text>
                    <Badge label={TYPE_LABEL[x.type]} tone="info" />
                    <DifficultyBadge d={x.difficulty} />
                    <Badge label={`Observed: ${h.label}`} tone={h.tone} />
                  </View>
                  <Text variant="body" numberOfLines={3} style={{ fontWeight: '500' }}>{x.title}</Text>
                  <FlatBar label="Answered fully correct" value={x.correctPercent} max={100} text={`${fmtNum(x.correctPercent, 0)}%`} tone={x.correctPercent < 30 ? 'error' : x.correctPercent > 85 ? 'warning' : 'brand'} />
                  <FlatBar label="Attempted" value={x.attemptRate} max={100} text={`${fmtNum(x.attemptRate, 0)}%`} />
                  <Text variant="caption" color={colors.muted} tabular>
                    {`${x.correctCount} correct, ${x.partialCount} partial, ${x.attempted} attempted · difficulty index ${fmtNum(x.difficultyIndex, 2)} · avg time ${x.avgTimeSeconds ? fmtDuration(x.avgTimeSeconds) : '-'}`}
                  </Text>
                </Card>
              );
            })}
            <Text variant="caption" color={colors.muted}>Average time is reported by students' devices.</Text>
          </>
        )}
    </Frame>
  );
}
