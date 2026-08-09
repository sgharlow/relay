import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Two faces, one job each — this is what makes the two modes unmistakable.
 *
 * Public Sans carries owner mode: open apertures and a tall x-height, drawn to
 * stay legible to a 78-year-old on a five-year-old phone. Newsreader carries
 * access mode and marketing headlines, so anything a person READS looks
 * written rather than shipped.
 *
 * Self-hosted rather than fetched at build time: Norton's TLS interception on
 * the workstation this is maintained from breaks the font fetcher, and a build
 * that only works on some machines is not a build. These replace Geist, which
 * was downloaded on every page load and never referenced.
 */
const publicSans = localFont({
  src: "./fonts/PublicSans-var.woff2",
  variable: "--font-public-sans",
  weight: "400 700",
  display: "swap",
});
const newsreader = localFont({
  src: "./fonts/Newsreader-var.woff2",
  variable: "--font-newsreader",
  weight: "400 600",
  display: "swap",
});

/**
 * The canonical public origin. Every og:url and og:image is resolved against
 * this, so a stale value silently mis-declares the whole site: until 2026-08-08
 * this read `relay-three-henna.vercel.app`, meaning every link preview and every
 * ad-platform crawl of the paid landing page pointed at the pre-domain
 * deployment rather than at relaystandby.com.
 *
 * NEXT_PUBLIC_SITE_URL lets previews declare themselves correctly; the literal
 * is the production fallback, because an unset variable must not resurrect a
 * wrong domain.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://relaystandby.com";
const SITE_DESCRIPTION =
  "Living-continuity vault — reversible emergency access, permanent estate handoff.";

export const metadata: Metadata = {
  // metadataBase makes the opengraph-image URL absolute, which link unfurlers require.
  metadataBase: new URL(SITE_URL),
  title: "Relay",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Relay",
    url: SITE_URL,
    title: "Relay — standby access for the people who'll need it",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay — standby access for the people who'll need it",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /*
      The font variables go on <html>, not <body>.

      next/font defines --font-public-sans on whatever element carries the
      class. globals.css composes --font-ui from it at :root — and a var()
      inside a custom property resolves in the scope where that property is
      DECLARED. With the class on <body>, --font-public-sans did not exist at
      :root, so --font-ui silently collapsed to its fallback and the whole app
      rendered in ui-sans-serif. That is precisely the Arial bug again: the font
      downloads, the variable is declared, and nothing uses it.
    */
    <html lang="en" className={`${publicSans.variable} ${newsreader.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
