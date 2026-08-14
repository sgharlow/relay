/**
 * Social share card (1200x630) — what LinkedIn, X, Slack, and iMessage render when
 * the site is linked. Generated at the edge with next/og; no binary asset committed
 * and no external font fetch (system fallback only, so the build cannot be broken by
 * a blocked font request).
 *
 * Satori subset: flexbox only, explicit display:flex on any multi-child node.
 *
 * 🔴 THIS CARD WAS OFF-PALETTE UNTIL 2026-08-13. It painted #020617 with #3b82f6
 * and #fbbf24 — Tailwind slate, blue and amber, from before the Warm Archive
 * system in globals.css existed. It is the single most-seen surface the brand
 * has (every link anybody pastes anywhere), and it advertised a product that
 * looked nothing like the one behind the link.
 *
 * Rebuilt in the real palette, and quieter. A share card for THIS product
 * competes in a feed full of shouting, and the thing being offered is calm.
 *
 * TWO CHANGES OF SUBSTANCE, not just colour:
 *
 *   THE STATE ROW NO LONGER ENDS AT "RELEASED". It read ARMED → PENDING →
 *   GRACE → RELEASED, which tells a stranger the story finishes with everything
 *   open. It finishes with the owner coming back: the row now returns to ARMED,
 *   which is both true and the thing a nervous reader needs to know first.
 *
 *   THE ESTATE SENTENCE IS GONE. The old subtitle promised "estate handoffs are
 *   permanent" — a capability withdrawn from the product on 2026-08-14
 *   (PROJECT.yaml → gates → g2-counsel-opinion.declined) and disclaimed by
 *   /terms. The share card was still selling it.
 *
 * Literal hex throughout, deliberately: Satori resolves no CSS variables, so a
 * token would render as nothing. lib/ops/raw-color.test.ts exempts this file by
 * name for exactly that reason. The values are the current --paper, --ink,
 * --ink-muted, --rule, --sage and --ochre.
 *
 * Feature: relay-h0-mvp (post-win share surface)
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Relay — standby access for the people who will need it';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#f7f4ee';
const PAPER_RAISED = '#fffdf9';
const INK = '#1f1b16';
const INK_MUTED = '#6b6257';
const INK_FAINT = '#71675a';
const RULE = '#e3dccf';
const RULE_STRONG = '#cfc7b8';
const SAGE = '#4f7a6b';
const SAGE_SOFT = '#e6ede9';
const OCHRE = '#b4703a';

/** Ends where it began. See the note above. */
const STATES = ['Armed', 'Pending', 'Grace', 'Released', 'Armed'] as const;

/** One of the five standing by. `settled` = has confirmed. */
function Figure({ settled }: { settled: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          border: `3px solid ${INK}`,
        }}
      />
      <div
        style={{
          display: 'flex',
          width: 46,
          height: 23,
          marginTop: 5,
          borderTopLeftRadius: 23,
          borderTopRightRadius: 23,
          border: `3px solid ${INK}`,
          borderBottom: 'none',
        }}
      />
      {/* Settled ground — the same device the illustrations use for "confirmed". */}
      <div
        style={{
          display: 'flex',
          width: 62,
          height: 14,
          marginTop: 6,
          borderRadius: 31,
          backgroundColor: settled ? SAGE_SOFT : 'transparent',
          border: `2px solid ${settled ? SAGE : RULE_STRONG}`,
        }}
      />
    </div>
  );
}

export default function OpengraphImage() {
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
          padding: '58px 72px',
        }}
      >
        {/* ── The mark, then the words. ─────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 21, height: 21, borderRadius: 11, backgroundColor: INK }} />
            <div
              style={{
                width: 17,
                height: 17,
                borderRadius: 9,
                border: `5px solid ${OCHRE}`,
                marginLeft: 9,
                marginBottom: 14,
              }}
            />
            <div style={{ display: 'flex', marginLeft: 16, fontSize: 27, color: INK_FAINT }}>
              Relay
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 34,
              fontSize: 70,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: 720,
            }}
          >
            Standby access for the people who&apos;ll need it.
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 24,
              fontSize: 28,
              color: INK_MUTED,
              maxWidth: 640,
              lineHeight: 1.4,
            }}
          >
            An encrypted vault that opens only when the people you trust say so —
            and closes again when you come back.
          </div>
        </div>

        {/* ── The circle, standing by around a shut vault. ───────────────── */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 236,
            left: 748,
            alignItems: 'flex-end',
          }}
        >
          <Figure settled />
          <div style={{ display: 'flex', width: 22 }} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 132,
              height: 132,
              borderRadius: 15,
              backgroundColor: PAPER_RAISED,
              border: `3px solid ${INK}`,
            }}
          >
            {/* The dial: concentric, no pointer — a pointer makes it a clock. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 26,
                border: `3px solid ${INK}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  border: `2px solid ${RULE_STRONG}`,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: INK }} />
              </div>
            </div>
            {/* Armed. The one spot of colour on the card. */}
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: 6,
                backgroundColor: SAGE,
                marginTop: 14,
              }}
            />
          </div>
          <div style={{ display: 'flex', width: 22 }} />
          <Figure settled />
        </div>

        {/* ── The states, as a loop rather than a one-way trip. ──────────── */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {STATES.map((s, i) => (
            <div key={`${s}-${i}`} style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 999,
                  padding: '8px 18px',
                  fontSize: 21,
                  border: `1px solid ${s === 'Armed' ? SAGE : RULE}`,
                  backgroundColor: s === 'Armed' ? SAGE_SOFT : PAPER_RAISED,
                  color: s === 'Armed' ? '#365547' : INK_MUTED,
                }}
              >
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 6,
                    marginRight: 10,
                    backgroundColor: s === 'Armed' ? SAGE : OCHRE,
                  }}
                />
                {s}
              </div>
              {i < STATES.length - 1 && (
                <div style={{ display: 'flex', color: RULE_STRONG, padding: '0 10px', fontSize: 22 }}>
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
