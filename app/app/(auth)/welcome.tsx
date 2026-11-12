import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Icon, OfflineBanner, Screen, ScreenHero, Text } from '@/ui';
import type { IconName } from '@/ui';
import { colors } from '@/theme';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'notifications-active', title: 'Deadline reminders', body: 'Alerts at 60, 30 and 15 minutes before a drive closes.' },
  { icon: 'fact-check', title: 'Know your eligibility', body: 'See exactly why you qualify, or what is missing.' },
  { icon: 'timeline', title: 'Track every application', body: 'One timeline from submitted to offer.' },
];

export default function Welcome() {
  const router = useRouter();
  return (
    <Screen scroll edges={['bottom']}>
      <ScreenHero brand title="UpGrid" subtitle="Campus drives, deadlines and applications in one place. For students and placement officers.">
        <Card padding={20} style={{ gap: 20 }}>
          <View style={{ gap: 16 }}>
            {POINTS.map((p) => (
              <View key={p.title} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryTint, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={p.icon} size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subhead">{p.title}</Text>
                  <Text variant="caption" color={colors.muted}>
                    {p.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ gap: 12 }}>
            <Button label="Create account" full onPress={() => router.push('/(auth)/register')} />
            <Button label="Log in" variant="secondary" full onPress={() => router.push('/(auth)/login')} />
            <Button label="I have a recruiter invite" variant="ghost" full onPress={() => router.push('/(auth)/recruiter-invite')} />
          </View>
        </Card>
      </ScreenHero>
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 4 }}>
        <OfflineBanner />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 4 }}>
          <Button label="Terms" variant="ghost" size="sm" onPress={() => router.push('/(auth)/terms')} />
          <Button label="Privacy Policy" variant="ghost" size="sm" onPress={() => router.push('/(auth)/privacy')} />
        </View>
      </View>
    </Screen>
  );
}
