import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Icon, useTabScreenOptions, type IconName } from '@/ui';

const tabIcon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={24} color={color as string} />;
  };

export default function OfficerTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: tabIcon('dashboard') }} />
      <Tabs.Screen name="drives" options={{ title: 'Drives', tabBarIcon: tabIcon('work-outline') }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: tabIcon('school') }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals', tabBarIcon: tabIcon('fact-check') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more-horiz') }} />
    </Tabs>
  );
}
