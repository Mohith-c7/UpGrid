import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Card, ListRow, SectionHeader, Text, type IconName } from '@/ui';
import { colors } from '@/theme';
import { Page, RowGroup, sp, type RowDef } from '@/features/student/me/kit';
import { useFeatures } from '@/config/features';
import { useUpcomingTestEntries } from '@/api/studentExtras';
import { formatDateTimeIST } from '@/lib/format';

/**
 * Prep hub: one place that links to practice, AI tools and tests. Destinations are other modules' screens, so we only router.push
 * string paths (never import their files) and show an entry only when its server feature flag is on.
 */
export default function PrepHubScreen() {
  const router = useRouter();
  const { flags } = useFeatures();
  const go = (p: string) => () => router.push(p as never);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/prepare' as never)), [router]);
  const testsOn = flags.assessments === true;
  const upcoming = useUpcomingTestEntries(testsOn);

  const practice: RowDef[] = [];
  if (testsOn) {
    practice.push({
      icon: 'code' as IconName, title: 'Practice problems',
      subtitle: flags.codeExecution ? 'Coding and aptitude practice with instant feedback' : 'Practice sets (coding runs are switched off on this server)',
      onPress: go('/(student)/tests/practice'),
    });
  }
  const ai: RowDef[] = [];
  if (flags.ai) {
    ai.push({ icon: 'record-voice-over' as IconName, title: 'AI mock interview', subtitle: 'Practise questions and get feedback. Drafts only, never graded', onPress: go('/(student)/ai/mock-interview') });
    ai.push({ icon: 'description' as IconName, title: 'Resume review', subtitle: 'Suggestions to improve wording and structure', onPress: go('/(student)/ai/resume-review') });
  }
  const build: RowDef[] = [{ icon: 'edit-note' as IconName, title: 'Resume builder', subtitle: 'Make a clean ATS-friendly PDF from your profile', onPress: go('/(student)/resume-builder') }];
  const tests = upcoming.data ?? [];

  return (
    <Page title="Prep hub" onBack={back} gap={sp.xl}>
      <Banner tone="info" message="Practice before your drives. Nothing here affects your eligibility or applications." />

      <View style={{ gap: sp.md }}>
        <SectionHeader title="Build" />
        <RowGroup rows={build} />
      </View>

      {practice.length > 0 ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Practice" />
          <RowGroup rows={practice} />
        </View>
      ) : null}

      {ai.length > 0 ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="AI helpers" />
          <RowGroup rows={ai} />
        </View>
      ) : null}

      {testsOn ? (
        <View style={{ gap: sp.md }}>
          <SectionHeader title="Upcoming tests" action={{ label: 'All tests', onPress: go('/(student)/tests') }} />
          {upcoming.isLoading ? (
            <Card><Text variant="body" color={colors.muted}>Loading your tests...</Text></Card>
          ) : upcoming.isError ? (
            <Banner tone="warning" message="Could not load your tests." action={{ label: 'Retry', onPress: () => void upcoming.refetch() }} />
          ) : tests.length === 0 ? (
            <Card><Text variant="body" color={colors.muted}>No tests are scheduled for you right now.</Text></Card>
          ) : (
            <Card padding={0}>
              {tests.map((t, i) => (
                <View key={t.id} style={{ paddingHorizontal: 16 }}>
                  <ListRow
                    title={t.title}
                    subtitle={[t.drive?.company, t.opensAt ? `Opens ${formatDateTimeIST(t.opensAt)}` : null, t.durationMinutes ? `${t.durationMinutes} min` : null].filter(Boolean).join(' · ')}
                    icon="quiz" onPress={go('/(student)/tests')} last={i === tests.length - 1}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      ) : null}

      {!testsOn && ai.length === 0 ? (
        <Text variant="caption" color={colors.muted}>Practice, tests and AI helpers appear here once your placement cell turns them on.</Text>
      ) : null}
    </Page>
  );
}
