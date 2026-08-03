import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Brand pairing (docs/OS/02-brand/typography.md): Fraunces 600 for
// display/headings, Inter 400/500/600 for body/UI. No other weights load.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "600",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Royal Hardware ERP",
  description: "Inventory, sales, purchases and ledgers for Royal Hardware and M52.",
};

// Spelled out rather than left to the framework default, for the two settings
// that matter on a phone in a shop:
//
//   maximumScale is deliberately absent — capping zoom on a data-dense app is
//   an accessibility failure, and someone reading a 12px SKU in bad light needs
//   to pinch in.
//
//   viewportFit "cover" lets the layout reach under a notch; the safe-area
//   padding in globals.css keeps content clear of it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10263f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
