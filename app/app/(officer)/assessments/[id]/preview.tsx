import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge, Banner, Button, Card, CodeBlock, ErrorState, SectionHeader, Skeleton, Text } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { useAssessmentPreview } from '@/api/assessments';
import { Frame, TYPE_LABEL, fmtNum } from '@/features/assessments/kit';

/** GET /assessments/:id/preview: the student view without answers or hidden tests. */
export default function PreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [seed, setSeed] = useState(1);
  const q = useAssessmentPreview(id, seed);
  const d = q.data;
  return (
    <Frame title="Student preview" subtitle="No attempt is created" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}
      footer={d?.settings?.randomiseQuestions || d?.settings?.randomiseOptions ? <Button label="Try another shuffle" icon="shuffle" variant="secondary" full onPress={() => setSeed(Math.floor(Math.random() * 100000) + 2)} /> : undefined}>
      {q.isLoading ? <><Skeleton height={80} radius={14} /><Skeleton height={180} radius={14} /><Skeleton height={180} radius={14} /></>
        : q.isError || !d ? <ErrorState message={errMessage(q.error)} onRetry={() => { void q.refetch(); }} />
        : (
          <>
            <Banner tone="info" message={`${d.questions.length} questions, ${d.durationMinutes} minutes. Answers, explanations and hidden tests are not shown here, exactly as students see it.`} />
            {d.sections.map((s) => {
              const qs = d.questions.filter((x) => x.sectionId === s.id);
              return (
                <View key={s.id} style={{ gap: 12 }}>
                  <SectionHeader title={s.title} subtitle={[`${qs.length} questions`, s.timeLimitMinutes ? `${s.timeLimitMinutes} min limit` : null].filter(Boolean).join(' · ')} />
                  {qs.length === 0 ? <Text variant="caption" color={colors.muted}>No questions are shown for this section.</Text> : null}
                  {qs.map((x) => (
                    <Card key={x.id} style={{ gap: 10 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Text variant="overline" color={colors.muted}>Question {x.number}</Text>
                        <Badge label={TYPE_LABEL[x.type]} tone="info" />
                        <Badge label={`${fmtNum(x.marks)} marks${x.negativeMarks ? `, -${fmtNum(x.negativeMarks)}` : ''}`} tone="neutral" />
                      </View>
                      <Text variant="subhead">{x.title}</Text>
                      {x.body && x.body !== x.title ? <Text variant="body">{x.body}</Text> : null}
                      {x.options?.map((o, i) => (
                        <View key={o.id} style={{ flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, minHeight: 48, alignItems: 'center' }}>
                          <Text variant="body" style={{ fontWeight: '700', width: 22 }}>{String.fromCharCode(65 + i)}</Text>
                          <Text variant="body" style={{ flex: 1 }}>{o.text}</Text>
                        </View>
                      ))}
                      {x.coding ? (
                        <View style={{ gap: 8 }}>
                          {x.coding.constraints ? <Text variant="caption" color={colors.muted}>{x.coding.constraints}</Text> : null}
                          <Text variant="caption" color={colors.muted} tabular>{`Languages: ${x.coding.languages.join(', ')} · ${x.coding.timeLimitMs} ms · ${x.coding.memoryLimitMb} MB · ${x.coding.hiddenCount} hidden tests`}</Text>
                          {x.coding.samples.map((sm, i) => (
                            <View key={sm.id ?? i} style={{ gap: 6 }}>
                              <CodeBlock label={`Sample ${i + 1} input`} code={sm.input || '(empty)'} />
                              <CodeBlock label={`Sample ${i + 1} output`} code={sm.expectedOutput} />
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  ))}
                </View>
              );
            })}
          </>
        )}
    </Frame>
  );
}
