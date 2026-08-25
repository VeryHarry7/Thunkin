import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // AGENT-05 (Asset Pipeline) adds the R2/S3 asset host here once the bucket
  // exists. Until then every image the app renders is same-origin.
  images: {
    remotePatterns: [],
  },

  // Surfaced as a build failure rather than a silent pass — a type or lint
  // error must never reach a deploy.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default config;
