import type { Metadata } from "next"
import Link from "next/link"
import { LauncherDownloadButtons, type DownloadOption } from "@/components/launcher-download-buttons"
import {
  LAUNCHER_RELEASES_URL,
  formatSize,
  getLauncherRelease,
  type LauncherPlatform,
} from "@/lib/launcher-release"

export const metadata: Metadata = {
  title: "JK2 Launcher — JK2 Capture the Flag",
  description:
    "Download the JK2 Launcher for Windows, macOS or Linux: installs and updates JK2 clients, finds your Steam copy, and gets you into a server in one click.",
}

// Re-rendered at most every ten minutes, so a new launcher release shows up
// here without a deploy. The download links themselves go through
// /download/[platform] and are always current regardless.
export const revalidate = 600

const PLATFORM_LABELS: Record<LauncherPlatform, { label: string; note: string }> = {
  windows: { label: "Windows", note: "64-bit installer" },
  mac: { label: "macOS", note: "Apple Silicon" },
  linux: { label: "Linux", note: "AppImage · Steam Deck" },
}

interface Step {
  title: string
  body: React.ReactNode
  image?: { src: string; alt: string }
}

// The guide. Screenshots are the real launcher UI (public/launcher/); if the
// UI moves on, retake them rather than letting the words and pictures drift.
const STEPS: Step[] = [
  {
    title: "Install it",
    body: (
      <div className="space-y-3">
        <p>
          <strong className="text-[#c5c6c7]">Windows:</strong>{" "}run the installer. Windows may show{" "}
          <em>&ldquo;Windows protected your PC&rdquo;</em>{" "}because the launcher isn&apos;t signed with a paid
          certificate yet - click <strong className="text-[#c5c6c7]">More info</strong>, then{" "}
          <strong className="text-[#c5c6c7]">Run anyway</strong>.
        </p>
        <p>
          <strong className="text-[#c5c6c7]">macOS:</strong>{" "}open the .dmg and drag JK2 Launcher into
          Applications. The first time you open it, macOS will refuse because it isn&apos;t notarised by Apple.
          Open <strong className="text-[#c5c6c7]">System Settings → Privacy &amp; Security</strong>, scroll down,
          and click <strong className="text-[#c5c6c7]">Open Anyway</strong>. On older macOS versions,
          right-click the app and choose <strong className="text-[#c5c6c7]">Open</strong>{" "}instead. You only do
          this once. Intel Macs aren&apos;t supported yet.
        </p>
        <p>
          <strong className="text-[#c5c6c7]">Linux / Steam Deck:</strong>{" "}make the AppImage executable
          (right-click → Properties → Permissions, or <code className="text-[#66fcf1]">chmod +x</code>) and run
          it. On a Steam Deck, do this from Desktop Mode.
        </p>
      </div>
    ),
  },
  {
    title: "Check it found your game",
    body: (
      <p>
        The launcher looks for your Steam copy of Jedi Outcast by itself. A green dot and{" "}
        <strong className="text-[#c5c6c7]">Steam install</strong>{" "}under Clients in the sidebar means you&apos;re
        set. If it says <em>Not found</em>, click <strong className="text-[#c5c6c7]">Change...</strong>{" "}and
        point it at your game folder. Don&apos;t own the game yet? There&apos;s a link to it on Steam right there.
      </p>
    ),
    image: { src: "/launcher/home.webp", alt: "The launcher's Home screen, with Steam install detected in the sidebar" },
  },
  {
    title: "Install a client",
    body: (
      <div className="space-y-3">
        <p>
          Pick a client in the sidebar and click <strong className="text-[#c5c6c7]">Install</strong>. Which one
          you want depends on what you play:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-[#c5c6c7]">Defrag/FFA - Tommyternal</strong>{" "}for defrag, FFA and most
            public servers.
          </li>
          <li>
            <strong className="text-[#c5c6c7]">JK2MV</strong>, the modernised engine the others build on.
          </li>
          <li>
            <strong className="text-[#c5c6c7]">Capture the Flag - NWH</strong>, the anti-cheat client organised
            CTF runs on. Linux-only for now.
          </li>
          <li>
            <strong className="text-[#c5c6c7]">OpenJO</strong>{" "}for the single-player campaign.
          </li>
        </ul>
      </div>
    ),
    image: { src: "/launcher/install.webp", alt: "A client page with its Install button" },
  },
  {
    title: "Play",
    body: (
      <p>
        Once a client is installed, its page shows <strong className="text-[#c5c6c7]">Play</strong>, plus{" "}
        <strong className="text-[#c5c6c7]">Update</strong>{" "}when a new version is out.
      </p>
    ),
    image: { src: "/launcher/installed.webp", alt: "An installed client with Play and Uninstall buttons" },
  },
  {
    title: "Join a server",
    body: (
      <p>
        <strong className="text-[#c5c6c7]">Servers</strong>{" "}lists the community servers with their map and
        player count. Click one to see who&apos;s on and join with any installed client. Star up to three to
        pin them to Home. Playing somewhere that isn&apos;t listed? Paste its address into{" "}
        <strong className="text-[#c5c6c7]">Add server</strong>.
      </p>
    ),
    image: { src: "/launcher/servers.webp", alt: "The Servers page with a server expanded to show its players and a Join button" },
  },
  {
    title: "One-click CTF and defrag",
    body: (
      <p>
        <strong className="text-[#c5c6c7]">Play CTF</strong>{" "}and <strong className="text-[#c5c6c7]">Play Defrag</strong>{" "}
        on Home drop you straight into a server. The gear beside each one picks which server and which client
        it uses.
      </p>
    ),
    image: { src: "/launcher/pinned.webp", alt: "The Customize Play CTF dialog, choosing a server and client" },
  },
  {
    title: "Add maps and mods",
    body: (
      <p>
        <strong className="text-[#c5c6c7]">Mods</strong>{" "}takes any PK3 - a map, a skin pack - either from your
        computer with <strong className="text-[#c5c6c7]">Add PK3...</strong>{" "}or from the Monolith community
        catalogue. Choose <strong className="text-[#c5c6c7]">All Clients</strong>{" "}or a specific one, and the
        launcher puts it where that client actually reads it.
      </p>
    ),
    image: { src: "/launcher/mods.webp", alt: "The Mods page with two PK3s, one for all clients and one for a single client" },
  },
  {
    title: "Staying up to date",
    body: (
      <p>
        The launcher checks for its own updates when it starts. To check by hand, open{" "}
        <strong className="text-[#c5c6c7]">Support / FAQ</strong>{" "}and click{" "}
        <strong className="text-[#c5c6c7]">Check for Updates</strong>{" "}at the bottom.
      </p>
    ),
    image: { src: "/launcher/updates.webp", alt: "The Support page with the Check for Updates button" },
  },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#66fcf1] mb-5"
      style={{ fontFamily: "var(--font-orbitron)" }}
    >
      {children}
    </h2>
  )
}

