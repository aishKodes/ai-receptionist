import type { NextConfig } from "next";
import path from "node:path";

const usesMysql = process.env.DATABASE_PROVIDER === "mysql";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: process.cwd() },
  webpack: (config, { isServer }) => {
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
