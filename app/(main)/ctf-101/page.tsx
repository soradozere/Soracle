import type { Metadata } from "next"
import Link from "next/link"
import { Emblem } from "@/components/emblem"
import { CtfVideoCard } from "@/components/ctf-video-card"
import { DecodingTitle } from "@/components/decoding-title"
// Read the real numbers rather than restating them: this page went stale once
// already, still promising a 10-game floor after it moved to 5.
import { CALIBRATION } from "@/lib/calibration"

export const metadata: Metadata = {
  title: "CTF 101 — JK2 Capture the Flag",
  description:
    "What the five roles actually do, how a capture plays out, and how your tier moves. The new player guide to competitive JK2 CTF.",
}

// The player-facing counterpart to /how-it-works: that page explains the
// balancer, this one explains the game. The tier/auto-calibration material used
// to live there and moved here, because "how do I rank up" is a question about
// playing, not about how the queue builds teams.
//
// Static apart from the video cards, which are client components only so the
// YouTube embed can stay unmounted until pressed.

// Role colours are the semantic set from components/player-card.tsx — they carry
// meaning rather than palette, so they're deliberately excluded from theming.
const ROLES = [
  {
    key: "CAP",
    name: "Capper",
    color: "#62d6e8",
    crest: "rebel-alliance",
    job: "Takes the enemy flag and gets it home. Speed, routes and nerve.",
    habit:
      "Don't fight too much. Every duel is health you won't have on the way out, and a hurt, stressed capper can quickly become a return, giving the other team a chance to cap.",
  },
  {
    key: "SUP",
    name: "Support",
    color: "#f39c12",
    crest: "galactic-republic",
    job: "Attacks the enemy base and helps clear the path for the capper, while helping the team as a whole.",
    habit:
      "Priority order, every time: hold their pad, then grab their mines, then work the halls so their returners chase you instead of your capper.",
  },
  {
    key: "CHA",
    name: "Chase",
    color: "#27ae60",
    crest: "mandalorian-mercs",
    job: "Hunts the enemy flag carrier. A position reserved for the player with top-tier agility and movement.",
    habit: "Kill the capper, and stop them capturing the flag at all costs.",
  },
  {
    key: "CAM",
    name: "Camp",
    color: "#45a29e",
    crest: "galactic-empire",
    job: "Owns your base's halls and entrances. Fights anyone coming through.",
    habit: "Body-block, don't sprint after. You're the reason Chase doesn't start from zero.",
  },
  {
    key: "BC",
    name: "Base Cleaner",
    color: "#9b59b6",
    crest: "mandalorian-guard",
    job: "Last line. Keeps the flag pad clear, mined, and safe to score on.",
    habit:
      "Use the saber styles to your advantage to kill the enemy team, and try to keep your capper and base safe as best as possible.",
  },
]

const BEATS = [
  {
    n: "Beat 01",
    title: "Grab",
    body: "The capper crosses into the enemy base and lifts the flag. The clock starts now.",
  },
  {
    n: "Beat 02",
    title: "Clear",
    body:
      "Support has already grabbed the mines and is fighting the enemy camp returner, so there's a live exit rather than a trap.",
  },
  {
    n: "Beat 03",
    title: "Chase",
    body: "Their chaser and camp will try to stop your capper. It's up to the rest of your team to make sure you make it back safe, and the enemy cappers are dead.",
  },
  {
    n: "Beat 04",
    title: "Score",
    body: "A capture only counts if your own flag is home — so BC has kept the pad clean enough for it to land and stick.",
  },
]

// Titles from lib/profile-meta.ts's TIER_NAMES, listed top-down.
const LADDER = [
  [10, "The Chosen One"],
  [9, "Jedi Grandmaster"],
  [8, "Jedi Master"],
  [7, "Jedi Sentinel"],
  [6, "Jedi Guardian"],
  [5, "Jedi Knight"],
  [4, "Jedi"],
  [3, "Padawan"],
  [2, "Initiate"],
  [1, "Youngling"],
] as const

