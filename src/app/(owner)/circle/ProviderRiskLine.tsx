'use client';

/**
 * The channel warning we can give BEFORE anything has been sent.
 *
 * DeliveryLine can only speak once a provider event exists, which means the
 * first time an owner learns email is unreliable for somebody is after they
 * have already relied on it. This line needs no event at all — the address
 * itself is the evidence — so it is the one warning available at the moment the
 * owner is choosing how to reach the person.
 *
 * Shown in calm, on the row, for the same reason as everything else on this
 * screen: the same fact delivered during the emergency reaches an owner who is,
 * by hypothesis, not reading.
 *
 * The sentence and the judgement both live in `lib/notify/mailbox-provider.ts`,
 * including the rule that an UNMEASURED provider gets no line rather than a
 * reassuring one. This file is only the paint.
 *
 * Feature: relay-standby
 */

import { describeProviderRisk } from '../../../../lib/notify/mailbox-provider';

export default function ProviderRiskLine({ name, email }: { name: string; email: string }) {
  const text = describeProviderRisk({ name, email });
  if (!text) return null;

  return (
    <div style={{ fontSize: 'var(--t1)', color: 'var(--ochre-text)', marginTop: '4px' }}>{text}</div>
  );
}
