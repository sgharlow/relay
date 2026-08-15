/**
 * The HTML alternative part — test 2 of the Outlook investigation.
 *
 * Two things are being guarded, and they pull in opposite directions.
 *
 * FIDELITY: the HTML must say everything the text says. Our bodies carry case
 * ids, whether a code is enclosed, and the standing claim that Relay never sends
 * a link that signs you in. An HTML part that drops a sentence is worse than no
 * HTML part, because it is the part most clients actually render.
 *
 * NOT LOOKING MORE LIKE PHISHING: this is mail about emergency access to someone
 * else's accounts, sent to a filter that already dislikes it. The controls that
 * matter are asserted here rather than left to whoever edits the template next —
 * anchor text identical to href, no remote fetches, no script, no forms.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2
 */

import { describe, it, expect } from 'vitest';

import { escapeHtml, textToHtml } from './text-to-html';

/** A real body, in the shape notifications.ts actually produces. */
const VERIFIER_NOTICE =
  `Hi Alex,\n\n` +
  `Steve named you as one of the people who would be asked whether an emergency is real, ` +
  `and an "emergency" release has now been started on their account.\n\n` +
  `Sign in the way you normally do and the request will be waiting for you:\n\n` +
  `    https://relaystandby.com/standby\n\n` +
  `Case RLY-DECY-X347.\n\n` +
  `There is no code in this message, and no link that signs you in — deliberately.\n`;

/** Visible text, tags stripped and entities decoded, for fidelity comparison. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('textToHtml — fidelity', () => {
  it('carries every word of the text into the rendered output', () => {
    const seen = visibleText(textToHtml(VERIFIER_NOTICE));
    for (const word of VERIFIER_NOTICE.split(/\s+/).filter(Boolean)) {
      expect(seen, `"${word}" was dropped from the HTML part`).toContain(word);
    }
  });

  it('keeps the case id and the never-signs-you-in claim', () => {
    const seen = visibleText(textToHtml(VERIFIER_NOTICE));
    expect(seen).toContain('RLY-DECY-X347');
    expect(seen).toContain('no link that signs you in');
  });

  it('renders an indented block — a code or a URL a person must copy exactly', () => {
    const html = textToHtml('Read them this code:\n\n    4KMPQ-7XR2W\n\nThen call.');
    expect(visibleText(html)).toContain('4KMPQ-7XR2W');
    expect(html).toMatch(/monospace/);
  });

  it('separates blank-line-delimited blocks into distinct paragraphs', () => {
    const html = textToHtml('One.\n\nTwo.\n\nThree.');
    expect((html.match(/<p /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('textToHtml — does not look more like phishing than the text did', () => {
  it('ANCHOR TEXT IS IDENTICAL TO THE HREF — the load-bearing one', () => {
    const html = textToHtml(VERIFIER_NOTICE);
    const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    expect(anchors.length, 'the URL was not linkified at all').toBeGreaterThan(0);
    for (const [, href, text] of anchors) {
      expect(text, `anchor text "${text}" does not match href "${href}"`).toBe(href);
    }
  });

  it('makes no remote request — no images, no remote CSS, no web fonts', () => {
    const html = textToHtml(VERIFIER_NOTICE);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/background-image/i);
    expect(html).not.toMatch(/@import|url\(/i);
    // The only absolute URLs permitted are anchors carrying our own links.
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      expect(m[0]).toMatch(/^https:\/\/relaystandby\.com/);
    }
  });

  it('carries no script, no form and no event handler', () => {
    const html = textToHtml(VERIFIER_NOTICE);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('escaping is the trust boundary', () => {
  it('neutralises markup arriving through a name', () => {
    const html = textToHtml('Hi <img src=x onerror=alert(1)>,\n\nYou were named.');
    // The property is that no TAG is introduced — not that the word "onerror"
    // is absent. It survives as inert text, which is correct: with `<` escaped
    // it cannot become an attribute of anything. Asserting on the substring
    // would be checking something adjacent to what matters, which is the
    // failure this repo keeps finding in its own checks.
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('does not let a body close the anchor it is inside', () => {
    const html = textToHtml('See https://relaystandby.com/claim"><script>alert(1)</script>');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapes the five characters that matter, and ampersand first', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('leaves an ampersand inside a URL correctly escaped in both places', () => {
    const html = textToHtml('Go to https://relaystandby.com/claim?a=1&b=2 now.');
    const [, href, text] = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(html)!;
    expect(href).toBe(text);
    expect(href).toContain('&amp;');
  });
});

describe('the experiment stays a single variable', () => {
  it('is a complete multipart-worthy document', () => {
    const html = textToHtml('Hello.');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('produces nothing surprising for an empty body', () => {
    expect(() => textToHtml('')).not.toThrow();
    expect(textToHtml('')).toContain('</html>');
  });
});