export default async function LauncherPage() {
  const release = await getLauncherRelease()

  const options: DownloadOption[] = (Object.keys(PLATFORM_LABELS) as LauncherPlatform[]).map((platform) => {
    const asset = release?.primary[platform]
    const { label, note } = PLATFORM_LABELS[platform]
    return { platform, label, detail: asset ? `${note} · ${formatSize(asset.size)}` : note }
  })

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl relative z-10">
      <div className="text-center mb-14">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#66fcf1]">Download</span>
        <h1 className="text-3xl md:text-4xl font-bold text-white mt-2 mb-3" style={{ fontFamily: "var(--font-orbitron)" }}>
          JK2 Launcher
        </h1>
        <p className="text-sm md:text-base text-[#8892a0] leading-relaxed max-w-xl mx-auto mb-8">
          Installs and updates JK2 clients for you, finds your Steam copy of Jedi Outcast, and gets you into a
          server in one click. Free, for Windows, macOS and Linux.
        </p>
        <LauncherDownloadButtons options={options} />
        <p className="mt-5 text-xs text-[#6b7a8a]">
          {release ? `Version ${release.version}` : "Latest version"} ·{" "}
          <a href={release?.pageUrl ?? LAUNCHER_RELEASES_URL} className="text-[#66fcf1]/80 hover:text-[#66fcf1] hover:underline">
            Release notes
          </a>
          {release && release.linuxExtras.length > 0 && (
            <>
              {" "}
              · Linux packages:{" "}
              {release.linuxExtras.map((a, i) => (
                <span key={a.name}>
                  {i > 0 && ", "}
                  <a href={a.url} className="text-[#66fcf1]/80 hover:text-[#66fcf1] hover:underline">
                    .{a.name.split(".").pop()}
                  </a>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      <section className="mb-12">
        <SectionLabel>Getting started</SectionLabel>
        <ol className="space-y-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-5 md:p-6">
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-sm font-bold text-[#66fcf1]" style={{ fontFamily: "var(--font-orbitron)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-[#e6edf3] font-semibold">{step.title}</h3>
              </div>
              <div className="text-sm text-[#8892a0] leading-relaxed">{step.body}</div>
              {step.image && (
                // Plain <img>: next.config has images.unoptimized, and these
                // are already sized and compressed WebP.
                <img
                  src={step.image.src}
                  alt={step.image.alt}
                  loading="lazy"
                  className="mt-5 w-full rounded-md border border-[#3d4855]"
                />
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="text-center border-t border-[#3d4855] pt-8">
        <p className="text-sm text-[#8892a0]">
          Stuck? The{" "}
          <Link href="/faq" className="text-[#66fcf1] hover:underline">
            FAQ
          </Link>{" "}
          covers the usual snags, and the community Discord is where admins and other players actually are.
        </p>
      </section>
    </div>
  )
}
