import path from "node:path";
import type { NextConfig } from "next";

const BACKEND_ORIGIN = process.env.SOUNDIFY_BACKEND_URL ?? "https://soundify.mashhad-ix.ir";
const isExport = process.env.OUTPUT_EXPORT === "true";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  ...(isExport ? { output: "export", trailingSlash: true } : {}),
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyTimeout: 90_000,
  },
  ...(!isExport
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${BACKEND_ORIGIN}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
