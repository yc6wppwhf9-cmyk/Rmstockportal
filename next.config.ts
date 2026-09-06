import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Excel workbooks with embedded photos can be many MB; the default server
    // action body limit is 1MB, which rejects them.
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;
