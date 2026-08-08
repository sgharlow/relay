import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
