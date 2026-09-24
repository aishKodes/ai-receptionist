import type { NextConfig } from "next";
import path from "node:path";

// Hostinger's manually uploaded apps do not reliably surface custom variables
// while compiling. This deployment targets MySQL by default; local SQLite work
// remains available when it is explicitly requested.
const usesMysql = process.env.DATABASE_PROVIDER !== "sqlite";

const nextConfig: NextConfig = {
  agentRules: false,
  // Hostinger makes build-time variables available to Next's compiler, but a
  // manual deployment can omit a non-secret selector from the runtime process.
  // Preserve only the selected provider so the server chooses the same adapter
  // that the build was prepared for; credentials remain runtime-only.
  env: {
    RADIANCE_BUILD_DATABASE_PROVIDER: usesMysql ? "mysql" : "sqlite",
  },
  // MySQL production builds deliberately omit the native SQLite package.
  // Keeping it external in that mode makes the server require it before the
  // MySQL adapter can be selected.
  // mysql2 is loaded inside a Node worker. Mark it external so Next retains
  // the real module in the server dependency trace instead of only bundling
  // its parent route code.
  serverExternalPackages: usesMysql ? ["mysql2"] : ["better-sqlite3"],
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
