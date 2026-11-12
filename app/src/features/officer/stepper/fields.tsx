import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Checkbox, Chip, Icon, Text, TextField } from '@/ui';
import { colors, MIN_TOUCH, radius } from '@/theme';
import { spacing } from '../layout';
import { Row } from '../components/common';
import { formatIST, isoToISTParts, istPartsToISO, nowISTParts, type ISTParts } from '../format';
import { dateLabel, PickerRow, timeLabel, useISTPicker } from '../components/pickers';

/** Numeric text field that keeps raw text while typing. onValue gets number | null (blank). Invalid keystrokes are blocked. */
export function NumField(props: {
  label: string; value: number | null | undefined; onValue: (v: number | null) => void; error?: string; helper?: string;
  decimals?: number; integer?: boolean; prefix?: string; intDigits?: number;
}) {
  const [text, setText] = useState(props.value == null || Number.isNaN(props.value) ? '' : String(props.value));
  const re = props.integer ? /^\d{0,3}$/ : new RegExp(`^\\d{0,${props.intDigits ?? 4}}(\\.\\d{0,${props.decimals ?? 2}})?$`);
  return (
    <TextField
      label={props.label} value={text} prefix={props.prefix} error={props.error} helper={props.helper}
      keyboardType={props.integer ? 'number-pad' : 'decimal-pad'}
      onChangeText={(t) => {
        const c = t.replace(',', '.');
        if (!re.test(c)) return; // block invalid keystrokes (negatives, letters, 3rd decimal)
        setText(c);
        if (c === '' || c === '.') props.onValue(null);
        else props.onValue(Number(c));
      }}
    />
  );
}

/** Yes/no switch row (checkbox, 48dp). */
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Checkbox checked={value} onChange={onChange} accessibilityLabel={label}>
      <Text variant="body">{label}</Text>
    </Checkbox>
  );
}

/** Removable tag: label + close icon, 48dp tall touch target, announced as "Remove X". */
function TagChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
      style={{ minHeight: MIN_TOUCH, maxWidth: '100%', justifyContent: 'center' }}
    >
      <View style={{ minHeight: 36, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryTint }}>
        <Text variant="caption" color={colors.primaryDark} numberOfLines={1} style={{ fontWeight: '600', flexShrink: 1 }}>{label}</Text>
        <Icon name="close" size={18} color={colors.primaryDark} />
      </View>
    </Pressable>
  );
}

/** Free-text list builder (locations, departments). */
export function TagsInput({ label, values, onChange, error, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; error?: string; placeholder?: string }) {
  const [t, setT] = useState('');
  const add = () => {
    const parts = t.split(',').map((x) => x.trim()).filter((x, i, a) => x && x.length <= 60 && !values.includes(x) && a.indexOf(x) === i);
    if (parts.length) onChange([...values, ...parts].slice(0, 20));
    setT('');
  };
  return (
    <View style={{ gap: spacing[2] }}>
      <TextField
        label={label} value={t} onChangeText={setT} onBlur={add} onSubmitEditing={add} returnKeyType="done" error={error}
        helper={placeholder ?? 'Type and tap Add. Separate several with commas.'} maxLength={120}
      />
      <View style={{ flexDirection: 'row' }}><Button label="Add" icon="add" variant="secondary" size="sm" disabled={!t.trim()} onPress={add} /></View>
      {values.length > 0 ? <Row wrap gap={spacing[2]}>{values.map((v) => <TagChip key={v} label={v} onRemove={() => onChange(values.filter((x) => x !== v))} />)}</Row> : null}
    </View>
  );
}

const defaultParts = (offsetMs: number): ISTParts => {
  const n = nowISTParts(offsetMs);
  const t = new Date(Date.UTC(n.y, n.m - 1, n.d + 7, 17, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: 17, mm: 0 };
};

/** Timezone-aware (fixed IST) date + time picker with native dialogs. value/onChange are UTC ISO strings. */
export function ISTDateTimeField({ label, value, onChange, error, serverOffsetMs, helper }: {
  label: string; value: string | null; onChange: (iso: string | null) => void; error?: string; serverOffsetMs: number; helper?: string;
}) {
  const parts = isoToISTParts(value) ?? defaultParts(serverOffsetMs);
  const picker = useISTPicker(parts, (p) => onChange(istPartsToISO(p)));
  const quick = (days: number, hh: number) => {
    const n = nowISTParts(serverOffsetMs);
    const b = new Date(Date.UTC(n.y, n.m - 1, n.d + days));
    onChange(istPartsToISO({ y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(), hh, mm: 0 }));
  };
  return (
    <View style={{ gap: spacing[3] }}>
      <Text variant="subhead">{label}</Text>
      <PickerRow label="Date (IST)" icon="event" value={value ? dateLabel(parts) : 'Choose a date'} error={error} onPress={() => picker.open('date')} />
      <PickerRow label="Time (IST)" icon="schedule" value={value ? timeLabel(parts) : 'Choose a time'} error={error} onPress={() => picker.open('time')} />
      {picker.iosPicker}
      <Row wrap gap={spacing[2]}>
        <Chip label="Tomorrow 5 PM" onPress={() => quick(1, 17)} />
        <Chip label="In 3 days" onPress={() => quick(3, 17)} />
        <Chip label="In 7 days" onPress={() => quick(7, 17)} />
      </Row>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLiveRegion="polite">
          <Icon name="error-outline" size={20} color={colors.error} />
          <Text variant="caption" color={colors.error} style={{ flex: 1, fontWeight: '500' }}>{error}</Text>
        </View>
      ) : (
        <Text variant="caption" color={colors.muted} tabular>{value ? `${formatIST(value)} (times are in IST, UTC+5:30)` : helper ?? 'All times are in IST (UTC+5:30)'}</Text>
      )}
    </View>
  );
}
