import type { NextConfig } from "next";
import path from "node:path";

const usesMysql = process.env.DATABASE_PROVIDER === "mysql";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: process.cwd() },
  webpack: (config, { isServer }) => {
    // Hostinger installs production dependencies only, which means Next cannot
    // rely on TypeScript being present to read the `@/*` tsconfig path mapping.
    // Keep the runtime resolver explicit for both client and server bundles.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": process.cwd(),
    };

    if (usesMysql && isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "better-sqlite3": path.join(process.cwd(), "db/sqlite-unavailable.ts"),
      };
    }
    return config;
  },
};

export default nextConfig;