// Score-ladder thresholds from lib/titles.ts. The GOAT (1337) is deliberately
// omitted — it's flagged hidden there, so publishing it here would leak it.
const TITLES = [
  ["Decorated", 75],
  ["Distinguished", 150],
  ["Illustrious", 300],
  ["JK2 God", 550],
] as const

const VIDEOS = [
  { videoId: "ewksevBHaGw", title: "Jk2 1.02 Strafe Jumping Tutorial Part 1 — The Basics", tag: "Movement" },
  { videoId: "0ixQNZTWZEo", title: "47 ctf_yavin rolls to DOMINATE your opponents!", tag: "Movement · ctf_yavin" },
  { videoId: "MGszZj04MrE", title: "Ferox' CTF Support tutorial", tag: "Support", tagColor: "#f39c12" },
  { videoId: "BbIb_-m4-2w", title: "Ferox' CTF BC tutorial", tag: "Base Cleaner", tagColor: "#9b59b6" },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0] mb-3"
      style={{ fontFamily: "var(--font-orbitron)" }}
    >
      {children}
    </h2>
  )
}

export default function Ctf101Page() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl relative z-10">
      {/* ------------------------------------------------------------ hero */}
      <section className="text-center py-10 mb-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="h-px w-6 bg-[#45a29e]" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#66fcf1]">New Player Guide</span>
          <span className="h-px w-6 bg-[#45a29e]" />
        </div>
        <DecodingTitle
          lines={["Twelve players. Two flags.", "Everyone has a job."]}
          className="text-4xl md:text-6xl font-extrabold glow-text mb-4 text-balance font-[family-name:var(--font-orbitron)]"
        />
        <p className="max-w-2xl mx-auto text-[#8892a0] text-sm md:text-base leading-relaxed">
          JK2 CTF is a 6v6 gamemode, with a community-made set of rules and structures. We don&apos;t use force
          powers, just lightsabers, strafehopping, and the resources laying around CTF_Yavin. Most people lose their
          first few games not because they aim badly, but because nobody told them what their role does. Here&apos;s
          how to play.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          <a
            href="#roles"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-background)" }}
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm hover-glow inline-flex items-center gap-2"
          >
            Find Your Role
          </a>
          <a
            href="#watch"
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm inline-flex items-center gap-2 border border-border text-text hover:text-text-bright hover:border-[#45a29e]"
          >
            Watch And Learn
          </a>
          <a
            href="#climb"
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm inline-flex items-center gap-2 border border-border text-text hover:text-text-bright hover:border-[#45a29e]"
          >
            How Ranking Works
          </a>
        </div>
      </section>

      {/* ---------------------------------------------------------- basics */}
      <section className="mb-10">
        <SectionLabel>The Basics</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { v: "6v6", l: "Format", d: "Twelve players, two flags. Every role below needs someone covering it." },
            { v: "7", l: "Captures To Win", d: "Kills are a means to that, never the point.", accent: true },
            {
              v: "5",
              l: "Roles",
              d: "Capper, Support, Chase, Camp and Base Cleaner. Find yours below.",
            },
            { v: "3", l: "Saber Styles", d: "Fast, medium and strong are live. Which suits you is yours to find out." },
          ].map((t) => (
            <div key={t.l} className="glass-panel p-4">
              <div
                className="text-2xl font-extrabold font-mono"
                style={{
                  fontFamily: "var(--font-orbitron)",
                  color: t.accent ? "var(--color-primary)" : "var(--color-text-bright)",
                }}
              >
                {t.v}
              </div>
              <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">{t.l}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#c5c6c7]">{t.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-3.5 flex items-start gap-2 text-[13px] text-[#8892a0]">
          <span className="text-primary font-mono font-bold">•</span>
          <span>
            Trip mines, sentry, forcefields and bactas are your only other resource — there is nothing else to fall
            back on.
          </span>
        </p>
      </section>

      {/* ----------------------------------------------------------- roles */}
      <section id="roles" className="mb-10 scroll-mt-8">
        <SectionLabel>The Five Roles</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          Every team runs <strong className="text-text-bright">two cappers</strong>; the other four cover the
          remaining jobs between them — which is exactly what the balancer checks when it builds a match. Each card
          carries the job, and the one habit that separates a good one from a bad one.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ROLES.map((r) => (
            <article key={r.key} className="glass-panel p-4 flex flex-col gap-2.5">
              {/* Corner-bleed crest, the same watermark treatment the homepage
                  stat tiles and the Stats panels use. */}
              <Emblem
                src={`/achievements/${r.crest}.svg`}
                color={r.color}
                className="absolute -right-[18px] -top-[14px] w-[112px] h-[112px] opacity-[0.09] pointer-events-none"
              />
              <span
                className="relative inline-block px-2 py-1 text-background text-xs font-bold rounded w-fit"
                style={{ backgroundColor: r.color }}
              >
                {r.key}
              </span>
              <h3 className="relative text-base font-bold text-text-bright">{r.name}</h3>
              <p className="relative text-sm text-[#c5c6c7]">{r.job}</p>
              <p className="relative pt-2.5 border-t border-[#3d4855]/60 text-[13px] text-[#8892a0] leading-relaxed">
                <span
                  className="block text-[9px] font-bold uppercase tracking-[0.16em] mb-1"
                  style={{ fontFamily: "var(--font-orbitron)", color: r.color }}
                >
                  The Habit
                </span>
                {r.habit}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- run */}
      <section className="mb-10">
        <SectionLabel>What A Capture Looks Like</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          Four beats, every time, whichever side is running it. If you&apos;re ever unsure where to be, find the beat
          you&apos;re in.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {BEATS.map((b) => (
            <div key={b.n} className="glass-panel p-4">
              <div
                className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-primary mb-1.5"
                style={{ fontFamily: "var(--font-orbitron)" }}
              >
                {b.n}
              </div>
              <h4 className="text-[15px] font-bold text-text-bright mb-1">{b.title}</h4>
              <p className="text-[13px] text-[#8892a0] leading-relaxed">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- setup */}
      <section className="mb-10">
        <SectionLabel>Set Your Game Up First</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          Four console commands. Two of them are the difference between guessing and knowing.
        </p>
        <div className="glass-panel p-6">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    className="text-left text-[10px] uppercase tracking-[0.16em] font-bold text-[#8892a0] pb-2.5 pr-4 border-b border-[#3d4855] w-60"
                    style={{ fontFamily: "var(--font-orbitron)" }}
                  >
                    Command
                  </th>
                  <th
                    className="text-left text-[10px] uppercase tracking-[0.16em] font-bold text-[#8892a0] pb-2.5 border-b border-[#3d4855]"
                    style={{ fontFamily: "var(--font-orbitron)" }}
                  >
                    Why
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "cg_drawtimer 1",
                    "Puts the game clock on screen. This is what makes the 40-second mine timer usable rather than theoretical.",
                  ],
                  [
                    "cg_drawteamoverlay 1",
                    "Shows your teammates' health and status, so you'll know your capper is in trouble before they say so.",
                  ],
                  [
                    "bind <key> kill",
                    "Respawn back at your base. Useful for getting back to defend your base, and dropping the flag to a capper.",
                  ],
                  [
                    "bind <key> +use",
                    "Use shield generators to top up your shields before getting into the fight. Crucial for cappers.",
                  ],
                ].map(([cmd, why]) => (
                  <tr key={cmd}>
                    <td className="py-3 pr-4 align-top border-b border-[#3d4855]/60 last:border-0">
                      <code className="font-mono font-bold text-primary bg-background border border-[#3d4855] rounded px-1.5 py-0.5 text-[13px] whitespace-nowrap">
                        {cmd}
                      </code>
                    </td>
                    <td className="py-3 align-top border-b border-[#3d4855]/60 text-[#c5c6c7] leading-relaxed">
                      {why}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- videos */}
      <section id="watch" className="mb-10 scroll-mt-8">
        <SectionLabel>Watch And Learn</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          Community tutorials worth an evening. Movement is the ceiling on every role, so start there if you&apos;re
          not sure.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {VIDEOS.map((v) => (
            <CtfVideoCard key={v.videoId} {...v} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ tips */}
      <section className="mb-10">
        <SectionLabel>Three Things Nobody Tells You</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          The gap between a new player and a good one is mostly these, and none of them are aim.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          <article className="glass-panel p-5 flex flex-col gap-2.5">
            <h3 className="text-[15px] font-bold text-text-bright leading-snug">Mines run on a 40-second clock</h3>
            <p className="text-[13px] text-[#8892a0] leading-relaxed">
              Trip mines help a base hold its pad, and they come back every 40 seconds. Note when you grab a set and
              you know exactly when the next one lands.
            </p>
            <div className="flex gap-1.5 font-mono tabular-nums" style={{ fontFamily: "var(--font-oxanium)" }}>
              <div className="flex-1 rounded border border-[#45a29e] bg-background px-2.5 py-1.5">
                <div className="text-[13px] font-bold text-primary">43:50</div>
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-[#8892a0] mt-0.5">You Grab</div>
              </div>
              <div className="grid place-items-center text-[#8892a0] text-xs">→</div>
              <div className="flex-1 rounded border border-[#45a29e] bg-background px-2.5 py-1.5">
                <div className="text-[13px] font-bold text-primary">44:30</div>
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-[#8892a0] mt-0.5">Next Set</div>
              </div>
            </div>
            <p className="text-[13px] text-[#8892a0] leading-relaxed">
              Blow them from above so you don&apos;t wear the blast — and grabbing enemy mines starves their BC just as
              well as destroying them.
            </p>
          </article>

          <article className="glass-panel p-5 flex flex-col gap-2.5">
            <h3 className="text-[15px] font-bold text-text-bright leading-snug">The drop is a pass, not a rage quit</h3>
            <p className="text-[13px] text-[#8892a0] leading-relaxed">
              Carrying the flag on low health with a teammate posted on the pad? Kill yourself. They get the flag at
              full health and the run continues from a better position than you&apos;d have managed.
            </p>
            <p className="text-[13px] text-[#8892a0] leading-relaxed">
              <strong className="text-text-bright">The mistake is hesitating.</strong> Three seconds of &ldquo;maybe
              I&apos;ll make it&rdquo; is usually a capture handed straight back.
            </p>
          </article>

          <article className="glass-panel p-5 flex flex-col gap-2.5">
            <h3 className="text-[15px] font-bold text-text-bright leading-snug">Talk to your team</h3>
            <p className="text-[13px] text-[#8892a0] leading-relaxed">
              Voice chat is crucial to a win — a silent team loses to a talking one nearly every night. Their camp
              returner just died? That&apos;s the window to help your capper escape. Watch the team overlay and get to
              their pad before your capper has to drop.
            </p>
          </article>
        </div>
      </section>

      {/* ----------------------------------------------------------- climb */}
      <section id="climb" className="mb-10 scroll-mt-8">
        <SectionLabel>How You Climb</SectionLabel>
        <p className="text-sm text-[#8892a0] max-w-3xl mb-4 leading-relaxed">
          Every player carries a tier from 1 to 10, plus a rating in each of the five roles. An admin sets your first
          one. After that it moves on its own, from results — nothing else.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-3 items-start">
          <div className="glass-panel p-6">
            <ul className="space-y-3">
              {[
                [
                  "Play better than your tier, not just win more",
                  "It reads what you actually did on the scoreboard — returns, base cleans, flag time, mine work — measured against the other eleven players in that game, so a strong game against tier 9s counts for more than the same game against tier 4s. Captures are deliberately left out: they are the score, and the point is to judge you separately from who won.",
                ],
                [`Only your last ${CALIBRATION.WINDOW_CAP} games count`, "It measures current form, not your entire history."],
                [
                  `You need ${CALIBRATION.MIN_GAMES} games at a tier before anything is judged`,
                  "Get moved — by the system or by an admin — and your record starts fresh. Returning to a tier you held before starts a new record too; the games that moved you off it are spent.",
                ],
                [
                  "It nudges, it does not jump",
                  "Every few games it shifts you a fraction of a tier toward wherever your play suggests you belong. One good night barely registers and the next one cancels it. Only a run that keeps pointing the same way adds up enough to actually move you.",
                ],
                [
                  "One tier at a time, always in public",
                  "Moves are ±1 per evaluation and appear in the tier changelog on the Stats page marked AUTO. Nothing happens silently, and an admin can override any tier by hand at any time.",
                ],
              ].map(([title, body]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="text-primary font-mono font-bold">•</span>
                  <div>
                    <strong className="text-text-bright">{title}</strong>
                    <p className="text-sm text-text-dim mt-1 leading-relaxed">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-md border border-primary/30 bg-primary/[0.06] px-4 py-3.5 text-sm text-[#c5c6c7]">
              <strong className="text-primary" style={{ fontFamily: "var(--font-oxanium)" }}>
                The whole system, in one line:
              </strong>{" "}
              play games, and win more than your tier says you should.
            </div>
          </div>

          <div className="grid gap-3">
            <div className="glass-panel p-5">
              <h4
                className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#8892a0] mb-3.5"
                style={{ fontFamily: "var(--font-orbitron)" }}
              >
                The Ladder
              </h4>
              {LADDER.map(([n, name]) => (
                <div
                  key={n}
                  className="flex items-center gap-2.5 py-1.5 border-b border-[#3d4855]/45 last:border-0"
                >
                  <span
                    className="grid place-items-center shrink-0 w-6 h-[22px] rounded text-[11px] font-extrabold tabular-nums border border-primary/30 text-primary bg-primary/[0.08]"
                    style={{ fontFamily: "var(--font-orbitron)" }}
                  >
                    {n}
                  </span>
                  <span className="text-[13px] font-semibold text-[#c5c6c7]" style={{ fontFamily: "var(--font-oxanium)" }}>
                    {name}
                  </span>
                </div>
              ))}
            </div>

            <div className="glass-panel p-5">
              <h4
                className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#8892a0] mb-3.5"
                style={{ fontFamily: "var(--font-orbitron)" }}
              >
                Titles You Can Equip
              </h4>
              {TITLES.map(([name, score]) => (
                <div
                  key={name}
                  className="flex items-baseline justify-between gap-2 py-1.5 text-[13px] border-b border-[#3d4855]/45 last:border-0"
                >
                  <span className="font-bold text-text-bright" style={{ fontFamily: "var(--font-oxanium)" }}>
                    {name}
                  </span>
                  <span
                    className="font-extrabold text-primary tabular-nums"
                    style={{ fontFamily: "var(--font-orbitron)" }}
                  >
                    {score}
                  </span>
                </div>
              ))}
              <p className="mt-3.5 text-[13px] text-[#8892a0] leading-relaxed">
                Earned on Achievement Score, which only ever goes up. Each one also unlocks a profile theme. Seasonal
                titles run on their own monthly ladder.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- closing */}
      <section className="text-center border-t border-[#3d4855] pt-10 pb-4">
        <h3
          className="text-xl font-extrabold glow-text mb-2"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          That&apos;s the whole game.
        </h3>
        <p className="text-[15px] text-[#8892a0] max-w-lg mx-auto">
          Everything after this is repetition — and knowing which of the five jobs is yours tonight.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          {/* Deliberately only one CTA, and not /live: spectating needs a player
              login, which a first-time reader of this page won't have. The demo
              library is public. */}
          <Link
            href="/demos"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-background)" }}
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm hover-glow inline-flex items-center gap-2"
          >
            Watch Recent Highlights
          </Link>
        </div>
      </section>
    </div>
  )
}
