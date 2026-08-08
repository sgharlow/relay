/**
 * Verify mode — a third route group beside (owner) and (access).
 *
 * Verifiers are volunteers doing an uncomfortable favour, often on a phone,
 * often at speed. Access-mode styling: warm, high contrast, 18px minimum (CC8).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1, CC8
 */

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-[18px] leading-relaxed text-stone-900">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}
