import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/seo";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      ...(process.env.VERCEL_ENV === "preview"
        ? { disallow: "/" }
        : { allow: "/", disallow: ["/api/", "/connect/"] }),
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
