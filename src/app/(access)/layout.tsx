/**
 * AccessLayout — what a recipient sees during an emergency.
 *
 * The production audit's load-bearing finding was that this was owner mode with
 * different words. The difference is now structural rather than decorative, and
 * declared here rather than page by page:
 *
 *   face      Newsreader, not Public Sans — anything you read looks written
 *   measure   620px centred, no rail
 *   floor     18px body, 20px for instructions
 *   density   one decision per screen
 *   chrome    none. No nav, no settings, no upsell, nothing to buy
 *   voice     names the owner: "Robert chose this"
 *
 * The test the direction sets: screenshot this and an owner screen, crop the
 * words out, and you should still know which is which.
 *
 * Nothing here asks the reader to do anything except the one thing they came
 * for. A person reading this is having the worst week of their life.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.3, CC8
 */

export const metadata = { title: 'Access · Relay' };

export default function AccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mode-access min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/*
        A masthead, not a navigation bar. It says where you are and stops —
        there is nowhere else to go from here, and offering somewhere would be
        asking a person mid-crisis to make a decision that is not theirs.
      */}
      <header style={{ borderBottom: '1px solid var(--rule)' }}>
        <div
          className="mx-auto"
          style={{ maxWidth: 'var(--measure-access)', padding: 'var(--s4) var(--s6)' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--t1)',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
            }}
          >
            Relay
          </span>
        </div>
      </header>

      <div
        className="mx-auto"
        style={{ maxWidth: 'var(--measure-access)', padding: 'var(--s8) var(--s6) var(--s16)' }}
      >
        {children}
      </div>
    </div>
  );
}
