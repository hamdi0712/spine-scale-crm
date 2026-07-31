import type { Metadata } from "next";
import { DM_Sans, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// DM Sans carries all UI text; Inter is reserved for numerals (tabular).
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-num",
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
      className={`${dmSans.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
