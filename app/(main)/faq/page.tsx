import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "FAQ — JK2 Capture the Flag",
  description: "Player accounts, the JK2 Launcher, and where to go when something's stuck.",
}

// Logistics, not gameplay: /ctf-101 already owns "how do I play" (roles, tiers,
// how a round goes). This page is the launcher/account questions that sit
// beside it - the JK2 Launcher's own FAQ link points here.

interface Entry {
  q: string
  a: React.ReactNode
}

const ACCOUNT: Entry[] = [
  {
    q: "How do I get a player account?",
    a: "There's no sign-up form - an admin sets your name and an initial password. Ask in the community Discord and someone will get you set up.",
  },
  {
    q: "I forgot my password.",
    a: "Same answer - ask an admin to reset it. There's no email tied to the account, so there's no self-serve reset flow.",
  },
  {
    q: "What's a player profile actually for?",
    a: "It's your public page at jk2ctf.com/player/[your-name] - stats, badges, titles you've earned, and cosmetics (model, saber colour, theme) you can equip once you've unlocked them. Sign in and it's editable; anyone can view it without an account.",
  },
]

const LAUNCHER: Entry[] = [
  {
    q: "What is the JK2 Launcher?",
    a: "A small desktop app that installs and updates JK2 client mods for you - no more manually copying files into your Jedi Outcast folder. It finds your Steam install automatically.",
  },
  {
    q: "Which clients can I install?",
    a: "JK2MV (the modernised engine most other clients build on), TomArrow's Tommyternal fork (defrag/FFA-focused), and OpenJO (a stability-focused rebuild of the single-player campaign). All three run natively on macOS and Windows.",
  },
  {
    q: "What about NWH?",
    a: "NWH (Capture the Flag - NWH) is the anti-cheat client organised CTF matches actually run on, but its current build is Linux-only - the launcher can't install or run it on macOS or Windows yet. It'll show up as \"Not yet supported for macOS\" until that changes.",
  },
  {
    q: "A client won't launch, or crashes immediately.",
    a: "Try Update first - a fresh install often clears it. If that doesn't help, ask in Discord with what you tried; it's usually a quick fix.",
  },
  {
    q: "Where's my Steam library? It says it can't find Jedi Outcast.",
    a: "Use Change... next to Game Folder in the sidebar to point the launcher at your install directly, if it's somewhere non-standard.",
  },
]

function Section({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="mb-12">
      <h2
        className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#66fcf1] mb-5"
        style={{ fontFamily: "var(--font-orbitron)" }}
      >
        {title}
      </h2>
      <div className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.q} className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-5">
            <p className="text-[#c5c6c7] font-semibold mb-1.5">{entry.q}</p>
            <p className="text-sm text-[#8892a0] leading-relaxed">{entry.a}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function FaqPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl relative z-10">
      <div className="text-center mb-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#66fcf1]">Support</span>
        <h1
          className="text-3xl font-bold text-white mt-2 mb-3"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-[#8892a0]">
          For how the game itself works - roles, tiers, scoring - see{" "}
          <a href="/ctf-101" className="text-[#66fcf1] hover:underline">
            CTF 101
          </a>{" "}
          instead.
        </p>
      </div>

      <Section title="Player accounts" entries={ACCOUNT} />
      <Section title="JK2 Launcher" entries={LAUNCHER} />

      <section className="text-center border-t border-[#3d4855] pt-8">
        <p className="text-sm text-[#8892a0]">
          Still stuck? Ask in the community Discord - that's where admins and other players actually
          are.
        </p>
      </section>
    </div>
  )
}
