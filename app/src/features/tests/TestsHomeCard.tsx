import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Icon, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import { flatten } from '@/api/hooks';
import { useMyAssessments, useTestsEnabled } from '@/api/tests';
import { effectiveBucket } from './Gate';

/** "Tests and practice" entry for the student Home. Renders nothing unless `features.assessments` is on. */
export function TestsHomeCard() {
  const on = useTestsEnabled();
  if (!on) return null;
  return <Inner />;
}

function Inner() {
  const router = useRouter();
  const q = useMyAssessments('all');
  const now = Date.now();
  const { live, upcoming, active } = useMemo(() => {
    const all = flatten(q.data);
    const buckets = all.map((t) => ({ t, b: effectiveBucket(t, now) }));
    return {
      live: buckets.filter((x) => x.b === 'live').length,
      upcoming: buckets.filter((x) => x.b === 'upcoming').length,
      active: all.find((t) => t.activeAttempt && Date.parse(t.activeAttempt.deadlineAt) > now) ?? null,
    };
  }, [q.data, now]);

  let line = 'Take placement tests and practice coding.';
  if (q.isLoading) line = 'Checking your tests...';
  else if (q.isError && !q.data) line = 'Could not load your tests. Tap to try again.';
  else if (active) line = `In progress: ${active.title}`;
  else if (live > 0) line = `${live} ${live === 1 ? 'test is' : 'tests are'} live now.`;
  else if (upcoming > 0) line = `${upcoming} upcoming ${upcoming === 1 ? 'test' : 'tests'}.`;
  else line = 'No tests right now. Practice coding problems in the meantime.';

  return (
    <Card onPress={() => router.push('/(student)/tests' as never)} accessibilityLabel={`Tests and practice. ${line}`}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name="assignment" size={24} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="subhead">Tests and practice</Text>
            <Text variant="caption" color={colors.muted}>{line}</Text>
          </View>
          <Icon name="chevron-right" size={24} color={colors.subtle} />
        </View>
        {active?.activeAttempt ? (
          <Button label="Resume test" icon="play-arrow" size="sm" onPress={() => router.push(`/(student)/tests/attempt/${active.activeAttempt!.id}` as never)} />
        ) : null}
      </View>
    </Card>
  );
}
