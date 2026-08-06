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

const SITE_URL = "https://relay-three-henna.vercel.app";
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
