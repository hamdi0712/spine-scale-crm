import type { MetadataRoute } from "next";

// Installable, and nothing more. There is deliberately no service worker and
// no offline cache: every page reads the live database through the server, so
// a cached shell would only ever open onto an error. What this buys is the
// home-screen icon and a standalone window without the browser's chrome —
// the mobile layout (AppShell) already handles the notch and the home
// indicator through the safe-area insets.
//
// The two colours are the light theme's page floor and brand blue, the same
// values as --c-bg and --c-accent in globals.css. The splash screen a phone
// draws while the app loads uses these, and it is drawn before any CSS exists.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spine Scale",
    short_name: "Spine Scale",
    description: "Internal ops CRM for Spine Scale",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FEFEFE",
    theme_color: "#126DFB",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
