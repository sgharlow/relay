/**
 * The response headers the product sends, and the ones it deliberately does not.
 *
 * 🔴 THERE WERE NONE until 2026-08-13. The pre-release audit grepped the whole
 * repo for Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
 * Referrer-Policy and an `async headers(` and got no matches, in a product that
 * decrypts vault plaintext in the browser.
 *
 * WHY A TEST AND NOT JUST CONFIG. A header block is invisible. Nothing renders
 * differently when one goes missing, no test fails, and a page keeps working
 * perfectly while its protection is gone — so the only way a deletion or a typo
 * gets noticed is if something asserts the values. This is that.
 *
 * It reads next.config.mjs through its real export rather than re-stating the
 * strings, so the file under test and the file that ships are the same file.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import nextConfig from '../../next.config.mjs';

async function headerMap(): Promise<Record<string, string>> {
  const rules = await nextConfig.headers();
  const catchAll = rules.find((r) => r.source === '/:path*');
  if (!catchAll) throw new Error('headers() must cover every route, not a subset');
  return Object.fromEntries(catchAll.headers.map((h) => [h.key, h.value]));
}

describe('security headers', () => {
  it('applies to every route', async () => {
    const rules = await nextConfig.headers();
    expect(rules.map((r) => r.source)).toContain('/:path*');
  });

  it('sends HSTS for at least a year', async () => {
    const v = (await headerMap())['Strict-Transport-Security'];
    expect(v).toBeDefined();
    const maxAge = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(v).toContain('includeSubDomains');
  });

  /*
    NOT preloaded, and that is a decision rather than an omission. Preload is
    effectively irreversible — a browser that has seen it keeps refusing plain
    HTTP for this domain and every subdomain for the life of the max-age,
    whatever the site later does. Reversibility is the thing this product sells;
    it should hold itself to it too.
  */
  it('does not claim preload', async () => {
    expect((await headerMap())['Strict-Transport-Security']).not.toContain('preload');
  });

  it('refuses to be framed', async () => {
    expect((await headerMap())['X-Frame-Options']).toBe('DENY');
  });

  it('stops content-type sniffing', async () => {
    expect((await headerMap())['X-Content-Type-Options']).toBe('nosniff');
  });

  /*
    ADDED 2026-08-15. A live probe of the running app found six of the seven
    headers a production checklist asks for, and this one absent — not argued
    against anywhere, which is how a header goes missing: nobody decides against
    it, nobody thinks of it. On a page that decrypts vault plaintext in the
    browser, a retained `window.opener` handle from another origin is the one
    reference worth cutting.
  */
  it('isolates the browsing context from any cross-origin opener', async () => {
    expect((await headerMap())['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  /*
    THE CHECK THAT KEEPS THAT HEADER SAFE TO HOLD. `same-origin` severs the
    handle a popup uses to talk back, so a sign-in or payment flow that opened a
    window and waited on it would break — silently, in the flow that earns money.
    Stripe is a full navigation here and `window.open` appears nowhere, which is
    the precondition. If that ever changes, this fails BEFORE the header does.
  */
  it('nothing in the product depends on a popup talking back', () => {
    const src = readFileSync('next.config.mjs', 'utf8');
    expect(src).toContain('Cross-Origin-Opener-Policy');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !e.includes('.test.')) {
          if (/\bwindow\.open\s*\(/.test(readFileSync(p, 'utf8'))) offenders.push(p);
        }
      }
    };
    walk('src');

    expect(
      offenders,
      offenders.length
        ? 'window.open() found. Cross-Origin-Opener-Policy: same-origin severs ' +
          'window.opener, so a popup flow that waits on the opened window will ' +
          'break. Either use a full navigation, or drop the header and say why:\n' +
          offenders.join('\n')
        : 'ok',
    ).toEqual([]);
  });

  /*
    The unclaimed-contact fallback still carries ?token= in a URL. Under the
    default policy, a recipient following any off-site link from an access
    screen would hand that entire URL to the destination.
  */
  it('does not leak a full URL cross-origin', async () => {
    const v = (await headerMap())['Referrer-Policy'];
    expect(['strict-origin-when-cross-origin', 'no-referrer', 'same-origin']).toContain(v);
  });

  /*
    🔴 THE HEADER MOST LIKELY TO BREAK SOMETHING QUIETLY. Passkeys are gated by
    publickey-credentials-get / publickey-credentials-create, whose default
    allowlist is already 'self'. Naming them in a restrictive Permissions-Policy
    is how sign-in stops working for a reason nobody looks for — the failure
    appears in WebAuthn, not in a header. So they must stay unmentioned.
  */
  it('never names the WebAuthn permissions, which passkeys depend on', async () => {
    const v = (await headerMap())['Permissions-Policy'] ?? '';
    expect(v).not.toContain('publickey-credentials');
    expect(readFileSync('next.config.mjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain(
      'publickey-credentials',
    );
  });

  it('still disables the capabilities this product genuinely never uses', async () => {
    const v = (await headerMap())['Permissions-Policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(v).toContain(`${feature}=()`);
    }
  });

  /*
    CSP SHIPS AS A SPLIT, and the split is the whole safety argument.

    The directives that could blank a screen — anything constraining scripts,
    styles, images or network calls — stay REPORT-ONLY until real traffic says
    what they would break, because enforcing `script-src` needs nonces and
    nonces need middleware on every request.

    The directives that cannot blank a screen are ENFORCED, because leaving them
    in report-only was buying nothing. That was the 2026-08-13 finding: the
    argument for report-only is an argument about `script-src`, and it had been
    applied to four directives it does not describe.
  */
  describe('Content-Security-Policy', () => {
    /**
     * The escapes that keep the app renderable.
     *
     * 🔴 THE DANGER INVERTED ON 2026-08-20. Until then the risk was somebody
     * ENFORCING a directive that blanks the page, and the guard below refused
     * every such directive. The full policy is now enforced deliberately, so
     * that guard would be refusing the decision it was written to protect.
     *
     * The remaining danger is the opposite one, and it is sharper: removing
     * `'unsafe-inline'`/`'unsafe-eval'` from the ENFORCING script-src. Next's
     * bootstrap emits inline scripts, so doing that without per-request nonces
     * from Node-runtime middleware white-screens the whole product for everyone,
     * including somebody mid-emergency. It is a one-word deletion and it looks
     * like tightening security.
     */
    const KEEPS_THE_APP_RENDERABLE = ["'unsafe-inline'", "'unsafe-eval'"];

    /**
     * Why enforcing was worth it, expressed as directives.
     *
     * This product decrypts plaintext in the browser, so the threat is
     * exfiltration rather than execution. These are the directives that close
     * the silent channels; losing one would quietly undo the reason the policy
     * was enforced at all.
     */
    const CLOSES_AN_EXFIL_CHANNEL = ['default-src', 'connect-src', 'img-src', 'form-action'];

    it('enforces the directives that cannot break a page', async () => {
      const v = (await headerMap())['Content-Security-Policy'];
      expect(v, 'the enforcing half of the split is missing').toBeDefined();
      for (const directive of [
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ]) {
        expect(v).toContain(directive);
      }
    });

    /*
      🔴 THE GUARD THAT MATTERS MORE THAN THE ONE ABOVE, and it now points the
      other way. Removing an escape from the ENFORCING script-src is a one-word
      deletion that white-screens the product for everyone — and it reads as
      tightening security, so it is exactly the kind of change that sails
      through review. The nonce decision has to be taken deliberately, with
      middleware, on evidence from the report-only header below.
    */
    it('keeps the escapes that stop the enforcing policy blanking the app', async () => {
      const v = (await headerMap())['Content-Security-Policy'] ?? '';
      const scriptSrc = v.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
      expect(scriptSrc, 'the enforcing policy has no script-src at all').toBeDefined();

      for (const escape of KEEPS_THE_APP_RENDERABLE) {
        expect(
          scriptSrc,
          `the enforcing script-src no longer allows ${escape}. Next's bootstrap emits ` +
            'inline scripts, so this white-screens the product unless per-request nonces ' +
            'from Node-runtime middleware landed in the same change. If they did, delete ' +
            'this assertion deliberately and say so — do not let it pass by accident.',
        ).toContain(escape);
      }
    });

    it('enforces the directives that close a silent exfiltration channel', async () => {
      /*
        The reason enforcing was worth doing at all. 'unsafe-inline' concedes
        that an injected script may RUN; these are what stop it sending what it
        found anywhere. Losing one undoes the point without breaking anything
        visible, which is why it is asserted rather than assumed.
      */
      const v = (await headerMap())['Content-Security-Policy'] ?? '';
      for (const directive of CLOSES_AN_EXFIL_CHANNEL) {
        expect(v, `${directive} is no longer enforced`).toContain(directive);
      }
    });

    it('reports on a STRICTER policy than it enforces, or it observes nothing', async () => {
      /*
        🔴 THE DEFECT THIS WAS WRITTEN FOR. Until 2026-08-20 the report-only
        header carried the SAME policy as the enforcing one, so it could only
        ever report things already permitted — an observation apparatus pointed
        at a question nobody was asking, costing bytes on every response.

        The report-only script-src must be strictly tighter than the enforcing
        one, because the nonce question is the only CSP question here that
        genuinely needs evidence rather than argument.
      */
      const h = await headerMap();
      const ro = h['Content-Security-Policy-Report-Only'];
      const enforced = h['Content-Security-Policy'] ?? '';
      expect(ro, 'the report-only half of the split is missing').toBeDefined();

      const scriptOf = (policy: string) =>
        policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

      const roScript = scriptOf(ro ?? '');
      expect(roScript, 'report-only has no script-src to observe').toContain('script-src');
      expect(
        roScript,
        'the report-only script-src still allows the escapes the enforcing one does, so it ' +
          'reports nothing the enforcing policy would not already permit',
      ).not.toContain("'unsafe-inline'");
      expect(roScript).not.toContain("'unsafe-eval'");
      expect(
        roScript.length,
        'report-only script-src is not stricter than the enforcing one',
      ).toBeLessThan(scriptOf(enforced).length);
    });

    it('names a report destination that exists', async () => {
      const v = (await headerMap())['Content-Security-Policy-Report-Only'];
      expect(v).toContain('report-uri /api/csp-report');
      expect(v).toContain('report-to csp');
      // A report-only policy with nowhere to report is a header that does nothing.
      expect(() => readFileSync('src/app/api/csp-report/route.ts', 'utf8')).not.toThrow();
    });

    it('declares the reporting endpoint group', async () => {
      expect((await headerMap())['Reporting-Endpoints']).toContain('csp="/api/csp-report"');
    });

    it('refuses framing and object embedding outright', async () => {
      const v = (await headerMap())['Content-Security-Policy-Report-Only'];
      expect(v).toContain("frame-ancestors 'none'");
      expect(v).toContain("object-src 'none'");
      expect(v).toContain("base-uri 'self'");
    });

    /*
      🔴 THE REPORT ENDPOINT MUST NOT BECOME AN EXFILTRATION CHANNEL. A CSP
      report can carry `script-sample` — up to 40 characters of the offending
      inline script. On a page that has just decrypted a vault item, that is a
      slice of plaintext. It is dropped explicitly rather than merely unread.
    */
    it('the report endpoint never records a script sample', () => {
      const src = readFileSync('src/app/api/csp-report/route.ts', 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        ' ',
      );
      for (const field of ['script-sample', 'scriptSample', 'sample']) {
        expect(src, `csp-report reads ${field}, which can carry page content`).not.toContain(
          `${field}'`,
        );
      }
    });
  });

  /*
    The redirects that were already here are load-bearing security: the legacy
    vercel.app host accepted real sign-ins, and Relay's own emails were once
    found pointing at it. Adding headers() must not have disturbed them.
  */
  it('leaves the legacy-host redirect intact', async () => {
    const redirects = await nextConfig.redirects();
    const legacy = redirects.find((r) =>
      r.has?.some((h) => h.type === 'host' && h.value === 'relay-three-henna.vercel.app'),
    );
    if (!legacy) throw new Error('the legacy vercel.app host must still redirect');
    expect(legacy.permanent).toBe(true);
  });

  it('leaves the /guide rewrite intact', async () => {
    const rewrites = await nextConfig.rewrites();
    expect(rewrites).toContainEqual({ source: '/guide', destination: '/guide/index.html' });
  });
});
