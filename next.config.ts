import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // api-anything resolves its specs dir at runtime (new URL("../sites", import.meta.url));
  // bundling it breaks that, so Node loads it from node_modules instead.
  serverExternalPackages: ["api-anything"],
};

export default nextConfig;
