import type { Metadata } from "next";
import { siteUrl, siteTitle, siteDescription, socialImage } from "../lib/seo";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "AutoNote",
  title: { default: siteTitle, template: "%s | AutoNote" },
  description: siteDescription,
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "AutoNote",
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [socialImage],
  },
  robots:
    process.env.VERCEL_ENV === "preview"
      ? { index: false, follow: false }
      : { index: true, follow: true },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
