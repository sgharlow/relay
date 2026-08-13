'use client';

/**
 * Owner-mode sidebar navigation (Requirement 12.1).
 * Client component so the current route can be highlighted via usePathname.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/vault', label: 'Vault' },
  { href: '/import', label: 'Import' },
  // One destination for the people you trust. It was two — "Recipients &
  // Verifiers" and "Your circle" — which made the owner learn an internal
  // distinction before they could find anybody. /recipients now redirects here.
  { href: '/circle', label: 'People' },
  { href: '/rules', label: 'Rules' },
  { href: '/triggers', label: 'Triggers' },
  // Linked from nowhere at all before this: not from an email, not from the
  // sidebar. A parent whose child had proposed changes could not find the queue
  // where they approve them, which made the whole delegation flow terminate in
  // silence.
  { href: '/approvals', label: 'Approvals' },
  { href: '/audit', label: 'Audit' },
  // Leaving has to be findable. The terms promise an export and the privacy
  // page promises deletion; a promise reachable only by emailing us is not
  // really kept.
  { href: '/account', label: 'Account' },
  // Last, and deliberately quiet — but present on every owner screen. Until
  // 2026-08-13 a stuck owner had nowhere in the product to go, on a product
  // that cannot reset their authenticator or decrypt their vault for them.
  { href: '/help', label: 'Help' },
];

export default function SidebarNav() {
  const pathname = usePathname();

  // §3.7: the same person may own a vault AND stand by for other people. Owner
  // mode had no link to /standby from anywhere, so a both-hats user could not
  // reach the page showing whether someone they cover needs them — the one
  // screen that is urgent when it matters. Shown only when they actually stand
  // by for somebody, so it never appears for an owner it does not concern.
  const [standingBy, setStandingBy] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/standby')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setStandingBy((j.relationships ?? []).length);
      })
      .catch(() => {
        // A nav link is not worth an error state. Absent is the safe default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 🔴 A PENDING REQUEST WAS INVISIBLE INSIDE THE PRODUCT until 2026-08-13.
   *
   * `/challenge` — where an owner answers "somebody is asking for access" — was
   * linked from exactly one place in the world: the notification email. Not the
   * sidebar, not the readiness banner, not anywhere a person could look. The
   * endpoint that lists pending requests was called only by that page, so the
   * one screen that could tell you was the screen you could not find.
   *
   * The consequence is not cosmetic. The window is two hours for an emergency;
   * when it lapses the request escalates to the verifiers. So an owner whose
   * mail was delayed, filtered or silently suppressed — and this project's own
   * records list Outlook SCL 5 and Resend suppression returning 200 as live,
   * measured problems — first learns they were asked when their circle is
   * already being polled about them.
   *
   * Same shape as /approvals two commits above: built, permitted, tested, and
   * reachable only from outside the product.
   *
   * Shown only when something is actually waiting, so it never appears for an
   * owner it does not concern.
   */
  const [asking, setAsking] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/access-requests')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setAsking((j.requests ?? []).length);
      })
      .catch(() => {
        // Same reasoning as above: absent beats an error in a nav.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ordered deliberately: something waiting on an answer goes ABOVE the routine
  // destinations, because it is the only item here with a clock running on it.
  const links = [
    ...(asking > 0
      ? [{ href: '/challenge', label: `Someone is asking (${asking})` }]
      : []),
    ...LINKS,
    ...(standingBy > 0
      ? [{ href: '/standby', label: `Standing by (${standingBy})` }]
      : []),
  ];

  /*
    Row with sideways scroll below 720px, column above — driven by the same
    variables as the shell (globals.css). `minWidth: 0` matters: without it a
    flex child refuses to shrink below its content, so the row would never
    scroll, it would just push the rail wide again and undo the whole fix.
  */
  return (
    <nav
      className="flex gap-0.5"
      aria-label="Owner navigation"
      style={{
        flexDirection: 'var(--nav-dir)' as React.CSSProperties['flexDirection'],
        overflowX: 'var(--nav-overflow)' as React.CSSProperties['overflowX'],
        minWidth: 0,
        flex: 1,
      }}
    >
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className="transition-colors"
            style={{
              // Never squash a destination to fit; the row scrolls instead.
              flexShrink: 0,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-owner)',
              padding: 'var(--s2) var(--s3)',
              fontSize: 'var(--t2)',
              /* Ochre marks where you are — the one thing in motion on this
                 rail. Blue was the last of the pre-system accents here. */
              // --ochre-deep, not --ochre: paper text on plain ochre measures
              // 3.60:1. --ink-faint is tuned for light grounds and reads 4.42:1
              // here, so the dark ground gets its own token. Both 2026-08-13.
              background: active ? 'var(--ochre-deep)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--paper-faint)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
