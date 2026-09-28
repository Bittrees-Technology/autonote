import type { Metadata } from "next";
import Workspace from "./workspace";
import {
  siteUrl,
  siteTitle,
  siteDescription,
  socialImage,
} from "../../lib/seo";
export const metadata: Metadata = {
  alternates: { canonical: siteUrl },
  openGraph: {
    url: siteUrl,
    title: siteTitle,
    description: siteDescription,
    images: [socialImage],
  },
};
export default function Page() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "AutoNote",
        description: siteDescription,
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        name: "AutoNote",
        url: siteUrl,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web browser",
        description: siteDescription,
        isAccessibleForFree: true,
        license: "https://opensource.org/license/mit",
        image: `${siteUrl}/social-preview.png`,
      },
    ],
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(data).replace(/</g, "\\u003c"),
        }}
      />
      <Workspace />
    </>
  );
}
