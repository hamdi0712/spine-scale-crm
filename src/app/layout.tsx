import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Inter carries all UI text, numerals included. Requesting the optical-size
// axis alongside weight ships the variable font's display cut, which the
// header tier opts into via `font-optical-sizing` (see .display in globals).
const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Spine Scale Ops",
  description: "Internal ops CRM for Spine Scale",
  icons: { icon: "/logo-icon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // <html> deliberately carries no className from React, and the font
  // variables ride on <body> instead.
  //
  // The theme class lives on <html>, put there by the pre-paint script below
  // before React exists. If React also rendered a className onto that element
  // it would own the attribute, and any later render of the root layout would
  // write its own value over the top — taking the theme class with it. That is
  // not hypothetical: a server `redirect()` (/settings → /settings/api-keys)
  // re-renders the root layout on the client, and the page came back light.
  //
  // Nothing is lost by moving the font variables down: every consumer of
  // --font-sans and --font-mono is inside <body>.
  //
  // suppressHydrationWarning still belongs here, because the script sets an
  // inline color-scheme that the server's markup does not have.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Ahead of the stylesheet and of anything React renders: this is what
            puts `dark` on <html> before the first pixel, so a dark-mode
            visitor never sees a white flash on load. See lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${plexMono.variable} font-sans`}>{children}</body>
    </html>
  );
}
