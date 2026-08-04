/**
 * The engine build this page is written against.
 *
 * The page and the engine deploy separately -- the engine is 125MB of WASM and
 * assets on R2, the page is a Vercel build -- and the only thing tying them
 * together is NEXT_PUBLIC_DEMO_ENGINE_URL. That value is *inlined at build
 * time*, so setting it in Vercel changes nothing until something rebuilds, and
 * a cached redeploy can carry the old one forward. Saving the variable and
 * shipping it are two separate events, and nothing in the dashboard says so.
 *
 * That has now shipped the wrong pairing three times, most recently sending a
 * page that offers demo trimming to an engine with no trimming in it.
 *
 * So the expected version lives here, in the repo, where it is reviewable in a
 * diff -- and next.config.mjs fails the production build if the environment
 * disagrees with it. Bumping the engine is now two deliberate edits that have
 * to match, rather than one silent one that might not.
 */
export const EXPECTED_ENGINE_VERSION = "20260804-1452"
