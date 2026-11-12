import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Card, ListRow, SectionHeader, Text } from '@/ui';
import { colors } from '@/theme';
import { Page, sp } from '@/features/student/me/kit';
import { AiGate, AI_ROUTES, QuotaMeter } from '@/features/ai/kit';

export default function AiHub() {
  const router = useRouter();
  const go = (p: string) => () => router.push(p as never);
  return (
    <Page title="AI tools" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)' as never))}>
      <AiGate>
        {(status) => (
          <View style={{ gap: sp.xl }}>
            <Card tinted>
              <View style={{ gap: sp.md }}>
                <Text variant="body" color={colors.textSecondary}>
                  Practice and prepare with AI. Answers are suggestions only. AI never decides eligibility or selection.
                </Text>
                <QuotaMeter quota={status.quota} />
              </View>
            </Card>

            {!status.consent.granted ? (
              <Banner
                tone="info"
                title="Personalisation is off"
                message="The assistant answers general placement questions. Turn on personalisation to use your profile and resume."
                action={{ label: 'Review and turn on', onPress: go(AI_ROUTES.consent) }}
              />
            ) : null}

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Tools" />
              <Card padding={0}>
                <View style={{ paddingHorizontal: sp.lg }}>
                  <ListRow icon="chat-bubble-outline" title="AI assistant" subtitle="Ask about drives, eligibility, your week" onPress={go(AI_ROUTES.chat)} />
                  <ListRow icon="description" title="Resume review" subtitle="Scored suggestions with before and after" onPress={go(AI_ROUTES.resume)} />
                  <ListRow icon="record-voice-over" title="Mock interview" subtitle="Practise by role, get feedback" onPress={go(AI_ROUTES.mock)} last />
                </View>
              </Card>
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="History and privacy" />
              <Card padding={0}>
                <View style={{ paddingHorizontal: sp.lg }}>
                  <ListRow icon="history" title="Past conversations" subtitle="Reopen or delete" onPress={go(AI_ROUTES.history)} />
                  <ListRow icon="privacy-tip" title="AI privacy" subtitle={status.consent.granted ? 'Personalisation is on' : 'Personalisation is off'} onPress={go(AI_ROUTES.consent)} last />
                </View>
              </Card>
            </View>
          </View>
        )}
      </AiGate>
    </Page>
  );
}
