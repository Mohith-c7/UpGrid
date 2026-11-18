import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, HeaderAction, MetricStrip, OfflineBanner, Screen, ScreenHero, Text, useIsOnline } from '@/ui';
import { colors, spacing } from '@/theme';
import {
  flatten, useAnnouncements, useApplications, useAuth, useDrives, useProfile, useServerOffset, useUnreadCount,
} from '@/api/hooks';
import { isDriveClosed, friendlyError, profileRouteFor, useNow, useSaveToggle } from '@/features/student/discover/helpers';
import { AiHomeCard } from '@/features/ai/AiHomeCard';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { RestrictionBanner } from '@/features/studentExtras/restrictions';
import { StudentShortcuts } from '@/features/studentExtras/StudentShortcuts';
import { TestsHomeCard } from '@/features/tests/TestsHomeCard';
import { ReadinessPanel } from '@/features/student/home/ReadinessPanel';
import { UpNextPanel } from '@/features/student/home/UpNextPanel';
import { DeadlinesPanel } from '@/features/student/home/DeadlinesPanel';
import { PipelinePanel } from '@/features/student/home/PipelinePanel';
import { AnnouncementsPanel, type AnnouncementItem } from '@/features/student/home/AnnouncementsPanel';

const ACTIVE = ['submitted', 'screening', 'assessment', 'interview'];
const OFFER = ['selected', 'offer_issued', 'offer_accepted', 'joined'];

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const go = useCallback((path: string) => router.push(path as never), [router]);
  const { user } = useAuth();
  const online = useIsOnline();
  const offset = useServerOffset();
  const nowMs = useNow(offset);

  const profile = useProfile();
  const drives = useDrives({ status: 'open', sort: 'closing', limit: 12 });
  const apps = useApplications();
  const announcements = useAnnouncements();
  const unread = useUnreadCount();
  const save = useSaveToggle();

  const refreshing =
    (profile.isRefetching || drives.isRefetching || apps.isRefetching || announcements.isRefetching) && !profile.isLoading;
  const onRefresh = useCallback(() => {
    void profile.refetch();
    void drives.refetch();
    void apps.refetch();
    void announcements.refetch();
    void unread.refetch();
  }, [profile, drives, apps, announcements, unread]);

  const openDrives = useMemo(
    () =>
      flatten(drives.data)
        .filter((d) => !d.applied && !isDriveClosed(d, nowMs))
        .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline)),
    [drives.data, nowMs],
  );
  const closingSoon = useMemo(() => openDrives.slice(0, 4), [openDrives]);
  const eligibleCount = useMemo(() => openDrives.filter((d) => d.eligibility?.status === 'eligible').length, [openDrives]);
  const moreDrives = !!drives.hasNextPage;

  const appList = useMemo(() => apps.data ?? [], [apps.data]);
  const activeApps = useMemo(() => appList.filter((a) => ACTIVE.includes(a.status)).length, [appList]);
  const offerCount = useMemo(() => appList.filter((a) => OFFER.includes(a.status)).length, [appList]);
  const upcomingCount = useMemo(
    () => appList.filter((a) => a.schedule && Date.parse(a.schedule.scheduledAt) > nowMs).length,
    [appList, nowMs],
  );
  const offerApp = useMemo(() => appList.find((a) => a.status === 'offer_issued' || a.canRespondToOffer), [appList]);

  const firstName = ((profile.data?.identity?.preferredName || user?.name || '').trim().split(/\s+/)[0]) ?? '';
  const hour = new Date(nowMs + 5.5 * 3600 * 1000).getUTCHours(); // IST hour
  const unreadCount = typeof unread.data === 'number' ? unread.data : 0;

  const announcementItems: AnnouncementItem[] = useMemo(() => (announcements.data ?? []) as AnnouncementItem[], [announcements.data]);

  return (
    <Screen scroll padded={false} edges={['bottom']} onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHero
        eyebrow={greeting(hour)}
        title={firstName || 'Welcome'}
        subtitle={unreadCount > 0 ? `${unreadCount} unread ${unreadCount === 1 ? 'update' : 'updates'}` : 'Here is where your placements stand.'}
        right={
          <HeaderAction
            icon="notifications-none"
            label="Notifications"
            badge={unreadCount}
            onPress={() => go('/(student)/notifications')}
          />
        }
      />

      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        <OfflineBanner />
        <VerifyEmailBanner />
        <RestrictionBanner />

        {offerApp ? (
          <Banner
            tone="success"
            icon="local-offer"
            title="You have an offer to respond to"
            message={`${offerApp.drive.company.name}, ${offerApp.drive.role}`}
            action={{ label: 'Review offer', onPress: () => go(`/(student)/application/${offerApp.id}`) }}
          />
        ) : null}

        <MetricStrip
          loading={drives.isLoading && apps.isLoading}
          items={[
            {
              label: 'Eligible open',
              value: drives.isLoading ? '–' : moreDrives ? `${eligibleCount}+` : eligibleCount,
              onPress: () => go('/(student)/(tabs)/opportunities'),
            },
            { label: 'In progress', value: apps.isLoading ? '–' : activeApps, onPress: () => go('/(student)/(tabs)/applications') },
            { label: 'Scheduled', value: apps.isLoading ? '–' : upcomingCount, tone: upcomingCount > 0 ? 'info' : undefined, onPress: () => go('/(student)/(tabs)/applications') },
            { label: 'Offers', value: apps.isLoading ? '–' : offerCount, tone: offerCount > 0 ? 'success' : undefined, onPress: () => go('/(student)/(tabs)/applications') },
          ]}
        />

        <ReadinessPanel
          completion={profile.data?.completion}
          loading={profile.isLoading}
          error={profile.isError ? friendlyError(profile.error) : null}
          onRetry={() => void profile.refetch()}
          onContinue={(key) => go(profileRouteFor(key))}
        />

        <UpNextPanel applications={appList} nowMs={nowMs} offsetMs={offset} onOpen={(id) => go(`/(student)/application/${id}`)} />

        <DeadlinesPanel
          drives={closingSoon}
          loading={drives.isLoading}
          error={drives.isError ? friendlyError(drives.error) : null}
          nowMs={nowMs}
          offsetMs={offset}
          isSaved={(d) => save.isSaved(d.id, d.saved)}
          onToggleSave={(d, saved) => void save.toggle(d.id, saved)}
          onOpen={(id) => go(`/(student)/drive/${id}`)}
          onSeeAll={() => go('/(student)/(tabs)/opportunities')}
          onRetry={() => void drives.refetch()}
        />

        <PipelinePanel
          applications={appList}
          loading={apps.isLoading}
          error={apps.isError ? friendlyError(apps.error) : null}
          nowMs={nowMs}
          onOpen={(id) => go(`/(student)/application/${id}`)}
          onSeeAll={() => go('/(student)/(tabs)/applications')}
          onFind={() => go('/(student)/(tabs)/opportunities')}
          onRetry={() => void apps.refetch()}
        />

        <AnnouncementsPanel
          items={announcementItems}
          loading={announcements.isLoading}
          error={announcements.isError ? friendlyError(announcements.error) : null}
          onOpenDrive={(id) => go(`/(student)/drive/${id}`)}
          onRetry={() => void announcements.refetch()}
        />

        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <Text variant="overline" color={colors.muted} accessibilityRole="header">Prepare</Text>
          <StudentShortcuts />
          <TestsHomeCard />
          <AiHomeCard />
        </View>

        {!online ? (
          <Text variant="caption" color={colors.muted} align="center">You are offline. Showing the last data we had.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
