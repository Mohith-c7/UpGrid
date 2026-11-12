import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Switch, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Badge, Banner, Button, Card, SectionHeader, Text, TextField, useToast } from '@/ui';
import { colors } from '@/theme';
import type { ReminderSettings } from '@/api/types';
import { errMessage, useReminderMutations, useReminderSettings } from '@/features/student/me/data';
import { confirm, Page, QueryBoundary, sp, useBack, useOnce } from '@/features/student/me/kit';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmError = (v: string) => (HHMM.test(v.trim()) ? null : 'Use 24-hour HH:mm, for example 22:00');

type PermState = 'granted' | 'denied' | 'undetermined' | 'unknown';

function SwitchRow({ title, subtitle, value, onChange, disabled, last }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, backgroundColor: pressed ? colors.pressed : 'transparent', opacity: disabled ? 0.6 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" style={{ fontWeight: '500' }}>{title}</Text>
        {subtitle ? <Text variant="caption" color={colors.muted}>{subtitle}</Text> : null}
      </View>
      <Switch accessible={false} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor={colors.surface} />
    </Pressable>
  );
}

/** "2200" -> "22:00" while typing. */
function maskTime(t: string): string {
  const d = t.replace(/[^0-9]/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

export default function RemindersScreen() {
  const toast = useToast();
  const back = useBack('/(student)/(tabs)/profile');
  const q = useReminderSettings();
  const { save, reset } = useReminderMutations();
  const s = q.data;
  const [perm, setPerm] = useState<PermState>('unknown');
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('07:00');
  const [qhErr, setQhErr] = useState<{ start?: string; end?: string }>({});
  const synced = useRef('');

  useEffect(() => {
    if (!s) return;
    const sig = `${s.quietHours.start}-${s.quietHours.end}`;
    if (synced.current !== sig) { synced.current = sig; setStart(s.quietHours.start); setEnd(s.quietHours.end); }
  }, [s]);

  const refreshPerm = useCallback(async () => {
    try { const r = await Notifications.getPermissionsAsync(); setPerm(r.granted ? 'granted' : r.canAskAgain === false || r.status === 'denied' ? 'denied' : 'undetermined'); }
    catch { setPerm('unknown'); }
  }, []);
  useEffect(() => {
    refreshPerm();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refreshPerm(); });
    return () => sub.remove();
  }, [refreshPerm]);

  const [toggle, toggling] = useOnce(async (patch: Partial<ReminderSettings>) => {
    try { await save.mutateAsync(patch); } catch (e) { toast.show(`Not saved: ${errMessage(e)}`, 'error'); }
  });
  const [saveQuiet, savingQuiet] = useOnce(async () => {
    const e1 = hhmmError(start), e2 = hhmmError(end);
    setQhErr({ start: e1 ?? undefined, end: e2 ?? undefined });
    if (e1 || e2) return;
    if (start.trim() === end.trim()) { setQhErr({ end: 'Start and end cannot be the same' }); return; }
    try { await save.mutateAsync({ quietHours: { start: start.trim(), end: end.trim() } }); toast.show('Quiet hours saved', 'success'); }
    catch (e) { toast.show(`Not saved: ${errMessage(e)}`, 'error'); }
  });
  const [doReset, resetting] = useOnce(async () => {
    try { await reset.mutateAsync(); toast.show('Defaults restored', 'success'); } catch (e) { toast.show(errMessage(e), 'error'); }
  });
  const [askPerm, asking] = useOnce(async () => { try { await Notifications.requestPermissionsAsync(); } catch { /* ignore */ } await refreshPerm(); });

  const noTimes = s && !s.t60 && !s.t30 && !s.t15;
  const noChannel = s && !s.push && !s.inApp;
  const quietDirty = !!s && (start.trim() !== s.quietHours.start || end.trim() !== s.quietHours.end);

  return (
    <Page title="Reminders" onBack={back} keyboard onRefresh={() => q.refetch()} refreshing={q.isRefetching} gap={sp.xl}>
      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()} skeletonRows={4} skeletonHeight={110}>
        {s ? (
          <View style={{ gap: sp.xl }}>
            <Text variant="body" color={colors.muted}>Get a nudge before a drive you can apply to closes. Reminders stop once you apply or the deadline passes. Changes save as you switch.</Text>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="When" />
              <Card>
                <SwitchRow title="60 minutes before" value={s.t60} disabled={toggling} onChange={(v) => toggle({ t60: v })} />
                <SwitchRow title="30 minutes before" value={s.t30} disabled={toggling} onChange={(v) => toggle({ t30: v })} />
                <SwitchRow title="15 minutes before" value={s.t15} disabled={toggling} onChange={(v) => toggle({ t15: v })} last />
              </Card>
              {noTimes ? <Banner tone="warning" message="All three are off, so you will get no deadline reminders. You can still see deadlines in each drive." /> : null}
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="How" />
              <Card>
                <SwitchRow title="Push notifications" subtitle="Alerts on this phone" value={s.push} disabled={toggling} onChange={(v) => toggle({ push: v })} />
                <SwitchRow title="In-app notifications" subtitle="Listed under Notifications" value={s.inApp} disabled={toggling} onChange={(v) => toggle({ inApp: v })} last />
              </Card>
              {noChannel ? <Banner tone="warning" message="Push and in-app are both off, so reminders will not reach you anywhere." /> : null}
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Phone permission" />
              <Card>
                <View style={{ gap: sp.md }}>
                  <View style={{ gap: sp.xs }}>
                    <Text variant="body" style={{ fontWeight: '500' }}>Notifications on this phone</Text>
                    <Badge
                      label={perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked' : perm === 'undetermined' ? 'Not asked yet' : 'Unknown'}
                      tone={perm === 'granted' ? 'success' : perm === 'denied' ? 'error' : 'warning'}
                      icon={perm === 'granted' ? 'notifications-active' : perm === 'denied' ? 'notifications-off' : 'notifications-none'}
                    />
                  </View>
                  {perm === 'granted' ? <Text variant="caption" color={colors.muted}>Push reminders can reach this phone, subject to your battery and Do Not Disturb settings.</Text> : null}
                  {perm === 'denied' ? <Text variant="caption" color={colors.error}>Your phone blocks notifications for this app, so push reminders will not arrive even if switched on. In-app reminders still work.</Text> : null}
                  {perm === 'undetermined' ? <Text variant="caption" color={colors.muted}>Allow notifications so push reminders can reach you.</Text> : null}
                  {perm === 'unknown' ? <Text variant="caption" color={colors.muted}>Could not read the permission. Open settings to check it.</Text> : null}
                  {perm === 'undetermined' ? <Button label="Allow notifications" variant="secondary" full loading={asking} onPress={() => askPerm()} /> : null}
                  {perm !== 'granted' ? <Button label="Open phone settings" variant="secondary" full onPress={async () => { try { await Linking.openSettings(); } catch { toast.show('Could not open settings', 'error'); } }} /> : null}
                </View>
              </Card>
            </View>

            <View style={{ gap: sp.md }}>
              <SectionHeader title="Quiet hours" subtitle="India Standard Time" />
              <Card>
                <SwitchRow title="Pause push during quiet hours" subtitle="In-app reminders are still delivered" value={s.quietHours.enabled} disabled={toggling} onChange={(v) => toggle({ quietHours: { ...s.quietHours, enabled: v } })} last />
                <View style={{ gap: sp.lg, marginTop: sp.md }}>
                  <View style={{ flexDirection: 'row', gap: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Start (HH:mm)" value={start} onChangeText={(t) => { setStart(maskTime(t)); setQhErr((e) => ({ ...e, start: undefined })); }} error={qhErr.start} keyboardType="number-pad" maxLength={5} placeholder="22:00" onBlur={() => setQhErr((e) => ({ ...e, start: hhmmError(start) ?? undefined }))} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField label="End (HH:mm)" value={end} onChangeText={(t) => { setEnd(maskTime(t)); setQhErr((e) => ({ ...e, end: undefined })); }} error={qhErr.end} keyboardType="number-pad" maxLength={5} placeholder="07:00" onBlur={() => setQhErr((e) => ({ ...e, end: hhmmError(end) ?? undefined }))} />
                    </View>
                  </View>
                  <Text variant="caption" color={colors.muted}>24-hour times. A window like 22:00 to 07:00 runs overnight. A reminder that falls inside it arrives in the app only.</Text>
                  <Button label="Save quiet hours" full loading={savingQuiet} disabled={!quietDirty} onPress={() => saveQuiet()} />
                </View>
              </Card>
            </View>

            <Button label="Restore defaults" variant="ghost" icon="restore" full loading={resetting}
              onPress={() => confirm('Restore defaults?', 'All three reminder times, push and in-app turn on, and quiet hours turn off.', 'Restore', () => doReset(), false)} />
          </View>
        ) : null}
      </QueryBoundary>
    </Page>
  );
}
