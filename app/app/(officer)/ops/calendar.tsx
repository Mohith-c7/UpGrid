import { useCopy } from '@/lib/copy';
import React, { useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { Badge, Banner, Button, CodeBlock, HeaderAction, SegmentedControl, Sheet, Text, useToast } from '@/ui';
import { colors, MIN_TOUCH, radius } from '@/theme';
import { API_URL, errMessage } from '@/api/client';
import { useCalendar, useFeedToken, useFeedTokenMutations } from '@/api/ops';
import type { CalendarItem } from '@/api/opsTypes';
import { formatDateIST } from '@/lib/format';
import { Async, ConfirmSheet, Group, isoToIst, OpsPage, todayIst, useGo, useOnce } from '@/features/ops/kit';
import { formatDateTimeIST, formatTimeIST } from '@/lib/format';

const KIND: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' | 'error' }> = {
  deadline: { label: 'Deadline', tone: 'warning' }, drive_closing: { label: 'Drive closes', tone: 'warning' }, interview: { label: 'Interview', tone: 'info' },
  assessment: { label: 'Assessment', tone: 'info' }, test: { label: 'Test', tone: 'info' }, offer_expiry: { label: 'Offer expires', tone: 'error' }, attendance: { label: 'Attendance', tone: 'neutral' },
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function CalendarScreen() {
  const toast = useToast();
  const go = useGo();
  const t = todayIst();
  const [view, setView] = useState<'month' | 'list'>('month');
  const [y, setY] = useState(Number(t.slice(0, 4)));
  const [m, setM] = useState(Number(t.slice(5, 7)) - 1);
  const [sel, setSel] = useState(t);
  const [feedOpen, setFeedOpen] = useState(false);

  // Month view: whole month. List view: today + 30 days (server default window).
  const range = useMemo(() => {
    if (view === 'month') {
      const from = new Date(Date.UTC(y, m, 1) - 330 * 60_000).toISOString();
      const to = new Date(Date.UTC(y, m + 1, 1) - 330 * 60_000).toISOString();
      return { from, to };
    }
    const from = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) - 330 * 60_000);
    return { from: from.toISOString(), to: new Date(from.getTime() + 30 * 86_400_000).toISOString() };
  }, [view, y, m, t]);
  const q = useCalendar(range.from, range.to);
  const items = q.data ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    items.forEach((i) => { const d = isoToIst(i.startsAt).date; map.set(d, [...(map.get(d) ?? []), i]); });
    return map;
  }, [items]);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m + delta, 1)); setY(d.getUTCFullYear()); setM(d.getUTCMonth());
    // keep the selected day inside the visible month, otherwise the list below looks empty for no reason
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    setSel(t.startsWith(key) ? t : `${key}-01`);
  };
  const firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const dayItems = view === 'month' ? byDay.get(sel) ?? [] : items;
  const open = (i: CalendarItem) => {
    if (i.driveId) go(`/(officer)/drive/${i.driveId}`);
  };

  return (
    <OpsPage title="Calendar" back="/(officer)/ops" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}
      right={<HeaderAction icon="rss-feed" label="Calendar feed link" onPress={() => setFeedOpen(true)} />}>
      <SegmentedControl value={view} onChange={(v) => setView(v as 'month' | 'list')} options={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'Next 30 days' }]} />

      {view === 'month' ? (
        <Group>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <HeaderAction icon="chevron-left" label="Previous month" onPress={() => shift(-1)} />
            <Text variant="subhead" accessibilityRole="header">{MONTHS[m]} {y}</Text>
            <HeaderAction icon="chevron-right" label="Next month" onPress={() => shift(1)} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            {DAYS.map((d) => <View key={d} style={{ flex: 1, alignItems: 'center' }}><Text variant="overline" color={colors.muted} style={{ fontSize: 11 }} maxFontSizeMultiplier={1.2}>{d}</Text></View>)}
          </View>
          {Array.from({ length: cells.length / 7 }).map((_, w) => (
            <View key={w} style={{ flexDirection: 'row' }}>
              {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                if (!d) return <View key={i} style={{ flex: 1, minHeight: MIN_TOUCH }} />;
                const key = ymd(y, m, d);
                const n = byDay.get(key)?.length ?? 0;
                const selected = key === sel;
                const today = key === t;
                return (
                  <Pressable key={i} onPress={() => setSel(key)} accessibilityRole="button" accessibilityState={{ selected }}
                    accessibilityLabel={`${d} ${MONTHS[m]}${n ? `, ${n} ${n === 1 ? 'event' : 'events'}` : ''}${today ? ', today' : ''}`}
                    style={{ flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.chip, backgroundColor: selected ? colors.primary : 'transparent', borderWidth: today && !selected ? 1 : 0, borderColor: colors.primary }}>
                    <Text variant="body" tabular color={selected ? colors.onPrimary : colors.ink} style={{ fontWeight: today || n ? '700' : '400' }} maxFontSizeMultiplier={1.3}>{d}</Text>
                    {n ? <Text variant="overline" tabular color={selected ? colors.onPrimary : colors.primary} style={{ fontSize: 10, lineHeight: 12 }} maxFontSizeMultiplier={1.2}>{n > 9 ? '9+' : n}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Text variant="caption" color={colors.muted}>The small number under a date is how many events fall on it.</Text>
        </Group>
      ) : null}

      <Text variant="subhead">{view === 'month' ? `Events on ${formatDateIST(`${sel}T00:00:00+05:30`)}` : 'Upcoming events'}</Text>
      <Async isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()} isEmpty={dayItems.length === 0}
        empty={{ icon: 'event-available', title: 'Nothing scheduled', message: view === 'month' ? 'No events on this day.' : 'No events in the next 30 days.' }} rows={2} rowHeight={80}>
        {dayItems.map((i) => {
          const k = KIND[i.kind] ?? { label: i.kind, tone: 'neutral' as const };
          return (
            <Pressable key={`${i.kind}-${i.id}`} onPress={i.driveId ? () => open(i) : undefined} accessibilityRole={i.driveId ? 'button' : undefined}
              style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6, minHeight: MIN_TOUCH }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="subhead" style={{ flexShrink: 1 }}>{i.title}</Text>
                <Badge label={k.label} tone={k.tone} />
              </View>
              <Text variant="caption" tabular color={colors.muted}>{view === 'list' ? formatDateTimeIST(i.startsAt) : `${formatTimeIST(i.startsAt)} IST`}{i.endsAt ? ` to ${formatTimeIST(i.endsAt)}` : ''}</Text>
              {i.detail ? <Text variant="caption" color={colors.textSecondary}>{i.detail}</Text> : null}
            </Pressable>
          );
        })}
      </Async>
      <FeedSheet visible={feedOpen} onClose={() => setFeedOpen(false)} toast={toast} />
    </OpsPage>
  );
}

function FeedSheet({ visible, onClose, toast }: { visible: boolean; onClose: () => void; toast: ReturnType<typeof useToast> }) {
  const status = useFeedToken();
  const mut = useFeedTokenMutations();
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revoke, setRevoke] = useState(false);
  const [revokeErr, setRevokeErr] = useState<string | null>(null);
  const origin = API_URL.replace(/\/api\/v1\/?$/, '');

  const [create, creating] = useOnce(async () => {
    setErr(null);
    try { const r = await mut.create(); setLink(r.url.startsWith('http') ? r.url : `${origin}${r.url}`); } catch (e) { setErr(errMessage(e)); }
  });
  const copy = useCopy();
  const shareLink = async () => { if (link) { try { await Share.share({ message: link }); } catch { /* dismissed */ } } };

  return (
    <>
    <Sheet visible={visible} onClose={onClose} title="Calendar feed link">
      <View style={{ gap: 16, paddingBottom: 16 }}>
        <Text variant="body" color={colors.textSecondary}>Add this link to Google Calendar or Apple Calendar to see your events there. Anyone with the link can see them, so keep it private.</Text>
        <Async isLoading={status.isLoading} isError={status.isError} error={status.error} onRetry={() => void status.refetch()} rows={1} rowHeight={56}>
          <Badge label={status.data?.active ? 'A link is active' : 'No link yet'} tone={status.data?.active ? 'success' : 'neutral'} />
          {link ? (
            <View style={{ gap: 12 }}>
              <Banner tone="warning" title="Copy it now" message="The link is shown only once. Creating a new one replaces the old link." />
              <CodeBlock label="Feed link" code={link} />
              <Button label="Copy link" icon="content-copy" full onPress={() => void copy(link, 'Link')} />
              <Button label="Share link" icon="ios-share" variant="secondary" full onPress={() => void shareLink()} />
            </View>
          ) : null}
          {err ? <Banner tone="error" message={err} /> : null}
          <Button label={status.data?.active ? 'Create a new link' : 'Create link'} icon="add-link" variant={link ? 'secondary' : 'primary'} full loading={creating} onPress={() => create()} />
          {status.data?.active ? <Button label="Revoke link" icon="link-off" variant="danger" full onPress={() => { setRevokeErr(null); setRevoke(true); }} /> : null}
        </Async>
      </View>
    </Sheet>
    <ConfirmSheet visible={revoke} onClose={() => setRevoke(false)} title="Revoke the link?" message="Calendars using it stop updating straight away." confirmLabel="Revoke" danger error={revokeErr}
        onConfirm={async () => { try { await mut.revoke(); setLink(null); setRevoke(false); toast.show('Link revoked', 'success'); } catch (e) { setRevokeErr(errMessage(e)); } }} />
    </>
  );
}
