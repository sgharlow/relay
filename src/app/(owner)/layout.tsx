/**
 * OwnerLayout (Requirement 12.1) — the Owner-mode shell.
 *
 * Blue/neutral, information-dense (14–16px body), low-saturation. Gates the
 * whole owner area: an unauthenticated visitor is redirected to sign in.
 *
 * Feature: relay-h0-mvp
 */

import { redirect } from 'next/navigation';
import { getOwnerSession } from '../../../lib/auth/session';
import SidebarNav from './_components/SidebarNav';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSession().catch(() => null);
  if (!session) redirect('/auth/signin');

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-56 shrink-0 flex-col gap-6 bg-slate-900 px-4 py-5 text-slate-100">
        <div>
          <div className="text-lg font-semibold tracking-tight">Relay</div>
          <div className="text-xs text-slate-400">Living-continuity vault</div>
        </div>
        <SidebarNav />
        {session.isDemo ? (
          <div className="mt-auto rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
            Demo account
          </div>
        ) : null}
      </aside>
      <main className="flex-1 px-8 py-6 text-[15px] leading-relaxed">{children}</main>
    </div>
  );
}
