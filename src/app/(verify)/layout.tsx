/**
 * Verify mode — a third route group beside (owner) and (access).
 *
 * Verifiers are volunteers doing an uncomfortable favour, often on a phone,
 * often at speed. Access-mode styling: warm, high contrast, 18px minimum (CC8).
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R1, CC8
 */

import SupportFooter from '../_components/SupportFooter';

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper-sunken px-4 py-8 text-[18px] leading-relaxed text-ink">
      <div className="mx-auto max-w-xl">
        {children}
        {/*
          A verifier is being asked to answer for somebody else's emergency, on a
          phone, having volunteered for nothing. Of the three modes this was the
          one with no way to ask what any of it meant.
        */}
        <SupportFooter />
      </div>
    </main>
  );
}
