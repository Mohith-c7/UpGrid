import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Icon, Text } from '@/ui';
import { colors, MIN_TOUCH, radius } from '@/theme';
import { getServerOffsetMs } from '@/api/client';
import { nowISTParts, type ISTParts } from '../format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

export function describeIST(p: ISTParts): string {
  const dow = DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${dow}, ${pad(p.d)} ${MONTHS[p.m - 1]} ${p.y}, ${pad(h12)}:${pad(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'} IST`;
}
export const dateLabel = (p: ISTParts) => `${DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]}, ${pad(p.d)} ${MONTHS[p.m - 1]} ${p.y}`;
export const timeLabel = (p: ISTParts) => `${pad(p.hh % 12 === 0 ? 12 : p.hh % 12)}:${pad(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'}`;

/** The native picker works in device time. We hand it a Date whose LOCAL fields equal the IST wall clock and read local fields back, so the result is correct whatever the phone's time zone is. */
export const toPickerDate = (p: ISTParts) => new Date(p.y, p.m - 1, p.d, p.hh, p.mm, 0, 0);

export function PickerRow({ label, value, icon, onPress, error }: { label: string; value: string; icon: 'event' | 'schedule'; onPress?: () => void; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" color={colors.textSecondary} style={{ fontWeight: '600' }}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Tap to change`}
        style={({ pressed }) => ({
          minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: error ? 2 : 1, borderColor: error ? colors.error : colors.borderStrong,
          borderRadius: radius.input, paddingHorizontal: 14, backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
        })}
      >
        <Icon name={icon} size={22} color={colors.primary} />
        <Text variant="body" tabular style={{ flex: 1, fontWeight: '500' }}>{value}</Text>
        <Icon name="expand-more" size={22} color={colors.subtle} />
      </Pressable>
    </View>
  );
}

/**
 * Date + time picking in IST. Android opens the native dialogs; iOS shows an inline spinner under the rows.
 * `value` is IST wall-clock parts; `onChange` receives the new parts.
 */
export function useISTPicker(value: ISTParts, onChange: (p: ISTParts) => void, opts?: { allowPast?: boolean }) {
  const [ios, setIos] = useState<'date' | 'time' | null>(null);
  const apply = (e: DateTimePickerEvent, d: Date | undefined, field: 'date' | 'time') => {
    if (e.type !== 'set' || !d) return;
    onChange(field === 'date'
      ? { ...value, y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
      : { ...value, hh: d.getHours(), mm: d.getMinutes() });
  };
  const open = (field: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toPickerDate(value), mode: field, is24Hour: false,
        minimumDate: field === 'date' && !opts?.allowPast ? toPickerDate({ ...nowISTParts(getServerOffsetMs()), hh: 0, mm: 0 }) : undefined,
        onChange: (e, d) => apply(e, d, field),
      });
    } else setIos((cur) => (cur === field ? null : field));
  };
  const iosPicker = Platform.OS === 'ios' && ios ? (
    <DateTimePicker value={toPickerDate(value)} mode={ios} display="spinner" minimumDate={ios === 'date' && !opts?.allowPast ? toPickerDate({ ...nowISTParts(getServerOffsetMs()), hh: 0, mm: 0 }) : undefined} onChange={(e, d) => apply(e, d, ios)} />
  ) : null;
  return { open, iosPicker, close: () => setIos(null) };
}
