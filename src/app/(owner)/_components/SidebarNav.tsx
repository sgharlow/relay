'use client';

/**
 * Owner-mode sidebar navigation (Requirement 12.1).
 * Client component so the current route can be highlighted via usePathname.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/vault', label: 'Vault' },
  { href: '/import', label: 'Import' },
  { href: '/recipients', label: 'Recipients' },
  { href: '/rules', label: 'Rules' },
  { href: '/triggers', label: 'Triggers' },
  { href: '/audit', label: 'Audit' },
  // Leaving has to be findable. The terms promise an export and the privacy
  // page promises deletion; a promise reachable only by emailing us is not
  // really kept.
  { href: '/account', label: 'Account' },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Owner navigation">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
