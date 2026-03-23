import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZurichStudioRadar",
  description: "Local rental listing aggregator for true studio apartments in the Canton of Zurich."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
