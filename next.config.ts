import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg"],
  async redirects() {
    return process.env.VERCEL_ENV === "production" &&
      process.env.APP_URL === "https://autonote.bittrees.org"
      ? [
          {
            source: "/:path*",
            has: [
              { type: "host" as const, value: "autonote-gamma.vercel.app" },
            ],
            destination: "https://autonote.bittrees.org/:path*",
            permanent: false,
          },
        ]
      : [];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self)" },
        ],
      },
    ];
  },
};
export default config;
