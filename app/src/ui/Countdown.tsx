import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { colors, urgentColors } from '@/theme';
import { Text } from './Text';
import { Icon } from './Icon';
import { durationText } from '@/lib/format';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function countdownLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Closed';
  const s = Math.floor(remainingMs / 1000);
  if (remainingMs < 3600 * 1000) return `${pad(Math.floor(s / 60))}:${pad(s % 60)} left`;
  return `${durationText(remainingMs)} left`;
}

export function Countdown({
  deadline,
  serverOffsetMs = 0,
  onExpire,
  compact,
}: {
  deadline: string;
  serverOffsetMs?: number;
  onExpire?: () => void;
  compact?: boolean;
}) {
  const target = Date.parse(deadline);
  const remaining = () => (Number.isNaN(target) ? 0 : target - (Date.now() + serverOffsetMs));
  const [rem, setRem] = useState(remaining);
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const r = remaining();
      setRem(r);
      if (r <= 0) {
        if (!fired.current) {
          fired.current = true;
          onExpire?.();
        }
        return;
      }
      t = setTimeout(tick, r < 3600 * 1000 ? 1000 : 30000);
    };
    tick();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, serverOffsetMs]);

  const expired = rem <= 0;
  const urgent = !expired && rem < 3600 * 1000;
  const soon = !expired && !urgent && rem < 24 * 3600 * 1000;
  const color = expired ? colors.muted : urgent ? urgentColors.fg : soon ? colors.warning : colors.ink;
  const text = countdownLabel(rem);
  // the spoken label deliberately omits seconds so screen readers are not flooded
  const spoken = expired ? 'Applications closed' : `Closes in ${durationText(rem)}`;
  return (
    <View accessible accessibilityLabel={spoken} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={expired ? 'lock-clock' : urgent ? 'timer' : 'schedule'} size={compact ? 16 : 20} color={color} />
      <Text variant={compact ? 'caption' : 'subhead'} color={color} tabular style={{ fontWeight: '600' }}>
        {text}
      </Text>
    </View>
  );
}
