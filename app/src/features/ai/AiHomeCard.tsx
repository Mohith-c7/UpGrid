import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, Icon, Text } from '@/ui';
import { colors, spacing } from '@/theme';
import { useFeature } from '@/config/features';

/** "AI assistant" entry card for the student Home. Renders nothing when `features.ai` is off or still loading. */
export function AiHomeCard() {
  const router = useRouter();
  const on = useFeature('ai');
  if (!on) return null;
  return (
    <Card onPress={() => router.push('/(student)/ai' as never)} accessibilityLabel="AI assistant. Ask questions, review your resume, practise interviews.">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Icon name="auto-awesome" size={24} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="subhead">AI assistant</Text>
          <Text variant="caption" color={colors.muted}>Ask about drives, review your resume, practise interviews.</Text>
        </View>
        <Icon name="chevron-right" size={24} color={colors.subtle} />
      </View>
    </Card>
  );
}
