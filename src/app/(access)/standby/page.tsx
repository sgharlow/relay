/**
 * /standby — rung 0, the surface a contact can look at without being told.
 *
 * Server shell only. Everything meaningful is resolved from the database on the
 * API call, never from the session token (§3.7 rule 1).
 *
 * Feature: relay-standby
 */

import StandbyClient from './StandbyClient';

export const metadata = { title: 'Your standby · Relay' };

export default function StandbyPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#faf7f2', color: '#211d18' }}>
      <StandbyClient />
    </main>
  );
}
