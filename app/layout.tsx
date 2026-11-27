import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Gloock, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { STORES } from "@/src/lib/stores";
import { RESULTS_URL_MARK_SCRIPT } from "@/src/lib/results-url-mark";
import "./globals.css";

// Self-hosted by next/font at build time: no font request leaves the browser at runtime.
const display = Gloock({ variable: "--font-gloock", subsets: ["latin"], weight: "400", display: "swap" });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
// Arabic product titles: Plex's own Arabic companion, so mixed-script titles share one rhythm.
const plexArabic = IBM_Plex_Sans_Arabic({ variable: "--font-plex-arabic", subsets: ["arabic"], weight: ["400", "500", "600"], display: "swap", preload: false });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: "400", display: "swap", preload: false });

const storeList = STORES.map((s) => s.label);

export const metadata: Metadata = {
  title: "Deal search",
  description: `Search ${storeList.slice(0, -1).join(", ")} and ${storeList.at(-1)} at once and rank the results by price, discount or deal.`,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Before first paint, a results URL marks <html> (src/lib/results-url-mark.ts), so the home does
    // not flash and collapse; suppressHydrationWarning: that attribute is added before hydration.
    <html lang="en" className={`${display.variable} ${plex.variable} ${plexArabic.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESULTS_URL_MARK_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
