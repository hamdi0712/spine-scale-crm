import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexMono.variable}`}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
