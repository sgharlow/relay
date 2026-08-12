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

  const links =
    standingBy > 0
      ? [...LINKS, { href: '/standby', label: `Standing by (${standingBy})` }]
      : LINKS;

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Owner navigation">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className="transition-colors"
            style={{
              borderRadius: 'var(--radius-owner)',
              padding: 'var(--s2) var(--s3)',
              fontSize: 'var(--t2)',
              /* Ochre marks where you are — the one thing in motion on this
                 rail. Blue was the last of the pre-system accents here. */
              background: active ? 'var(--ochre)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--ink-faint)',
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
