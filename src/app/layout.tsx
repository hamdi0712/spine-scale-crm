import type { Metadata, Viewport } from "next";
import { Caveat, Inter, IBM_Plex_Mono } from "next/font/google";
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

// One handwritten face, for one thing: the sticker on Monk Mode's daily note.
// It is deliberately not available as a general option — a second lettering
// style loose in a CRM is how a design system stops being one — and it is
// loaded here rather than in the feature because next/font wants to hoist the
// declaration and put the preload in <head>.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
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
      </head>
      <body className={`${inter.variable} ${plexMono.variable} ${caveat.variable} font-sans`}>{children}</body>
    </html>
  );
}
