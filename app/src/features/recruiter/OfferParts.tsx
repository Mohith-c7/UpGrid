import React from 'react';
import { View } from 'react-native';
import { Badge, Banner, Text } from '@/ui';
import { colors } from '@/theme';
import type { Offer, PolicyResult } from '@/api/recruiterTypes';

const META = {
  allowed: { label: 'Policy: allowed', tone: 'success', icon: 'check-circle' },
  needs_override: { label: 'Policy: needs officer override', tone: 'warning', icon: 'warning-amber' },
  blocked: { label: 'Policy: blocked', tone: 'error', icon: 'block' },
} as const;

export function PolicyBadge({ result }: { result: PolicyResult['result'] }) {
  const m = META[result];
  return <Badge label={m.label} tone={m.tone} icon={m.icon as never} />;
}

/** Result of the placement-policy check, with the reason codes the server returned. Meaning is text + icon, never colour only. */
export function PolicyResultBanner({ policy }: { policy: PolicyResult }) {
  const tone = policy.result === 'allowed' ? 'success' : policy.result === 'needs_override' ? 'warning' : 'error';
  const title = policy.result === 'allowed' ? 'Allowed by placement policy' : policy.result === 'needs_override' ? 'Needs an officer override' : 'Blocked by placement policy';
  const hint =
    policy.result === 'allowed' ? 'This offer fits the policy.'
      : policy.result === 'needs_override' ? 'You can still send it. It goes to the placement cell flagged for approval with an override.'
        : 'This offer cannot be sent as it is.';
  return (
    <Banner tone={tone} title={title} message={[hint, ...policy.reasons.map((r) => `${r.message}`)].join('\n')} />
  );
}

export function PolicyReasons({ policy }: { policy: PolicyResult }) {
  if (!policy.reasons?.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {policy.reasons.map((r) => <Text key={r.code} variant="caption" color={colors.muted}>{r.message}</Text>)}
    </View>
  );
}

/** Total pay in LPA (rupees per month for stipend offers). Prefers the server total. */
export function offerTotal(o: Offer): number {
  if (o.ctc.totalLpa != null) return o.ctc.totalLpa;
  return (o.ctc.fixedLpa ?? 0) + (o.ctc.variableLpa ?? 0) + (o.ctc.bonusLpa ?? 0) + (o.ctc.joiningBonusLpa ?? 0) + (o.ctc.other ?? []).reduce((n, x) => n + x.amountLpa, 0);
}

