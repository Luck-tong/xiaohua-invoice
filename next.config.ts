import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/xiaohua-invoice",
  assetPrefix: "/xiaohua-invoice/",
  trailingSlash: true,
};

export default nextConfig;
