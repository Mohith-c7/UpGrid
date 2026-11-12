import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, RefreshControl, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Badge, Banner, Button, Card, Chip, CompanyLogo, Countdown, EmptyState, ErrorState, Header, HeaderAction, Icon, KeyValueList, OfflineBanner,
  Screen, Sheet, Skeleton, Text, TimelineList,
} from '@/ui';
import { colors, MIN_TOUCH, spacing, urgentColors } from '@/theme';
import { useApplications, useDrive, useProfile, useServerOffset } from '@/api/hooks';
import { formatDateTimeIST, relativeDeadline, timeAgo } from '@/lib/format';
import type { DriveDetail } from '@/api/types';
import { BulletList, Section } from '@/features/student/discover/blocks';
import { EligibilityTable } from '@/features/student/discover/eligibility';
import {
  compView, driveMetaLine, eligibilityMeta, friendlyError, isDriveClosed, isOfflineError, modeLabel, nextStepOf, profileRouteFor, useNow, useSaveToggle,
} from '@/features/student/discover/helpers';

function asLines(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return v.split(/\r?\n/).map((s) => s.replace(/^[\s\-•*]+/, '').trim()).filter(Boolean);
}

const QTYPE: Record<string, string> = {
  short_text: 'Short answer', long_text: 'Long answer', number: 'Number', date: 'Date', single_select: 'Choose one',
  multi_select: 'Choose any', yes_no: 'Yes / No', url: 'Link', declaration: 'Declaration',
};

function LoadingShell({ back, children }: { back: () => void; children: React.ReactNode }) {
  const focused = useIsFocused();
  return (
    <Screen scroll={false} padded={false} edges={['bottom']}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header variant="bar" title="Drive details" onBack={back} />
      {children}
    </Screen>
  );
}

export default function DriveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const go = useCallback((p: string) => router.push(p as never), [router]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)/opportunities' as never)), [router]);

  const drive = useDrive(id);
  const apps = useApplications();
  const profile = useProfile();
  const offset = useServerOffset();
  const nowMs = useNow(offset, 15000);
  const save = useSaveToggle();
  const [whyOpen, setWhyOpen] = useState(false);
  const [expired, setExpired] = useState(false);

  const d = drive.data;
  const myApplication = useMemo(
    () => (apps.data ?? []).find((a) => a.drive.id === id && a.status !== 'withdrawn'),
    [apps.data, id],
  );

  /* ------------------------------------------------------------ states */
  if (drive.isLoading) {
    return (
      <LoadingShell back={back}>
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={72} radius={14} />
          <Skeleton height={150} radius={14} />
          <Skeleton height={96} radius={14} />
          <Skeleton height={180} radius={14} />
        </View>
      </LoadingShell>
    );
  }
  if (drive.isError || !d) {
    const notFound = (drive.error as unknown as { status?: number } | null)?.status === 404;
    return (
      <LoadingShell back={back}>
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <OfflineBanner />
          {notFound ? (
            <EmptyState icon="search-off" title="Drive not found" message="It may have been removed or is not open to you." actionLabel="Back to opportunities" onAction={back} />
          ) : (
            <ErrorState
              message={isOfflineError(drive.error) ? "You're offline. Reconnect to view this drive." : friendlyError(drive.error)}
              onRetry={() => void drive.refetch()}
            />
          )}
        </View>
      </LoadingShell>
    );
  }

  return (
    <DriveBody
      d={d}
      offset={offset}
      nowMs={nowMs}
      expired={expired}
      onExpire={() => setExpired(true)}
      refreshing={drive.isRefetching}
      onRefresh={() => { void drive.refetch(); void apps.refetch(); void profile.refetch(); }}
      saved={save.isSaved(d.id, d.saved)}
      onToggleSave={() => void save.toggle(d.id, save.isSaved(d.id, d.saved))}
      back={back}
      myApplicationId={myApplication?.id ?? null}
      nextStepKey={nextStepOf(profile.data?.completion)?.key ?? null}
      go={go}
      whyOpen={whyOpen}
      setWhyOpen={setWhyOpen}
    />
  );
}

