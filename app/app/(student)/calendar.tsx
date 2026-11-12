import { useCopy } from '@/lib/copy';
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Banner, Button, Card, CodeBlock, EmptyState, Icon, SectionHeader, SegmentedControl, Text, useToast, type IconName } from '@/ui';
import { colors } from '@/theme';
import { Page, QueryBoundary, confirm, sp } from '@/features/student/me/kit';
import { useFeature } from '@/config/features';
import { isMissingRoute, useCalendar, useCreateFeedToken, useFeedTokenStatus, useRevokeFeedToken } from '@/api/studentExtras';
import type { CalendarItem } from '@/api/studentExtrasTypes';
import { formatDateIST, formatTimeIST } from '@/lib/format';
import { errMessage } from '@/api/client';

const KIND: Record<string, { label: string; icon: IconName; tone: 'info' | 'warning' | 'success' | 'neutral' | 'error' }> = {
  deadline: { label: 'Deadline', icon: 'timer', tone: 'warning' },
  drive_closing: { label: 'Drive closing', icon: 'timer', tone: 'warning' },
  test: { label: 'Test', icon: 'quiz', tone: 'info' },
  assessment: { label: 'Assessment', icon: 'quiz', tone: 'info' },
  interview: { label: 'Interview', icon: 'groups', tone: 'info' },
  offer_expiry: { label: 'Offer expires', icon: 'local-offer', tone: 'error' },
  attendance: { label: 'Attendance', icon: 'how-to-reg', tone: 'neutral' },
};
const RANGES = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }];
const IST_MS = 5.5 * 3600 * 1000;
const dayKey = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);

function Row({ it, onPress }: { it: CalendarItem; onPress?: () => void }) {
  const k = KIND[it.kind] ?? { label: 'Event', icon: 'event' as IconName, tone: 'neutral' as const };
  const time = formatTimeIST(it.startsAt) + (it.endsAt ? ` to ${formatTimeIST(it.endsAt)}` : '');
  return (
    <Card onPress={onPress} accessibilityLabel={`${k.label}, ${it.title}, ${time} IST`}>
      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <Icon name={k.icon} size={24} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0, gap: sp.xs }}>
          <Text variant="subhead" numberOfLines={2}>{it.title}</Text>
          <Text variant="caption" tabular color={colors.muted}>{`${time} IST`}</Text>
          {it.detail ? <Text variant="caption" color={colors.textSecondary} numberOfLines={3}>{it.detail}</Text> : null}
          <View style={{ flexDirection: 'row' }}><Badge label={k.label} tone={k.tone} icon={k.icon} /></View>
        </View>
      </View>
    </Card>
  );
}

