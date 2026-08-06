/**
 * Social share card (1200x630) — what LinkedIn, X, Slack, and iMessage render when
 * the site is linked. Generated at the edge with next/og; no binary asset committed
 * and no external font fetch (system fallback only, so the build cannot be broken by
 * a blocked font request).
 *
 * Satori subset: flexbox only, explicit display:flex on any multi-child node.
 *
 * Feature: relay-h0-mvp (post-win share surface)
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Relay — standby access for the people who will need it';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const STATES = ['ARMED', 'PENDING', 'GRACE', 'RELEASED'] as const;

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
            Winner — Most Impactful · H0: Hack the Zero Stack
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 38,
              fontSize: 74,
              fontWeight: 700,
              color: '#f8fafc',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: 1000,
            }}
          >
            Standby access for the people who&apos;ll need it.
          </div>

          <div
            style={{
              display: 'flex',
              marginTop: 26,
              fontSize: 29,
              color: '#94a3b8',
              maxWidth: 940,
              lineHeight: 1.4,
            }}
          >
            An encrypted vault with scoped, reversible access — emergencies close
            themselves, estate handoffs are permanent.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STATES.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    display: 'flex',
                    borderRadius: 8,
                    padding: '9px 17px',
                    fontSize: 21,
                    border:
                      s === 'ARMED'
                        ? '1px solid rgba(16, 185, 129, 0.45)'
                        : s === 'RELEASED'
                          ? '1px solid rgba(245, 158, 11, 0.45)'
                          : '1px solid #334155',
                    backgroundColor:
                      s === 'ARMED'
                        ? 'rgba(16, 185, 129, 0.12)'
                        : s === 'RELEASED'
                          ? 'rgba(245, 158, 11, 0.12)'
                          : 'rgba(15, 23, 42, 0.7)',
                    color: s === 'ARMED' ? '#6ee7b7' : s === 'RELEASED' ? '#fcd34d' : '#cbd5e1',
                  }}
                >
                  {s}
                </div>
                {i < STATES.length - 1 && (
                  <div style={{ display: 'flex', color: '#475569', padding: '0 11px', fontSize: 22 }}>
                    →
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', fontSize: 23, color: '#64748b' }}>Aurora DSQL · AWS KMS</div>
        </div>
      </div>
    ),
    size,
  );
}
