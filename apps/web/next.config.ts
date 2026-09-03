import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Top-level in Next 16 — no longer under `experimental`.
  reactCompiler: true,
  typedRoutes: true,

  // Next writes its own AGENTS.md/CLAUDE.md into apps/web. The repo already has
  // one at the root and a second, auto-regenerating copy shadows it.
  agentRules: false,

  // @jomma/shared is consumed as TypeScript source from the workspace.
  transpilePackages: ['@jomma/shared'],

  // Native or Node-only modules that must not be bundled into server chunks.
  serverExternalPackages: ['pg', 'pino', 'pino-pretty', '@node-rs/argon2'],

  typescript: {
    // Never ship a build that does not typecheck. This is a payments service.
    ignoreBuildErrors: false,
  },

  // raw_message and msisdns are PII. Keep full URLs out of the fetch log.
  logging: {
    fetches: { fullUrl: false },
  },

  /**
   * docs/api.md documents the public paths as `/v1/*` and `/device/v1/*`, while
   * AGENTS.md puts the route files under `app/api/`. Both are satisfied here:
   * the files live where the repo layout says, and the URLs are what the API
   * contract says.
   */
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: '/api/v1/:path*' },
      { source: '/device/v1/:path*', destination: '/api/device/v1/:path*' },
    ]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
