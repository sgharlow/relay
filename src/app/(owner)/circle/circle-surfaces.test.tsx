/**
 * Do the new surfaces actually RENDER, and does the honest copy reach the DOM?
 *
 * 🔴 WHY THIS FILE EXISTS. Six components were written or rewritten in the
 * deliverability pass, `tsc` and `next build` both passed, and not one of them
 * had ever produced a single character of output. A type-check proves the props
 * line up; it does not prove a component returns anything, that a branch is
 * reachable, or that the sentence an owner reads is the sentence that was
 * written. This repo's whole recurring defect is a green signal measuring
 * something adjacent to the question — "it compiles" is exactly that shape.
 *
 * `renderToStaticMarkup` needs no new dependency (react-dom is already here) and
 * no DOM environment, so these run in the same `node` suite as everything else
 * and keep running in CI. It is NOT a substitute for looking at the page —
 * layout, colour and spacing are not tested here — but it does pin the thing
 * that actually matters about these components, which is what they SAY.
 *
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import DeliveryLine from './DeliveryLine';
import ProviderRiskLine from './ProviderRiskLine';
import DrillLine from './DrillLine';
import SecondAddressControl from './SecondAddressControl';
import FireDrillControl from './FireDrillControl';
import DrillCard from '../../(access)/standby/DrillCard';

const noop = async () => {};

/** Markup with tags stripped, so assertions read against what a human sees. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const delivered = {
  event: 'email.delivered',
  detail: null,
  occurredAt: '2026-08-14T09:00:00.000Z',
  verdict: 'delivered' as const,
};

describe('DeliveryLine', () => {
  it('renders the honest sentence for a delivered event', () => {
    const out = text(
      renderToStaticMarkup(<DeliveryLine name="Alex" email="alex@gmail.com" delivery={delivered} />),
    );
    expect(out).toContain('accepted our last email');
    expect(out.toLowerCase()).toContain('inbox');
  });

  /*
    THE REGRESSION THAT MATTERS. If this sentence ever comes back, an owner is
    being told in calm that a channel works on the one piece of evidence that
    cannot show it.
  */
  it('never renders the old false green', () => {
    for (const email of ['alex@gmail.com', 'alex@outlook.com']) {
      const out = text(
        renderToStaticMarkup(<DeliveryLine name="Alex" email={email} delivery={delivered} />),
      );
      expect(out, email).not.toContain('Email reached');
    }
  });

  it('is harder about a Microsoft mailbox', () => {
    const out = text(
      renderToStaticMarkup(
        <DeliveryLine name="Alex" email="alex@outlook.com" delivery={delivered} />,
      ),
    );
    expect(out.toLowerCase()).toContain('junk');
  });

  it('renders NOTHING when nothing has been heard — silence is not reassurance', () => {
    expect(renderToStaticMarkup(<DeliveryLine name="Alex" email="alex@gmail.com" />)).toBe('');
    expect(
      renderToStaticMarkup(
        <DeliveryLine
          name="Alex"
          email="alex@gmail.com"
          delivery={{ ...delivered, verdict: 'unknown' }}
        />,
      ),
    ).toBe('');
  });
});

describe('ProviderRiskLine', () => {
  it('warns on an Outlook-family address and names both actions', () => {
    const out = text(renderToStaticMarkup(<ProviderRiskLine name="Alex" email="alex@outlook.com" />));
    expect(out).toContain('Alex');
    expect(out.toLowerCase()).toContain('junk');
    expect(out).toContain('relay@relaystandby.com');
  });

  it('renders nothing for a provider we have measured nothing about', () => {
    expect(renderToStaticMarkup(<ProviderRiskLine name="Alex" email="alex@gmail.com" />)).toBe('');
  });
});

describe('DrillLine', () => {
  it('renders the amber sentence for a rehearsal nobody answered', () => {
    const out = text(
      renderToStaticMarkup(
        <DrillLine name="Lee" drill={{ sentAt: '2026-01-01T00:00:00.000Z', acknowledgedAt: null }} />,
      ),
    );
    expect(out).toContain('did not answer');
    expect(out).toContain('Lee');
  });

  it('renders nothing when no drill was ever run', () => {
    expect(renderToStaticMarkup(<DrillLine name="Lee" drill={null} />)).toBe('');
  });
});

describe('SecondAddressControl', () => {
  const person = { id: 'p1', name: 'Alex', email: 'alex@outlook.com', role: 'executor' };

  it('offers to add one when there is none', () => {
    const out = text(
      renderToStaticMarkup(
        <SecondAddressControl personType="recipient" person={person} onChanged={noop} />,
      ),
    );
    expect(out).toContain('Add a second address');
  });

  it('shows the address once it is set', () => {
    const out = text(
      renderToStaticMarkup(
        <SecondAddressControl
          personType="recipient"
          person={{ ...person, email_secondary: 'alex@gmail.com' }}
          onChanged={noop}
        />,
      ),
    );
    expect(out).toContain('alex@gmail.com');
  });
});

describe('FireDrillControl', () => {
  it('renders the button and says what the silence would mean', () => {
    const out = text(renderToStaticMarkup(<FireDrillControl onRun={noop} />));
    expect(out).toContain('Run a practice run');
    expect(out.toLowerCase()).toContain('does not answer');
  });
});

describe('DrillCard (the verifier side)', () => {
  it('leads with the fact that nothing is wrong, and offers one button', () => {
    const out = text(renderToStaticMarkup(<DrillCard onAcknowledged={() => {}} />));
    expect(out).toContain('This is only practice');
    expect(out.toLowerCase()).toContain('nothing has happened');
    expect(out).toContain('I got this');
  });

  /*
    A rehearsal that carries a credential, or a link that acts, would defeat the
    point twice over — see the module header. Rendered proof there is neither.
  */
  it('contains no link and nothing to type', () => {
    const markup = renderToStaticMarkup(<DrillCard onAcknowledged={() => {}} />);
    expect(markup).not.toContain('<a ');
    expect(markup).not.toContain('token=');
    expect(markup).not.toContain('<input');
  });
});
