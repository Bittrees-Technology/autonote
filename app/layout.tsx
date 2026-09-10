import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AutoNote · Bittrees",
  description:
    "A clear record of every conversation. Private meeting transcripts, notes, and next steps.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
