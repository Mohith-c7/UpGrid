import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text, TextField } from '@/ui';
import { colors } from '@/theme';

/** Seconds remaining until `deadlineMs` (epoch ms); 0 when passed or null. Re-renders once per second while counting. */
export function useSecondsLeft(deadlineMs: number | null): number {
  const calc = () => (deadlineMs ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!deadlineMs) return;
    const id = setInterval(() => {
      const v = calc();
      setLeft(v);
      if (v <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs]);
  return left;
}

export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** 6-digit code input (digits only; one-time-code autofill hints). */
export function OtpField({
  value,
  onChange,
  error,
  editable = true,
  label = '6-digit code',
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  editable?: boolean;
  label?: string;
  onSubmit?: () => void;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      maxLength={6}
      placeholder="123456"
      autoComplete="sms-otp"
      textContentType="oneTimeCode"
      error={error}
      editable={editable}
      returnKeyType="done"
      onSubmitEditing={onSubmit}
    />
  );
}

/** "Code expires in 9:41" / "Code expired" line (icon + text, never colour alone). */
export function ExpiryLine({ expiresAt }: { expiresAt: number | null }) {
  const left = useSecondsLeft(expiresAt);
  if (!expiresAt) return null;
  const expired = left <= 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLiveRegion={expired ? 'polite' : 'none'}>
      <Icon name={expired ? 'timer-off' : 'timer'} size={20} color={expired ? colors.error : colors.muted} />
      <Text variant="caption" color={expired ? colors.error : colors.muted} tabular style={{ flex: 1 }}>
        {expired ? 'This code has expired. Request a new one.' : `Code expires in ${mmss(left)}`}
      </Text>
    </View>
  );
}

/** Resend button with cooldown label. Always tappable once the cooldown ends; `busy` locks it while sending. */
export function ResendButton({ resendAt, onResend, label = 'Resend code', disabled }: { resendAt: number | null; onResend: () => Promise<void> | void; label?: string; disabled?: boolean }) {
  const left = useSecondsLeft(resendAt);
  const waiting = left > 0;
  return (
    <Button
      label={waiting ? `${label} in ${left}s` : label}
      variant="secondary"
      full
      disabled={waiting || disabled}
      accessibilityLabel={waiting ? `${label}, available in ${left} seconds` : label}
      onPress={onResend}
    />
  );
}
