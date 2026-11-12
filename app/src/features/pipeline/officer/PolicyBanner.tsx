import React from 'react';
import { Banner } from '@/ui';
import type { OfferPolicy } from '@/api/pipelineTypes';

const TIER: Record<string, string> = { regular: 'Regular', dream: 'Dream', super_dream: 'Super dream' };

/** Outcome of the placement policy check: icon + text, never colour only. */
export function PolicyBanner({ policy, tier }: { policy: OfferPolicy & { tier?: string }; tier?: string }) {
  const t = tier ?? policy.tier;
  const reasons = policy.reasons?.map((r) => r.message).join(' ');
  const tierText = t ? ` Tier: ${TIER[t] ?? t}.` : '';
  if (policy.result === 'allowed') return <Banner tone="success" title="Allowed by policy" message={`Nothing in the placement policy stops this offer.${tierText}${reasons ? ` ${reasons}` : ''}`} />;
  if (policy.result === 'needs_override') return <Banner tone="warning" title="Needs an override" message={`${reasons || 'The placement policy needs an override reason for this offer.'}${tierText}`} />;
  return <Banner tone="error" title="Blocked by policy" message={`${reasons || 'The placement policy does not allow this offer.'}${tierText}`} />;
}