function SubscribeCard() {
  const toast = useToast();
  const copy = useCopy();
  const status = useFeedTokenStatus(true);
  const create = useCreateFeedToken();
  const revoke = useRevokeFeedToken();
  const [url, setUrl] = useState<string | null>(null);

  const make = async () => {
    try { const r = await create.mutateAsync(); setUrl(r.url); } catch (e) { toast.show(errMessage(e), 'error'); }
  };
  const stop = async () => {
    try { await revoke.mutateAsync(); setUrl(null); toast.show('Calendar link revoked', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
  };

  if (status.isError && isMissingRoute(status.error)) return null;
  const active = status.data?.active === true;
  return (
    <View style={{ gap: sp.md }}>
      <SectionHeader title="Subscribe in your calendar app" subtitle="Google Calendar, Outlook or Apple Calendar" />
      <Card>
        <View style={{ gap: sp.md }}>
          {status.isLoading ? (
            <Text variant="body" color={colors.muted}>Checking your calendar link...</Text>
          ) : status.isError ? (
            <Banner tone="error" message="Could not check your calendar link." action={{ label: 'Retry', onPress: () => void status.refetch() }} />
          ) : (
            <>
              <Text variant="body" color={colors.textSecondary}>
                {active
                  ? 'You have an active calendar link. For safety it is shown only once, when you create it. Create a new one to see it again; the old one stops working.'
                  : 'Create a private link and add it as a subscribed calendar. Your deadlines, tests and interviews then show up next to your other events.'}
              </Text>
              {url ? (
                <View style={{ gap: sp.md }}>
                  <CodeBlock label="Your private link (keep it to yourself)" code={url} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    <Button label="Open in calendar app" icon="event" size="sm" onPress={() => Linking.openURL(url.replace(/^https?:/i, 'webcal:')).catch(() => toast.show('No calendar app could open the link. Share it instead.', 'error'))} />
                    <Button label="Copy link" icon="content-copy" size="sm" variant="secondary" onPress={() => void copy(url, 'Link')} />
                    <Button label="Share link" icon="share" size="sm" variant="secondary" onPress={() => { void Share.share({ message: url }); }} />
                  </View>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Button label={active ? 'Create a new link' : 'Create calendar link'} icon="link" size="sm" variant={url ? 'secondary' : 'primary'} loading={create.isPending}
                  onPress={active && !url ? () => confirm('Replace your calendar link?', 'The old link stops working. You will need to subscribe again with the new one.', 'Create new link', () => void make(), false) : make} />
                {active ? <Button label="Revoke link" icon="link-off" size="sm" variant="ghost" loading={revoke.isPending} onPress={() => confirm('Revoke your calendar link?', 'Calendars subscribed with it stop updating.', 'Revoke', () => void stop())} /> : null}
              </View>
            </>
          )}
        </View>
      </Card>
    </View>
  );
}

/** Placement calendar: GET /calendar (student view: own deadlines, tests, interviews, offer expiries) plus the ICS subscribe link. */
export default function PlacementCalendarScreen() {
  const router = useRouter();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(student)/(tabs)' as never)), [router]);
  const on = useFeature('opsCalendar');
  const [range, setRange] = useState('30');
  const [fromTo, setFromTo] = useState(() => ({ from: new Date().toISOString() }));
  // the window starts at "now" whenever the range changes or the user refreshes, so a screen left open does not go stale
  const changeRange = (v: string) => { setFromTo({ from: new Date().toISOString() }); setRange(v); };
  const refresh = () => { setFromTo({ from: new Date().toISOString() }); void q.refetch(); };
  const to = useMemo(() => new Date(Date.parse(fromTo.from) + Number(range) * 86400000).toISOString(), [fromTo.from, range]);
  const q = useCalendar(fromTo.from, to, on);
  const unavailable = !on || (q.isError && isMissingRoute(q.error));

  const groups = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of q.data ?? []) {
      const k = dayKey(it.startsAt);
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [q.data]);

  const open = (it: CalendarItem) => {
    if (it.applicationId) return () => router.push(`/(student)/application/${it.applicationId}` as never);
    if (it.driveId) return () => router.push(`/(student)/drive/${it.driveId}` as never);
    if (it.link && it.link.startsWith('/(student)/')) return () => router.push(it.link as never);
    return undefined;
  };

  return (
    <Page title="Placement calendar" onBack={back} onRefresh={refresh} refreshing={q.isRefetching} gap={sp.xl}>
      {unavailable ? (
        <EmptyState icon="event-busy" title="Calendar is not available" message="Your placement cell has not turned on the calendar yet." />
      ) : (
        <>
          <SegmentedControl value={range} onChange={changeRange} options={RANGES} />
          <QueryBoundary
            isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}
            isEmpty={groups.length === 0}
            empty={{ title: 'Nothing scheduled', message: `No deadlines, tests or interviews in the next ${range} days. Try a longer range.` }}
            skeletonRows={3} skeletonHeight={96}
          >
            <View style={{ gap: sp.xl }}>
              {groups.map(([day, items]) => (
                <View key={day} style={{ gap: sp.md }}>
                  <SectionHeader title={formatDateIST(items[0].startsAt)} />
                  {items.map((it) => <Row key={`${it.kind}-${it.id}`} it={it} onPress={open(it)} />)}
                </View>
              ))}
            </View>
          </QueryBoundary>
          <SubscribeCard />
        </>
      )}
    </Page>
  );
}
