/**
 * The HTML sibling of a plain-text message — `multipart/alternative` TEST 2.
 *
 * WHAT THIS IS AN EXPERIMENT ON. `docs/g1-ad-creatives.md` §"Outlook.com delivers
 * to JUNK" diagnosed the filing from the message source: authentication is
 * flawless (`spf=pass`, `dkim=pass`, `dmarc=pass`, `compauth=pass reason=100`,
 * `BCL: 0`, `ucf:0`, `jmr:0`) and the message was junked anyway on `SCL: 5` by
 * `OFR:SpamFilterAuthJ` — the CONTENT filter. Test 1 (Reply-To) was run and
 * REFUTED: the SCL did not move and the same 23 ARA rules fired. Of the two
 * candidates left, message shape is the one we control, and the doc calls it
 * "the highest-value remaining test".
 *
 * The shape in question: every Relay message is `text/plain` ONLY. Genuine brand
 * transactional mail almost always carries both parts, so a bare-text message
 * pairing a code with a link is an unusual silhouette. Supplying `html` alongside
 * `text` makes Resend emit `multipart/alternative`.
 *
 * ⚠️ DERIVED, NEVER HAND-AUTHORED. There are twenty-odd call sites. Twenty pairs
 * of hand-written bodies is twenty chances for the HTML to say something the text
 * does not — and on this product the text says things like which case id, whether
 * a code is enclosed, and that we never send a link that signs you in. One
 * function, one source of truth, and `text-to-html.test.ts` asserts every word of
 * the text survives into the HTML.
 *
 * ⚠️ ONE VARIABLE. The doc's own instruction is "fix and re-test, one variable at
 * a time", and test 3 (a subject without "Action needed") is explicitly NOT run
 * here. The text part is byte-identical to what shipped before this file existed;
 * the only change on the wire is the presence of an alternative part. If the SCL
 * moves, that is why. If it does not, test 3 is still clean to run.
 *
 * DELIBERATELY PLAIN, because the failure mode is a spam filter and the product
 * is one a phishing email would love to impersonate:
 *   - no images, no remote CSS, no web fonts, no tracking pixel — every remote
 *     fetch is both a spam signal and a claim our privacy page contradicts;
 *   - NO BUTTONS. Anchor text is IDENTICAL to the href, asserted by a test.
 *     A link whose visible text differs from its target is the single strongest
 *     phishing signal there is, and shipping one here would make this worse
 *     rather than better;
 *   - no JavaScript, no forms, no conditional comments;
 *   - inline styles only, and few of them.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2
 */

/**
 * Bare URLs as they appear in our bodies — always `https://`, always terminated
 * by whitespace. Kept deliberately narrow: over-eager linkification of arbitrary
 * text is how a code or a case id becomes a broken anchor.
 */
const URL_IN_TEXT = /https:\/\/[^\s<>"')\]]+/g;

/** Trailing sentence punctuation is prose, not part of the address. */
function splitTrailingPunctuation(url: string): [string, string] {
  const m = /[.,;:!?]+$/.exec(url);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ''];
}

/**
 * HTML-escape. This is the trust boundary, not `cleanPersonName` — that bounds
 * what a name may CONTAIN, this bounds what it can DO once it reaches markup.
 * Applied before any tag is introduced, so no path exists where caller text is
 * interpolated unescaped.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escaped text with bare URLs turned into anchors whose text IS the href. */
function linkify(escaped: string): string {
  return escaped.replace(URL_IN_TEXT, (match) => {
    const [url, tail] = splitTrailingPunctuation(match);
    // `url` is already escaped; it is safe in both the attribute and the body,
    // and using it for both is what keeps anchor text == href.
    return `<a href="${url}" style="color:#3d5a80;">${url}</a>${tail}`;
  });
}

/**
 * An indented line — our bodies use four-space indentation for the two things a
 * reader must copy exactly: a URL and a code. Rendered as its own block so it is
 * as scannable in HTML as the indentation makes it in text.
 */
function isIndented(line: string): boolean {
  return /^\s{2,}\S/.test(line);
}

function renderParagraph(block: string): string {
  const lines = block.split('\n');

  if (lines.every((l) => isIndented(l) || !l.trim())) {
    const body = lines
      .map((l) => linkify(escapeHtml(l.trim())))
      .filter(Boolean)
      .join('<br>');
    return (
      `<p style="margin:0 0 16px;padding:12px 16px;background:#f4f1ea;` +
      `border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;` +
      `font-size:15px;letter-spacing:0.02em;">${body}</p>`
    );
  }

  const body = lines
    .map((l) => linkify(escapeHtml(l)))
    .join('<br>');
  return `<p style="margin:0 0 16px;">${body}</p>`;
}

/**
 * Build the HTML alternative for a plain-text body.
 *
 * Returns the complete document. Blank-line-separated blocks become paragraphs;
 * indented blocks become the monospace call-out; bare https URLs become anchors
 * whose visible text is the URL itself.
 */
export function textToHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.replace(/\n+$/, ''))
    .filter((b) => b.trim().length > 0);

  const body = blocks.map(renderParagraph).join('\n');

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Relay</title></head>\n` +
    `<body style="margin:0;padding:0;background:#ffffff;">\n` +
    `<div style="max-width:560px;margin:0 auto;padding:24px;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:16px;line-height:1.5;color:#2b2b2b;">\n` +
    `${body}\n` +
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e0d5;` +
    `font-size:13px;color:#6b6459;">Relay — relaystandby.com</p>\n` +
    `</div>\n</body>\n</html>`
  );
}
