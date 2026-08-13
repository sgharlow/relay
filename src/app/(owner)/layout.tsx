/**
 * OwnerLayout (Requirement 12.1) — the Owner-mode shell.
 *
 * THE SHELL OWNS THE MEASURE. The audit found /vault and /triggers rendering at
 * different widths and indents because each page set its own padding, so the
 * app had no consistent geometry. Rail, gutter and column are declared here and
 * pages get no say: 240px rail, 32px gutter, 1120px column.
 *
 * Information-dense by design — tables, rows, badges, 16px floor. Access mode
 * is the deliberate opposite and lives in (access)/layout.tsx; the two should be
 * tellable apart with the words cropped out.
 *
 * Feature: relay-h0-mvp
 */

import { redirect } from 'next/navigation';
import { getOwnerSession } from '../../../lib/auth/session';
import SidebarNav from './_components/SidebarNav';
import ReadinessBanner from './_components/ReadinessBanner';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSession().catch(() => null);
  if (!session) redirect('/auth/signin');

  /*
    Direction comes from a variable, not a class. Below 720px the rail becomes a
    full-width strip above the content instead of a 240px column beside it — see
    the media query in globals.css for why. Tailwind's flex-row/flex-col cannot
    express that here, because the width beside it is an INLINE style and inline
    wins over any selector.
  */
  return (
    <div
      className="flex min-h-screen"
      style={{
        flexDirection: 'var(--shell-dir)' as React.CSSProperties['flexDirection'],
        background: 'var(--paper)',
        color: 'var(--ink)',
      }}
    >
      <aside
        className="flex shrink-0"
        style={{
          flexDirection: 'var(--rail-dir)' as React.CSSProperties['flexDirection'],
          alignItems: 'var(--rail-align, stretch)' as React.CSSProperties['alignItems'],
          width: 'var(--rail)',
          gap: 'var(--s6)',
          padding: 'var(--rail-pad)',
          background: 'var(--ink)',
          color: 'var(--paper)',
        }}
      >
        {/* shrink-0 so the wordmark keeps its size when the rail is a row and
            the nav beside it is scrolling. */}
        <div className="shrink-0">
          <div style={{ fontSize: 'var(--t5)', fontWeight: 600, letterSpacing: '-0.01em' }}>Relay</div>
          {/* On the ink sidebar, so --paper-faint rather than --ink-faint. */}
          <div style={{ fontSize: 'var(--t1)', color: 'var(--paper-faint)' }}>Living-continuity vault</div>
        </div>
        <SidebarNav />
        {session.isDemo ? (
          <div className="mt-auto rounded bg-ochre-soft px-2 py-1 text-t1 text-ochre-text">
            Demo account
          </div>
        ) : null}
      </aside>
      <main className="flex-1" style={{ padding: 'var(--s6) var(--gutter)', fontSize: 'var(--t3)' }}>
        <div className="mx-auto" style={{ maxWidth: 'var(--measure-owner)' }}>
        {/* On every owner screen, because the failure it reports is invisible
            on all of them: a vault with no trusted contact renders exactly like
            a working one and only reveals itself by not opening. */}
        <ReadinessBanner />
        {children}
        </div>
      </main>
    </div>
  );
}
