import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { DISPLAY_MODE_INIT_SCRIPT } from "@/lib/displayMode";

// All three faces are self-hosted from ./fonts, so nothing contacts Google
// Fonts at build or dev startup (that request timed out on some networks and
// dropped the whole UI to system fonts). The files are the exact latin-subset
// woff2s Google serves for the same requests next/font/google used to make;
// re-fetch from fonts.googleapis.com/css2 if a face ever needs updating.

// Inter carries all UI text, numerals included. The file is the variable font
// with the optical-size axis (opsz 14–32) alongside weight (100–900), which
// ships the display cut the header tier opts into via `font-optical-sizing`
// (see .display in globals).
const inter = localFont({
  src: [{ path: "./fonts/inter-latin-opsz-wght.woff2", weight: "100 900", style: "normal" }],
  display: "swap",
  variable: "--font-sans",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mono",
});

// One handwritten face, for one thing: the sticker on Monk Mode's daily note.
// It is deliberately not available as a general option — a second lettering
// style loose in a CRM is how a design system stops being one — and it is
// loaded here rather than in the feature because next/font wants to hoist the
// declaration and put the preload in <head>. Caveat is a variable font, so
// both weights come from the one file, declared at 600 and 700 only.
const caveat = localFont({
  src: [
    { path: "./fonts/caveat-latin-wght.woff2", weight: "600", style: "normal" },
    { path: "./fonts/caveat-latin-wght.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-hand",
});

export const metadata: Metadata = {
  title: "Spine Scale Ops",
  description: "Internal ops CRM for Spine Scale",
  icons: { icon: "/logo-icon.png", apple: "/apple-touch-icon.png" },
  // Added to the home screen, iOS runs the app in a standalone window. The
  // translucent status bar lets the page draw under it, which is what the
  // mobile top bar's safe-area padding is for (see MobileTopBar).
  appleWebApp: {
    capable: true,
    title: "Spine Scale",
    statusBarStyle: "black-translucent",
  },
};

// The phone-shaped half of the page contract.
//
// viewport-fit=cover lets the layout reach under the notch and the home
// indicator, and every edge that meets one pads itself by the matching
// env(safe-area-inset-*). resizes-content asks the browser to shrink the
// layout viewport when the on-screen keyboard opens, so the copilot's input
// stays above it; Safari ignores the key, and the copilot page has its own
// visualViewport fallback for that. Zoom is deliberately left alone — no
// maximum-scale, no user-scalable=no: the 16px form fields in globals.css are
// what stop iOS zooming on focus, not a lock on the reader's own pinch.
//
// themeColor is the browser chrome's tint, one per OS scheme. The in-app
// toggle can disagree with the OS, so applyTheme() (lib/theme.ts) rewrites
// these tags to match whichever theme is actually on the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FEFEFE" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0E14" },
  ],
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
        {/* Same reason, for Guided / Pro: a Pro browser never shows the
            Guided text for a frame. See lib/displayMode.ts. */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_MODE_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${plexMono.variable} ${caveat.variable} font-sans`}>{children}</body>
    </html>
  );
}
