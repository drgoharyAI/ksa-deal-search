import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Gloock, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { STORES } from "@/src/lib/stores";
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

/**
 * Before first paint: a results URL (a shared link, a reload, a History re-run) marks <html>, so the
 * prerendered home stays hidden instead of showing and then collapsing into the results layout (a
 * large layout shift). The search page removes the mark once it shows results or finds no query.
 */
const RESULTS_URL_MARK = "try{if((new URLSearchParams(location.search).get('q')||'').trim())document.documentElement.setAttribute('data-results-url','')}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline script may add data-results-url to <html> before React hydrates.
    <html lang="en" className={`${display.variable} ${plex.variable} ${plexArabic.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESULTS_URL_MARK }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
