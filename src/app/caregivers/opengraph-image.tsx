/**
 * Social share card for the paid caregiver landing page (1200x630).
 *
 * WHY A SECOND CARD. The root card at src/app/opengraph-image.tsx sells to
 * builders — it shows the ARMED→PENDING→GRACE→RELEASED state machine and the
 * words "Aurora DSQL · AWS KMS". That is the right card for a hackathon link and
 * exactly the wrong one for an adult child seeing this shared on Facebook. This
 * is the audience the ad spend is buying, so the preview it produces should
 * speak to them.
 *
 * It also restores an image that briefly went missing: adding an explicit
 * `openGraph` block to page.tsx overrode the inherited root image, and a
 * file-based card in this segment is the durable fix rather than hardcoding a
 * path back to the root one.
 *
 * Satori subset: flexbox only, explicit display:flex on any multi-child node,
 * no external font fetch (a blocked font request must not break the build).
 *
 * Feature: relay-g1-wtp
 */

import { ImageResponse } from 'next/og';

import { HEADLINE, PRICE_YEARLY_USD, WINNER_BADGE } from './content';

export const runtime = 'edge';
export const alt = 'Relay for caregivers — emergency access that closes itself';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function CaregiverOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#020617',
          padding: '64px 72px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: '#fcd34d',
              borderRadius: 999,
              padding: '10px 22px',
              fontSize: 24,
            }}
          >
            {WINNER_BADGE}
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 40,
              fontSize: 82,
              fontWeight: 700,
              color: '#f8fafc',
              lineHeight: 1.06,
              letterSpacing: '-0.02em',
              maxWidth: 1010,
            }}
          >
            {HEADLINE}
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 28,
              fontSize: 31,
              color: '#94a3b8',
              maxWidth: 960,
              lineHeight: 1.4,
            }}
          >
            One encrypted vault for a parent&apos;s accounts. Opens for you in a real emergency —
            and seals itself again when they recover.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 27, color: '#fcd34d' }}>
            One price, the whole family — ${PRICE_YEARLY_USD}/year
          </div>
          <div style={{ display: 'flex', fontSize: 27, color: '#64748b' }}>relaystandby.com</div>
        </div>
      </div>
    ),
    size,
  );
}
