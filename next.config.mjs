import { networkInterfaces } from "node:os"
import { PHASE_PRODUCTION_BUILD } from "next/constants.js"
import { EXPECTED_ENGINE_VERSION } from "./engine-version.mjs"

/**
 * This machine's own LAN addresses, so a phone can reach `next dev`.
 *
 * Testing the viewer on a real device means loading the dev server over the
 * network rather than localhost, and Next blocks cross-origin requests to its
 * dev resources by default. The failure is the worst possible shape: the
 * document and the server-rendered markup arrive fine, so the page looks like
 * it loaded, but hydration never completes and no effect ever runs. For the
 * demo viewer that means it sits forever on the initial status text --
 * "Starting the engine…" -- which is indistinguishable from an engine that
 * failed to boot, and sent us looking for an iOS memory problem that was not
 * there. It reproduces identically in desktop Chromium over a LAN IP, which is
 * what proved it had nothing to do with the phone.
 *
 * Read off the interfaces rather than hard-coded, because DHCP moves it and a
 * stale literal here would resurrect exactly the same dead end. Dev only --
 * Next ignores this outside `next dev`.
 */
function lanOrigins() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: lanOrigins(),
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
  const raw = process.env.NEXT_PUBLIC_DEMO_ENGINE_URL
  // Trim, and push the trimmed value back into the environment BEFORE Next
  // inlines it. A pasted value with a trailing newline otherwise fails the
  // version compare with two visually identical strings -- the error message
  // literally printed the closing quote on the next line before anyone saw
  // it -- and even with the compare fixed, the newline would reach the
  // browser as %0A in every engine fetch URL. Happened for real, 15 Aug 2026.
  const url = raw?.trim()
  if (url && url !== raw) {
    process.env.NEXT_PUBLIC_DEMO_ENGINE_URL = url
  }
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

