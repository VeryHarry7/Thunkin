import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // Every image the app renders is same-origin: results are re-hosted into
  // local storage on completion and served from /api/assets. There is no
  // remote host to allow, and adding one would mean rendering a provider URL
  // that expires.
  images: {
    remotePatterns: [],
  },

  // Surfaced as a build failure rather than a silent pass — a type or lint
  // error must never reach a deploy.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default config;
