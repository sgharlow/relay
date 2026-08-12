'use client';

/**
 * Could this person still get in if they lost their phone?
 *
 * THE QUESTION NOBODY COULD ANSWER. A confirmed verifier whose device is gone,
 * with no passkey and no emergency code, cannot act at all — and the product
 * said nothing, so the owner discovered it during the emergency or not at all.
 * It is also the precondition for ever ceasing to mint release-time codes:
 * "everybody has a fallback" was unknowable from inside the product, so it could
 * not be relied on.
 *
 * ONLY SHOWN FOR SOMEBODY WHO HAS CLAIMED. For an unclaimed contact the way back
 * in is simply their invitation, which the light and the invite control already
 * cover; adding a second warning there would be noise on the row that is already
 * the loudest.
 *
 * The state that matters is the ABSENCE, so that is the one that gets a colour.
 * A person with a passkey is the quiet, good case and should read as settled.
 *
 * Feature: relay-standby
 * Requirements: J4-R13
 */

export default function FallbackLine({
  name,
  hasPasskey,
  hasBreakGlass,
}: {
  name: string;
  hasPasskey: boolean;
  hasBreakGlass: boolean;
}) {
  // A passkey is evidence of a device they actually used. An unredeemed code is
  // weaker evidence — it proves one was ISSUED, not that they can still find it
  // — so it is worded as a fallback rather than as cover.
  if (hasPasskey) {
    return (
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
        Can sign in on a new device{hasBreakGlass ? ', and holds an emergency code' : ''}.
      </div>
    );
  }

  if (hasBreakGlass) {
    return (
      <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: '4px' }}>
        No passkey — an emergency code is their only way back in. Worth checking {name} still knows
        where it is.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 'var(--t1)', color: 'var(--clay)', marginTop: '4px' }}>
      If {name} loses the device they signed in on, they cannot get back in. Give them an emergency
      code, or ask them to add a passkey.
    </div>
  );
}
