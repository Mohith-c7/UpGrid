import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '@/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen padded>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState icon="search-off" title="This page does not exist" message="The link may be old or incomplete." />
        <View style={{ alignItems: 'center' }}>
          <Button label="Go to home" onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  );
}
