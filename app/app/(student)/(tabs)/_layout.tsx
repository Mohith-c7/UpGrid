import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Icon, useTabScreenOptions, type IconName } from '@/ui';
import { useUnreadCount } from '@/api/hooks';

const tabIcon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={24} color={color as string} />;
  };

export default function StudentTabs() {
  const screenOptions = useTabScreenOptions();
  const unread = useUnreadCount().data ?? 0;
  return (
    <Tabs
      screenOptions={screenOptions}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('home-filled'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Home, ${unread} unread notifications` : 'Home',
        }}
      />
      <Tabs.Screen name="opportunities" options={{ title: 'Opportunities', tabBarIcon: tabIcon('work-outline') }} />
      <Tabs.Screen name="applications" options={{ title: 'Applications', tabBarIcon: tabIcon('assignment') }} />
      <Tabs.Screen name="prepare" options={{ title: 'Prepare', tabBarIcon: tabIcon('menu-book') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person-outline') }} />
    </Tabs>
  );
}
