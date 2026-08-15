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
 * 🔴 IT WAS LEFT ON THE OLD PALETTE. When the Warm Archive system landed on
 * 2026-08-13 the root card was rebuilt and this one was missed, so for two days
 * the preview for the page PAID ADS LAND ON painted #020617 slate with #fcd34d
 * amber while the page itself rendered warm paper. Its sibling's header had
 * already written the verdict: a share card "advertised a product that looked
 * nothing like the one behind the link."
 *
 * Two things changed here, and only one of them is colour.
 *
 * THE COPY WAS SECOND PERSON, attached to an emergency: "Opens for YOU in a
 * real emergency." That is the exact shape `g1-ad-creatives.md` §1a rules out
 * — a prediction about the reader's own family — and the landing page was
 * rewritten to third person for it (`ratified.landing-copy-third-person`). The
 * card that previews that page kept the old voice, which is worse than a page
 * being wrong on its own: this is the surface a reviewer sees first.
 *
 * Colours are literals because Satori resolves no CSS variables, which is why
 * `raw-color.test.ts` exempts these files. `og-palette.test.ts` closes that
 * exemption's hole: a literal is allowed, an INVENTED literal is not.
 *
 * Feature: relay-g1-wtp
 */

import { ImageResponse } from 'next/og';

import { HEADLINE, PRICE_YEARLY_USD, WINNER_BADGE } from './content';

/* Warm Archive, from globals.css. Ochre uses its TEXT cut: plain --ochre
   measures 3.9:1 on paper, which is a contrast failure for wording. */
const PAPER = '#f7f4ee';
const INK = '#1f1b16';
const INK_MUTED = '#6b6257';
const INK_FAINT = '#71675a';
const OCHRE_TEXT = '#8a5a2b';
const OCHRE_SOFT = '#f6ead9';
const RULE_STRONG = '#cfc7b8';

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
          backgroundColor: PAPER,
          padding: '64px 72px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              border: `1px solid ${RULE_STRONG}`,
              backgroundColor: OCHRE_SOFT,
              color: OCHRE_TEXT,
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
              color: INK,
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
              color: INK_MUTED,
              maxWidth: 960,
              lineHeight: 1.4,
            }}
          >
            One encrypted vault for a parent&apos;s accounts. It opens exactly what was granted
            when a real emergency is verified — and seals itself again when they recover.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 27, color: OCHRE_TEXT }}>
            One price, the whole family — ${PRICE_YEARLY_USD}/year
          </div>
          <div style={{ display: 'flex', fontSize: 27, color: INK_FAINT }}>relaystandby.com</div>
        </div>
      </div>
    ),
    size,
  );
}
