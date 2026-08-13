/**
 * A page that does not exist.
 *
 * 🔴 THERE WAS NO 404 PAGE until 2026-08-12. A mistyped address returned Next's
 * bare default — "404 · This page could not be found." — on a product whose
 * every other surface is written with care, and to a reader who may have
 * fat-fingered a URL a relative read to them over the phone during an emergency.
 *
 * It must NOT assume an owner. The likeliest person here is a contact who typed
 * an address slightly wrong, so it names the three places somebody might
 * actually have been trying to reach rather than offering a dashboard they do
 * not have.
 *
 * Feature: relay-h0-mvp
 */

export const metadata = { title: 'Not found · Relay' };

const link: React.CSSProperties = {
  display: 'block',
  fontSize: 17,
  color: '#211d18',
  padding: '10px 0',
  textDecoration: 'underline',
  textUnderlineOffset: 4,
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f6f3ee',
        color: '#211d18',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
          There is nothing at this address
        </h1>

        <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
          Most likely a letter is off somewhere. Nothing is broken and nothing has been lost.
        </p>

        <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 16, color: '#6b6257' }}>
          If somebody sent you here, you probably want one of these:
        </p>

        <div style={{ marginTop: 8 }}>
          <a href="/claim" style={link}>
            Somebody gave me a code to accept a place
          </a>
          <a href="/verify" style={link}>
            I was asked to confirm whether something is real
          </a>
          <a href="/access" style={link}>
            I was told something was opened for me
          </a>
          <a href="/auth/signin" style={link}>
            I have my own vault and want to sign in
          </a>
        </div>

        <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 20, color: '#6b6257' }}>
          Relay never sends a link that signs you in, so if you arrived from a message promising
          that, it was not from us.
        </p>
      </div>
    </main>
  );
}
