import { PHASE_PRODUCTION_BUILD } from "next/constants.js"
import { EXPECTED_ENGINE_VERSION } from "./engine-version.mjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

/**
 * Refuse to build a page pointed at the wrong engine.
 *
 * NEXT_PUBLIC_* is inlined at build time, so the engine URL is decided here and
 * then frozen into the bundle. Get it wrong and nothing complains: the site
 * deploys, loads, and quietly runs a page against an engine that does not match
 * it -- which is how a build offering demo trimming reached production against
 * an engine that had never heard of trimming.
 *
 * Checked only on a production build, so local development is unaffected by a
 * missing or experimental value.
 */
function assertEngineVersion() {
  const url = process.env.NEXT_PUBLIC_DEMO_ENGINE_URL
  const fix = [
    "",
    "  Set it in the Vercel project settings, then redeploy WITHOUT the build cache",
    "  (a cached redeploy keeps the old inlined value).",
    "",
    `  Expected version: ${EXPECTED_ENGINE_VERSION}  -- from engine-version.mjs`,
    "  If you meant to ship a different engine, change that file in the same commit.",
    "",
  ].join("\n")

  if (!url) {
    throw new Error(`NEXT_PUBLIC_DEMO_ENGINE_URL is not set, so the demo player would have no engine.\n${fix}`)
  }
  // Trailing slashes are easy to paste in and would otherwise fail the compare.
  const actual = url.replace(/\/+$/, "").split("/").pop()
  if (actual !== EXPECTED_ENGINE_VERSION) {
    throw new Error(
      `NEXT_PUBLIC_DEMO_ENGINE_URL points at engine "${actual}", but this page expects ` +
        `"${EXPECTED_ENGINE_VERSION}".\n${fix}`,
    )
  }
  console.log(`✓ demo engine ${EXPECTED_ENGINE_VERSION}`)
}

export default function config(phase) {
  if (phase === PHASE_PRODUCTION_BUILD) assertEngineVersion()
  return nextConfig
}
