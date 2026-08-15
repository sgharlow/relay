/**
 * sitemap.xml — the public pages, and only those.
 *
 * Deliberately excludes /caregivers/interest: it is noindexed, and listing a
 * page here while disallowing it in robots.txt is a contradictory signal.
 *
 * Feature: relay-g1-wtp
 */

import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://relaystandby.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/caregivers`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/security`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    // The A2P 10DLC opt-in URL. Listed because a carrier reviewer has to be able
    // to find and load it, which is the entire reason the page is public.
    { url: `${SITE_URL}/sms`, changeFrequency: 'yearly', priority: 0.3 },
    // Live public pages the list had drifted behind (2026-08-13): the guided
    // demo, the help page, and the user's guide — the three pages an invitation
    // or a search is most likely to want.
    { url: `${SITE_URL}/demo`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/help`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/guide`, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
