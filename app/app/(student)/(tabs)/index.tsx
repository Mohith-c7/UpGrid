import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner, Button, Card, CompanyLogo, DriveCard, EmptyState, ErrorState, HeaderAction, OfflineBanner, ProgressBar, Screen, ScreenHero,
  SectionHeader, Skeleton, StatTile, Text, useIsOnline,
} from '@/ui';
import { colors, spacing } from '@/theme';
import {
  flatten, useAnnouncements, useApplications, useAuth, useDrives, useProfile, useServerOffset, useUnreadCount,
} from '@/api/hooks';
import { formatDateIST, timeAgo } from '@/lib/format';
import { isDriveClosed, friendlyError, nextStepOf, profileRouteFor, useNow, useSaveToggle } from '@/features/student/discover/helpers';
import { StatusBadge } from '@/features/student/me/kit';
import { AiHomeCard } from '@/features/ai/AiHomeCard';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { RestrictionBanner } from '@/features/studentExtras/restrictions';
import { StudentShortcuts } from '@/features/studentExtras/StudentShortcuts';
import { TestsHomeCard } from '@/features/tests/TestsHomeCard';

const ACTIVE = ['submitted', 'screening', 'assessment', 'interview'];

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
  const rail = useMemo(() => openDrives.slice(0, 4), [openDrives]);
  const eligibleCount = useMemo(() => openDrives.filter((d) => d.eligibility?.status === 'eligible').length, [openDrives]);
  const moreDrives = !!drives.hasNextPage;

  const appList = useMemo(() => apps.data ?? [], [apps.data]);
  const recentApps = useMemo(
    () => [...appList].sort((a, b) => Date.parse(b.updatedAt ?? b.submittedAt) - Date.parse(a.updatedAt ?? a.submittedAt)).slice(0, 3),
    [appList],
  );
  const activeApps = useMemo(() => appList.filter((a) => ACTIVE.includes(a.status)).length, [appList]);
  const offerApp = useMemo(() => appList.find((a) => a.status === 'offer_issued' || a.canRespondToOffer), [appList]);

  const firstName = ((profile.data?.identity?.preferredName || user?.name || '').trim().split(/\s+/)[0]) ?? '';
  const hour = new Date(nowMs + 5.5 * 3600 * 1000).getUTCHours(); // IST hour
  const unreadCount = typeof unread.data === 'number' ? unread.data : 0;
  const step = nextStepOf(profile.data?.completion);
  const percent = Math.max(0, Math.min(100, Math.round(profile.data?.completion?.percent ?? 0)));

  /* Profile completion summary: sits on the hero band; flat card, ONE next step. */
  let summary: React.ReactNode;
  if (profile.isLoading) summary = <Skeleton height={132} radius={14} />;
  else if (profile.isError) summary = (
    <Card>
      <ErrorState title="Profile unavailable" message={friendlyError(profile.error)} onRetry={() => void profile.refetch()} />
    </Card>
  );
  else if (profile.data) summary = (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }}>Profile completion</Text>
          <Text variant="heading" tabular>{`${percent}%`}</Text>
        </View>
        <ProgressBar value={percent / 100} label={`Profile ${percent} percent complete`} />
        {step && percent < 100 ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="body" style={{ fontWeight: '600' }}>{`Next: ${step.label}`}</Text>
              {step.why ? <Text variant="caption" color={colors.muted}>{step.why}</Text> : null}
            </View>
            <Button label="Continue" icon="arrow-forward" size="sm" onPress={() => go(profileRouteFor(step.key))} />
          </View>
        ) : (
          <Text variant="caption" color={colors.success}>Your profile is complete. Keep academics current before each season.</Text>
        )}
      </View>
    </Card>
  );

  return (
    <Screen scroll padded={false} edges={['bottom']} onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHero
        eyebrow={greeting(hour)}
        title={firstName || 'Welcome'}
        subtitle="Closing deadlines come first."
        right={
          <HeaderAction
            icon="notifications-none"
            label="Notifications"
            onDark
            badge={unreadCount}
            onPress={() => go('/(student)/notifications')}
          />
        }
      >
        {summary}
      </ScreenHero>

      <View style={{ padding: spacing.lg, gap: spacing.xxl }}>
        <OfflineBanner />
        <VerifyEmailBanner />
        <RestrictionBanner />

        {offerApp ? (
          <Banner
            tone="success"
            title="You have an offer to respond to"
            message={`${offerApp.drive.company.name}, ${offerApp.drive.role}`}
            action={{ label: 'Review offer', onPress: () => go(`/(student)/application/${offerApp.id}`) }}
          />
        ) : null}

        {/* Summary tiles */}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <StatTile
            label="Eligible drives open"
            value={drives.isLoading ? '-' : moreDrives ? `${eligibleCount}+` : eligibleCount}
            icon="work-outline"
            onPress={() => go('/(student)/(tabs)/opportunities')}
          />
          <StatTile
            label="Applications in progress"
            value={apps.isLoading ? '-' : activeApps}
            icon="assignment"
            tone={offerApp ? 'success' : 'neutral'}
            hint={offerApp ? 'Offer waiting' : undefined}
            onPress={() => go('/(student)/(tabs)/applications')}
          />
        </View>

        <AiHomeCard />
        <StudentShortcuts />
        <TestsHomeCard />

        {/* Deadline-first list */}
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Closing soonest" action={{ label: 'See all', onPress: () => go('/(student)/(tabs)/opportunities') }} />
          {drives.isLoading ? (
            <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} height={132} radius={14} />)}</View>
          ) : drives.isError && rail.length === 0 ? (
            <ErrorState title="Could not load drives" message={friendlyError(drives.error)} onRetry={() => void drives.refetch()} />
          ) : rail.length === 0 ? (
            <EmptyState
              icon="work-outline"
              title="No open drives right now"
              message="New drives from your placement cell appear here as soon as they are published."
              actionLabel="Browse opportunities"
              onAction={() => go('/(student)/(tabs)/opportunities')}
            />
          ) : (
            <View style={{ gap: spacing.md }}>
              {rail.map((d) => {
                const saved = save.isSaved(d.id, d.saved);
                return (
                  <DriveCard
                    key={d.id}
                    variant="compact"
                    drive={{ ...d, saved }}
                    serverOffsetMs={offset}
                    onPress={() => go(`/(student)/drive/${d.id}`)}
                    onToggleSave={() => void save.toggle(d.id, saved)}
                  />
                );
              })}
            </View>
          )}
        </View>

        {/* Application updates */}
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Application updates" action={{ label: 'See all', onPress: () => go('/(student)/(tabs)/applications') }} />
          {apps.isLoading ? (
            <Skeleton height={96} radius={14} />
          ) : apps.isError ? (
            <ErrorState title="Could not load applications" message={friendlyError(apps.error)} onRetry={() => void apps.refetch()} />
          ) : recentApps.length === 0 ? (
            <EmptyState
              icon="description"
              title="No applications yet"
              message="Saving a drive is only a bookmark. Opt in to a drive to apply."
              actionLabel="Find a drive"
              onAction={() => go('/(student)/(tabs)/opportunities')}
            />
          ) : (
            recentApps.map((a) => (
              <Card key={a.id} onPress={() => go(`/(student)/application/${a.id}`)} accessibilityLabel={`${a.drive.company.name}, ${a.drive.role}, ${a.status}`}>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <CompanyLogo name={a.drive.company.name} logoUrl={a.drive.company.logoUrl} size={44} />
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
                    <Text variant="subhead" numberOfLines={1}>{a.drive.company.name}</Text>
                    <Text variant="caption" color={colors.muted} numberOfLines={2}>{a.drive.role}</Text>
                    <StatusBadge status={a.status} />
                    <Text variant="caption" tabular color={colors.muted}>{`Updated ${timeAgo(a.updatedAt ?? a.submittedAt, nowMs)}`}</Text>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>

        {/* Announcements */}
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Announcements" />
          {announcements.isLoading ? (
            <Skeleton height={96} radius={14} />
          ) : announcements.isError ? (
            <ErrorState title="Could not load announcements" message={friendlyError(announcements.error)} onRetry={() => void announcements.refetch()} />
          ) : (announcements.data ?? []).length === 0 ? (
            <EmptyState icon="campaign" title="No announcements" message="Notices from the placement cell show up here." />
          ) : (
            (announcements.data ?? []).slice(0, 3).map((n) => (
              <Card key={n.id} onPress={n.driveId ? () => go(`/(student)/drive/${n.driveId}`) : undefined}>
                <View style={{ gap: spacing.xs }}>
                  <Text variant="subhead" numberOfLines={2}>{n.title}</Text>
                  <Text variant="body" numberOfLines={3} ellipsizeMode="tail">{n.body}</Text>
                  <Text variant="caption" tabular color={colors.muted}>{formatDateIST(n.createdAt)}</Text>
                </View>
              </Card>
            ))
          )}
        </View>

        {!online ? (
          <Text variant="caption" color={colors.muted} align="center">You are offline. Showing the last data we had.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