interface BodyProps {
  d: DriveDetail; offset: number; nowMs: number; expired: boolean; onExpire: () => void; refreshing: boolean; onRefresh: () => void;
  saved: boolean; onToggleSave: () => void; back: () => void; myApplicationId: string | null; nextStepKey: string | null;
  go: (p: string) => void; whyOpen: boolean; setWhyOpen: (v: boolean) => void;
}

function DriveBody({ d, offset, nowMs, expired, onExpire, refreshing, onRefresh, saved, onToggleSave, back, myApplicationId, nextStepKey, go, whyOpen, setWhyOpen }: BodyProps) {
  const focused = useIsFocused();
  const closed = expired || isDriveClosed(d, nowMs);
  const comp = compView(d.ctc ?? { kind: 'annual', breakdownProvided: false });
  const elig = eligibilityMeta(d.eligibility?.status ?? 'pending');
  const reasons = d.eligibility?.reasons ?? [];
  const eligReason = d.eligibility?.reason;
  const unmet = reasons.filter((r) => r.met === false);
  const reqs = asLines(d.requirements);
  const jd = d.jd ?? d.description;
  const questions = d.questions ?? [];
  const rounds = d.rounds ?? [];
  const contact = d.contact;
  const contactObj = contact && typeof contact === 'object' ? contact : null;
  const contactText = typeof contact === 'string' ? contact : null;
  const diff = Date.parse(d.deadline) - nowMs;
  const urgent = !closed && diff > 0 && diff < 24 * 3600 * 1000;
  const applied = !!(d.applied || myApplicationId);
  const status = d.eligibility?.status ?? 'pending'; // a missing eligibility block is treated as pending, never as not eligible
  const locs = d.locations ?? [];

  /* --------------------------------------------------------- sticky CTA */
  let cta: React.ReactNode;
  let hint: string | null = null;
  if (applied) {
    hint = 'You have applied to this drive.';
    cta = (
      <Button
        label="View application"
        icon="description"
        full
        onPress={() => go(myApplicationId ? `/(student)/application/${myApplicationId}` : '/(student)/(tabs)/applications')}
      />
    );
  } else if (closed) {
    hint = `Closed on ${formatDateTimeIST(d.deadline)}`;
    cta = <Button label="Applications closed" full disabled onPress={() => undefined} />;
  } else if (status === 'eligible') {
    hint = relativeDeadline(d.deadline, offset, nowMs);
    cta = <Button label="Opt in and apply" icon="arrow-forward" full onPress={() => go(`/(student)/apply/${d.id}`)} />;
  } else if (status === 'restricted') {
    hint = eligReason ?? 'Applications to this drive are restricted for you.';
    cta = <Button label="View restriction and appeal" variant="secondary" icon="gpp-maybe" full onPress={() => go('/(student)/restrictions')} />;
  } else if (status === 'pending') {
    hint = eligReason ?? 'We need more details to check your eligibility.';
    cta = <Button label="Complete profile" icon="person" full onPress={() => go(profileRouteFor(nextStepKey))} />;
  } else {
    hint = eligReason ?? 'You do not meet the criteria for this drive.';
    cta = <Button label="Why am I not eligible?" variant="secondary" icon="info-outline" full onPress={() => setWhyOpen(true)} />;
  }

  const footer = (
    <View style={{ gap: spacing.sm }}>
      {hint ? <Text variant="caption" color={colors.muted} align="center">{hint}</Text> : null}
      {cta}
    </View>
  );

  const facts = [
    { label: 'Package', value: comp.headline, icon: 'payments' as const },
    ...comp.parts.map((p) => ({ label: p.label, value: p.value })),
    ...(d.bondNote ? [{ label: 'Bond', value: d.bondNote }] : []),
    { label: 'Work mode', value: modeLabel(d.workMode) || null, icon: 'work-outline' as const },
    { label: 'Locations', value: locs.length ? locs.join(', ') : null, icon: 'place' as const },
    ...(d.employmentType ? [{ label: 'Type', value: d.employmentType }] : []),
  ];

  return (
    <Screen scroll={false} padded={false} edges={['bottom']} footer={footer}>
      {focused ? <StatusBar style="dark" /> : null}
      <Header
        variant="bar"
        title="Drive details"
        onBack={back}
        right={
          <HeaderAction
            icon={saved ? 'bookmark' : 'bookmark-border'}
            label={saved ? 'Remove from saved' : 'Save for later'}
            onPress={onToggleSave}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <OfflineBanner />

        {/* Company + role */}
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <CompanyLogo name={d.company.name} logoUrl={d.company.logoUrl} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="subhead" numberOfLines={2}>{d.company.name}</Text>
              {d.company.industry ? <Text variant="caption" color={colors.muted} numberOfLines={1}>{d.company.industry}</Text> : null}
            </View>
          </View>
          <Text variant="title" accessibilityRole="header">{d.role}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {d.company.verified ? <Badge label="Verified company" tone="success" icon="verified" /> : null}
            {applied ? <Badge label="Applied" tone="success" icon="check-circle-outline" /> : null}
            {closed && !applied ? <Badge label="Closed" tone="neutral" icon="lock-outline" /> : null}
            {!closed && d.status === 'closing' ? <Badge label="Closing soon" tone="warning" icon="timer" /> : null}
            {driveMetaLine(d) ? <Chip label={driveMetaLine(d)} icon="place" /> : null}
          </View>
        </View>

        {/* Key facts */}
        <Card>
          <KeyValueList inline items={facts} />
          <Text variant="caption" color={colors.muted} style={{ paddingTop: spacing.sm }}>{comp.unitNote}</Text>
        </Card>

        {/* Deadline */}
        <Card tinted={!closed && !urgent} style={urgent ? { backgroundColor: urgentColors.bg, borderColor: urgentColors.border } : null}>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Icon name={urgent ? 'timer' : 'event'} size={24} color={urgent ? urgentColors.fg : colors.primary} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="overline" color={colors.muted}>Application deadline</Text>
              {closed ? (
                <Text variant="subhead" color={colors.muted}>Closed</Text>
              ) : (
                <Countdown deadline={d.deadline} serverOffsetMs={offset} onExpire={onExpire} />
              )}
              <Text variant="body" tabular style={{ fontWeight: '600' }}>{formatDateTimeIST(d.deadline)}</Text>
              {closed ? <Text variant="caption" color={colors.muted}>This drive no longer accepts applications.</Text> : null}
            </View>
          </View>
        </Card>

        {/* Eligibility */}
        <Section title="Your eligibility">
          {status === 'eligible' ? (
            <Banner tone="success" title="You are eligible" message={eligReason ?? 'Your profile meets every rule for this drive.'} />
          ) : status === 'restricted' ? (
            <Banner
              tone="warning"
              icon="gpp-maybe"
              title="Applications are restricted for you"
              message={eligReason ?? 'The placement cell has limited your applications to this drive. You can read the reason and appeal.'}
              action={{ label: 'View reason and appeal', onPress: () => go('/(student)/restrictions') }}
            />
          ) : status === 'pending' ? (
            <Banner
              tone="warning"
              title="We need more details"
              message={eligReason ?? 'Some profile details are missing, so we cannot check every rule yet.'}
              action={{ label: 'Complete profile', onPress: () => go(profileRouteFor(nextStepKey)) }}
            />
          ) : (
            <Banner
              tone="error"
              title="You are not eligible"
              message={eligReason ?? 'Your profile does not meet this drive\'s criteria.'}
              action={{ label: 'Dispute or ask the placement cell', onPress: () => go(`/(student)/support/new?category=eligibility&subject=${encodeURIComponent(`Eligibility dispute: ${d.company.name} - ${d.role}`.slice(0, 120))}&message=${encodeURIComponent(`Drive: ${d.company.name} - ${d.role} (ID ${d.id})\nShown as: ${elig.label}\n\nWhy I think this is wrong: `)}`) }}
            />
          )}
          <EligibilityTable reasons={reasons} />
        </Section>

        {jd ? (
          <Section title="About the role">
            <Text variant="body">{jd}</Text>
          </Section>
        ) : null}

        {rounds.length > 0 ? (
          <Section title="Selection rounds">
            <Card>
              <TimelineList
                items={rounds.map((r, i) => ({
                  id: `${r.name}-${i}`,
                  title: r.name,
                  subtitle: [r.mode, r.description].filter(Boolean).join(' · ') || undefined,
                  time: r.date ? formatDateTimeIST(r.date) : undefined,
                  state: 'upcoming' as const,
                }))}
              />
            </Card>
          </Section>
        ) : null}

        {reqs.length > 0 ? (
          <Section title="Requirements">
            <BulletList items={reqs} />
          </Section>
        ) : null}

        {questions.length > 0 ? (
          <Section title="Questions you may answer" hint="Only questions your profile cannot answer are asked when you opt in.">
            <Card>
              {questions.map((q, i) => (
                <View
                  key={q.id}
                  style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
                >
                  <Icon name="help-outline" size={20} color={colors.subtle} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body">{q.label}</Text>
                    <Text variant="caption" color={colors.muted}>{`${QTYPE[q.type] ?? q.type} · ${q.required ? 'Required' : 'Optional'}`}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {d.policyNote ? <Banner tone="info" title="Placement policy" message={d.policyNote} /> : null}

        {(d.dataSharedPreview ?? []).length > 0 ? (
          <Section title="What is shared if you opt in" hint="Only these details go to the company.">
            <Card tinted>
              <BulletList items={d.dataSharedPreview ?? []} />
            </Card>
          </Section>
        ) : null}

        {(contactObj || contactText) ? (
          <Section title="Contact">
            <Card>
              {contactText ? <Text variant="body">{contactText}</Text> : null}
              {contactObj?.name ? <Text variant="body" style={{ fontWeight: '600' }}>{contactObj.name}</Text> : null}
              {contactObj?.email ? (
                <Pressable
                  onPress={() => void Linking.openURL(`mailto:${contactObj.email}`).catch(() => undefined)}
                  accessibilityRole="link"
                  accessibilityLabel={`Email ${contactObj.email}`}
                  style={{ minHeight: MIN_TOUCH, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}
                >
                  <Icon name="mail-outline" size={20} color={colors.info} />
                  <Text variant="body" color={colors.info} numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>{contactObj.email}</Text>
                </Pressable>
              ) : null}
              {contactObj?.phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${contactObj.phone}`).catch(() => undefined)}
                  accessibilityRole="link"
                  accessibilityLabel={`Call ${contactObj.phone}`}
                  style={{ minHeight: MIN_TOUCH, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}
                >
                  <Icon name="call" size={20} color={colors.info} />
                  <Text variant="body" tabular color={colors.info} style={{ flex: 1 }}>{contactObj.phone}</Text>
                </Pressable>
              ) : null}
            </Card>
          </Section>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" tabular color={colors.muted}>
            {d.lastVerifiedAt
              ? `Last verified ${timeAgo(d.lastVerifiedAt, nowMs)} (${formatDateTimeIST(d.lastVerifiedAt)})`
              : 'Details not yet verified by the placement cell.'}
          </Text>
          <Button
            label="Report a problem with this drive" variant="ghost" icon="flag" full
            onPress={() => go(`/(student)/support/new?category=other&subject=${encodeURIComponent(`Problem with drive: ${d.company.name} - ${d.role}`.slice(0, 120))}&message=${encodeURIComponent(`Drive: ${d.company.name} - ${d.role} (ID ${d.id})\n\nWhat looks wrong: `)}`)}
          />
        </View>
      </ScrollView>

      <Sheet visible={whyOpen} onClose={() => setWhyOpen(false)} title="Why you are not eligible">
        <View style={{ gap: spacing.md }}>
          {unmet.length > 0 ? (
            <EligibilityTable reasons={unmet} />
          ) : (
            <Text variant="body">{d.eligibility?.reason ?? "Your profile does not meet this drive's criteria."}</Text>
          )}
          <Text variant="caption" color={colors.muted}>If a value in your profile is wrong, update it. Verified academic values can only be changed by the placement cell.</Text>
          <Button label="Review my eligibility" variant="secondary" full onPress={() => { setWhyOpen(false); go('/(student)/eligibility'); }} />
          <Button label="Close" variant="ghost" full onPress={() => setWhyOpen(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
