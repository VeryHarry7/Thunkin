import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thunkin",
  description: "AI photo and video generation, at the press of a shutter button.",
};

// AGENT-01 owns the real theme color once design tokens land. `viewportFit`
// is here from the start because AGENT-09's mobile shell depends on
// safe-area insets resolving correctly.
export const viewport: Viewport = {
  themeColor: "#08080a",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
