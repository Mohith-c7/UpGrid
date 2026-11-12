import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Banner, Card, Chip, EmptyState, ErrorState, Icon, Skeleton, Text } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { errMessage } from '@/api/client';
import { usePlagiarism } from '@/api/assessments';
import { Frame, ROOT } from '@/features/assessments/kit';

const LEVELS = [{ v: 0.7, label: '70% or more' }, { v: 0.85, label: '85% or more' }, { v: 0.95, label: '95% or more' }];

export default function PlagiarismScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useRouter();
  const [th, setTh] = useState(0.85);
  const q = usePlagiarism(id, th);
  const open = (attemptId: string) => r.push(`${ROOT}/${id}/attempt/${attemptId}` as any);
  return (
    <Frame title="Plagiarism report" subtitle="Coding answers" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
      <Banner tone="info" message="Code is compared after comments, whitespace, names and literals are normalised. A match is a lead to review, not proof of copying." />
      <View style={{ gap: 8 }}>
        <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>Similarity threshold</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LEVELS.map((l) => <Chip key={l.v} label={l.label} selected={th === l.v} onPress={() => setTh(l.v)} />)}
        </View>
      </View>
      {q.isLoading ? <><Skeleton height={130} radius={14} /><Skeleton height={130} radius={14} /></>
        : q.isError || !q.data ? <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} />
        : q.data.pairs.length === 0 ? <EmptyState icon="verified-user" title="No similar submissions" message="No pair of coding submissions reached this threshold. Lower it to see weaker matches." />
        : (
          <>
            <Text variant="caption" color={colors.muted} tabular>{q.data.pairs.length} pair{q.data.pairs.length === 1 ? '' : 's'} found</Text>
            {q.data.pairs.map((p, i) => (
              <Card key={`${p.a.attemptId}-${p.b.attemptId}-${p.questionId}-${i}`} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Badge label={`${Math.round(p.similarity * 100)}% similar`} tone={p.identical || p.similarity >= 0.95 ? 'error' : 'warning'} icon="policy" />
                  {p.identical ? <Badge label="Identical after normalising" tone="error" /> : null}
                </View>
                <Text variant="caption" color={colors.muted} numberOfLines={2}>{p.title}</Text>
                {[p.a, p.b].map((s) => (
                  <Pressable key={s.attemptId} onPress={() => open(s.attemptId)} accessibilityRole="button" accessibilityLabel={`Open ${s.name}'s answer sheet`}
                    style={({ pressed }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: pressed ? colors.pressed : 'transparent', borderRadius: 12 })}>
                    <Icon name="person-outline" size={22} color={colors.muted} />
                    <Text variant="body" style={{ flex: 1, fontWeight: '500' }} numberOfLines={2}>{s.name}</Text>
                    <Icon name="chevron-right" size={24} color={colors.subtle} />
                  </Pressable>
                ))}
              </Card>
            ))}
          </>
        )}
    </Frame>
  );
}
