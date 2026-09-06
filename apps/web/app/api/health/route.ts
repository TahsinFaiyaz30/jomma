import pkg from '@/package.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/health — what is actually running here.
 *
 * Written because the question "did that deploy land?" had no answer. After the
 * repository was recreated and Render's link to it broke, the only way to tell
 * whether a push had reached production was to change something visible and go
 * looking for it — which is a terrible way to find out, and impossible when the
 * change is invisible.
 *
 * `commit` comes from `RENDER_GIT_COMMIT`, which Render sets at build time, so
 * this reports the commit the running build was made from rather than whatever
 * the repository happens to be at now. Null when running anywhere else.
 *
 * Deliberately public and unauthenticated: a health check that needs a
 * credential cannot be used by the thing that is meant to notice the service is
 * down. It exposes a version and a commit hash on a public repository, and
 * nothing else — no configuration, no counts, no database state.
 *
 * Not a substitute for the dashboard's account health. This answers "is the web
 * service up and which build is it", not "can Jomma take a payment".
 */
export function GET() {
  return Response.json(
    {
      ok: true,
      version: pkg.version,
      commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      branch: process.env.RENDER_GIT_BRANCH ?? null,
      time: new Date().toISOString(),
    },
    {
      headers: {
        // Answering from a cache would defeat the point — a cached 200 outlives
        // the process it was describing.
        'cache-control': 'no-store',
      },
    },
  )
}
