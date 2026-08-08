/**
 * robots.txt — previously a 404.
 *
 * Two reasons this matters before paid traffic. Ad-platform crawlers (Meta,
 * Reddit) fetch it while reviewing a landing page, and a 404 is one more small
 * anomaly on a domain with no history. More importantly it keeps the private
 * surface out of search results: the owner app, the recipient-access routes and
 * every API path are behind auth, but they should not be indexed either, and
 * /caregivers/interest must stay unindexed so the G1 intent count reflects paid
 * clicks rather than organic search arrivals.
 *
 * The interest page also carries `robots: { index: false }` in its own metadata.
 * That header is the authoritative signal — this file is the coarse one. Both,
 * because robots.txt is advisory and a disallowed page can still be indexed
 * from an external link if it never gets crawled to see the header.
 *
 * Feature: relay-g1-wtp
 */

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/caregivers', '/privacy', '/terms'],
      disallow: ['/api/', '/auth/', '/vault', '/start', '/access', '/verify', '/caregivers/interest'],
    },
    sitemap: 'https://relaystandby.com/sitemap.xml',
  };
}
