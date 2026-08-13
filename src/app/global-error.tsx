'use client';

/**
 * The last resort — the root layout itself failed.
 *
 * Next replaces `<html>` and `<body>` here, so this cannot rely on the app's
 * fonts, CSS variables or anything else the layout would have provided. Every
 * value is inline and literal on purpose: a fallback that depends on the thing
 * that just broke is not a fallback.
 *
 * Deliberately plainer than `error.tsx`. If this is rendering, less is working
 * than that boundary assumes, and the only job left is to say the true thing and
 * offer one way out.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif' }}>
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
          <div style={{ maxWidth: 480 }}>
            <h1 style={{ fontSize: 26, fontWeight: 600 }}>Relay could not load</h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
              <strong>Nothing has been lost and nothing has been opened.</strong> This is the site
              failing to start, not anything changing.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                minHeight: 48,
                padding: '0 22px',
                fontSize: 17,
                fontWeight: 600,
                color: '#fffdf9',
                background: '#211d18',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {error.digest ? (
              <p style={{ fontSize: 14, marginTop: 16, color: '#8a8177', fontFamily: 'ui-monospace, monospace' }}>
                Reference {error.digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
