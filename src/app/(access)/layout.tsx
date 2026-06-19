/**
 * AccessLayout (Requirement 7.3 / task 22.1) — the Recipient "Access mode".
 *
 * Deliberately distinct from Owner mode: warm amber accent on white, bold large
 * body type, generous leading, minimal chrome, full-width step layout. The
 * recipient token is verified at the API layer (GET /api/access); this layout
 * provides the calm, reassuring frame for someone acting in a hard moment.
 *
 * Feature: relay-h0-mvp
 */

export const metadata = { title: 'Access · Relay' };

export default function AccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[19px] leading-relaxed text-stone-900">
      <header className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <div className="text-sm font-semibold uppercase tracking-widest text-amber-700">Relay · Access</div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-6 py-8">{children}</div>
    </div>
  );
}
