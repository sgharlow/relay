/**
 * Server shell for the client page beside it — it exists to carry `metadata`.
 *
 * 🔴 SIX OWNER PAGES HAD NO Audit · Relay, found 2026-08-13 by looking at the tabs:
 * /vault, /vault/new, /rules, /triggers, /import and /audit all read as a bare
 * "Relay", because each was a `'use client'` page and a client component cannot
 * export metadata. Six identical tabs is not cosmetic on THIS product: check-in
 * and answering a request are jobs people do with many tabs open, and the tab
 * label is how they get back to the right one.
 *
 * Same shape as /circle and /account, which always had it: server page.tsx that
 * renders the client component. No logic moved.
 */

import AuditPageClient from './AuditPageClient';

export const metadata = { title: 'Audit · Relay' };

export default function Page() {
  return <AuditPageClient />;
}
