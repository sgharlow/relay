/**
 * The one way out of a contact-facing screen.
 *
 * 🔴 FOUR OF THE FIVE CONTACT SCREENS COULD NOT REACH SUPPORT, found by the
 * pre-release audit on 2026-08-13. `/help` had shipped the day before with its
 * FAQ ordered contact-first — its own header says the likeliest arrival is
 * somebody just told a person they love may be unreachable, holding a code they
 * did not ask for. Those people land on /claim, /access, /break-glass and
 * /verify, and not one of them offered a link. Only /standby and /helping did.
 *
 * WHY THE EXISTING REACHABILITY GUARD MISSED IT. `findUnlinkedPages()` asks
 * whether a page is linked from anywhere in the product, and /help is — from the
 * owner sidebar and the landing page. Reachable from the wrong mode still counts
 * as reachable. `support-footer.test.ts` asks the question that was actually
 * needed: can the reader get there from the mode they are standing in.
 *
 * A FOOTER, NOT A NAV ITEM. The access layout's own note is right that offering
 * a mid-crisis reader somewhere else to go is asking them to make a decision
 * that is not theirs. This is not navigation — it is the fire exit, last on the
 * page and quiet, in the exact treatment /standby had already settled on. On a
 * calm day there is nothing here to ask.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

export default function SupportFooter() {
  return (
    <p
      style={{
        marginTop: 'var(--s8)',
        textAlign: 'center',
        fontSize: 'var(--t2)',
        color: 'var(--ink-muted)',
      }}
    >
      Not sure about any of this?{' '}
      <a href="/help" style={{ color: 'var(--ink-muted)', textDecoration: 'underline' }}>
        Read the common questions
      </a>{' '}
      or ask us.
    </p>
  );
}
