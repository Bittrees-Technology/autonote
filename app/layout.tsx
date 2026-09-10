import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://autonote.bittrees.org"),
  title: "AutoNote · Private meeting notes by Bittrees",
  description:
    "Turn recordings into transcripts, quoted highlights, and reviewed next steps. Audio stays on your device. Start with the free AutoNote beta.",
  openGraph: {
    title: "AutoNote · Good conversations. Clear next steps.",
    description:
      "Private meeting transcripts and editable notes, with on-device audio processing. Free beta by Bittrees.",
    url: "https://autonote.bittrees.org",
    siteName: "AutoNote",
    type: "website",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
