/**
 * Proves the Resend delivery webhook is actually wired, end to end.
 *
 * WHY A PROOF AND NOT A GLANCE. /api/resend/webhook answers a constant 204 to
 * everything — including its own refusals, deliberately, so it cannot be probed
 * for whether a secret is configured. That means "the endpoint responds" tells
 * you nothing at all, and the only honest test is to send a real message and
 * watch for the event to arrive in the database.
 *
 *   npx tsx --env-file=.env.local scripts/verify-delivery-webhook.ts <your-address>
 *
 * ⚠️ SENDS TO A REAL ADDRESS YOU CONTROL, on purpose. Testing with a known-bad
 * address would prove the bounce path — and burn the sending reputation of a
 * domain shared with another project to do it. A delivered event proves the
 * same pipe: Resend saw the outcome, signed it, and we recorded it.
 *
 * It polls for the event because webhooks are asynchronous; absence after the
 * window means the hook is not wired, not that the send failed.
 *
 * Feature: relay-h0-mvp
 */

import { sendEmail } from '../lib/notify/email';
import { query, closeAllPools } from '../lib/db/connection';

const POLL_SECONDS = 90;
const INTERVAL_MS = 5000;

async function main(): Promise<void> {
  const to = (process.argv[2] ?? '').trim();
  if (!to || !to.includes('@')) {
    console.error('usage: verify-delivery-webhook.ts <an-address-you-can-read>');
    process.exit(2);
  }

  const before = await query<{ n: string }>(
    `SELECT count(*)::text n FROM email_delivery_events WHERE email = $1`,
    [to.toLowerCase()],
  );
  console.log(`events already recorded for ${to}: ${before.rows[0].n}`);

  const stamp = new Date().toISOString();
  console.log('sending one test message…');
  await sendEmail({
    to,
    subject: 'Relay — delivery webhook check',
    text:
      `This message exists only to prove that Relay hears back from its email ` +
      `provider.\n\nIf the webhook is wired, a "delivered" event is now recorded ` +
      `against this address, and Relay can tell an owner when a message did NOT ` +
      `reach one of their people.\n\nNothing to do. Sent ${stamp}.\n`,
  });
  console.log('accepted by Resend. Now waiting for the event to come back…\n');

  const deadline = Date.now() + POLL_SECONDS * 1000;
  for (;;) {
    const now = await query<{ event: string; occurred_at: string }>(
      `SELECT event, occurred_at::text FROM email_delivery_events
        WHERE email = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [to.toLowerCase()],
    );
    const latest = now.rows[0];
    const fresh = latest && latest.occurred_at > stamp;

    if (fresh) {
      console.log(`EVENT RECEIVED: ${latest.event} at ${latest.occurred_at}`);
      console.log('\nThe webhook is wired. Relay can now tell an owner, in calm,');
      console.log('when a message to one of their people did not arrive.');
      await closeAllPools();
      return;
    }
    if (Date.now() > deadline) {
      console.log(`No event after ${POLL_SECONDS}s.\n`);
      console.log('The SEND worked (Resend accepted it), so this is the webhook, not the mail.');
      console.log('Check, in order:');
      console.log('  1. RESEND_WEBHOOK_SECRET is set in Vercel for Production');
      console.log('  2. the app was REDEPLOYED after setting it');
      console.log('  3. Resend → Webhooks points at https://relaystandby.com/api/resend/webhook');
      console.log('  4. the endpoint subscribes to email.delivered (and bounced/complained)');
      console.log('  5. Resend → Webhooks → your endpoint → recent deliveries shows attempts');
      await closeAllPools();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
