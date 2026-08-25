import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";

/**
 * Two faces, both self-hosted by next/font so there is no layout shift from a
 * swap and no third-party request.
 *
 * Sora carries headings — geometric, slightly wide, and it holds up at the
 * hero sizes where a UI face would look generic. Inter does everything else,
 * because the studio is full of small controls that just have to be legible.
 */
const display = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display-face",
  display: "swap",
});

const ui = Inter({
  subsets: ["latin"],
  variable: "--font-ui-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Thunkin",
  description: "AI photo and video, at the press of a shutter button.",
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  // Safe-area insets have to resolve for the mobile shell's bottom controls.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
