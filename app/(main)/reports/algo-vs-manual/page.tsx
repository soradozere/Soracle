import type { Metadata } from "next"
import type React from "react"
import Link from "next/link"

// Unlisted analysis writeup — not linked from the nav, shareable by URL (meant
// for a Discord drop). noindex like the /lab pages so it stays out of search.
// Pure static server component, no client JS: the bar chart is CSS widths.
//
// Numbers are from a one-off pull of the matches table on 4 Sep 2026, scoped to
// the 318 games that ran to the 7-cap limit (3 early-ended games excluded).
export const metadata: Metadata = {
  title: "Algorithm vs Manual Balancing — JK2 Capture the Flag",
  description:
    "Do auto-balanced teams end in more even scorelines than hand-picked ones? 318 completed games, March–September 2026.",
  robots: { index: false, follow: false },
}

// Algorithm tracks the active theme's accent; Manual is a fixed semantic colour
// (the site's "other series" amber) so the legend stays stable on every theme.
const ALGO = "var(--color-primary)"
const MANUAL = "#f39c12"

// Share of each method's games ending at this scoreline. Bars are scaled to a
// 25% axis (widthPct = value / 25).
const SCORELINES: { line: string; algo: number; manual: number; zone?: boolean }[] = [
  { line: "7–6", algo: 15.1, manual: 17.6 },
  { line: "7–5", algo: 22.0, manual: 16.4 },
  { line: "7–4", algo: 17.6, manual: 20.8 },
  { line: "7–3", algo: 11.9, manual: 18.9 },
  { line: "7–2", algo: 15.7, manual: 16.4, zone: true },
  { line: "7–1", algo: 8.8, manual: 2.5, zone: true },
  { line: "7–0", algo: 8.8, manual: 7.5, zone: true },
]

const VERSIONS: {
  v: string
  note: string
  n: number
  margin: string
  blow: string
  baseline?: boolean
  thin?: boolean
}[] = [
  { v: "Pre-June baseline", note: "original v0 balancer", n: 90, margin: "3.47", blow: "34%", baseline: true },
  { v: "June", note: "weak-team → Blue, elite-capper spread", n: 12, margin: "3.00", blow: "17%" },
  { v: "June", note: "capper/chaser stacking penalty, ELO mode", n: 13, margin: "4.46", blow: "54%" },
  { v: "July", note: "bottom-cluster rule, term pruning", n: 13, margin: "3.77", blow: "31%" },
  { v: "August", note: "tie / anchor family fixes (#164–#173)", n: 9, margin: "3.56", blow: "33%", thin: true },
  { v: "August", note: "elite-monopoly fix (#187)", n: 4, margin: "2.00", blow: "0%", thin: true },
  { v: "Late August", note: "per-player tiers (#198)", n: 12, margin: "3.17", blow: "25%" },
  { v: "September", note: "tier-gap weight + floor (#210), mid-core (#211)", n: 4, margin: "—", blow: "—", thin: true },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#66fcf1] mb-2"
      style={{ fontFamily: "var(--font-orbitron)" }}
    >
      {children}
    </p>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-text-bright font-mono tabular-nums leading-tight">{value}</div>
      <div className="text-[13px] text-text-dim mt-0.5">{label}</div>
    </div>
  )
}

function MethodColumn({
  name,
  games,
  scoreline,
  margin,
  close,
  outOfReach,
  divider,
}: {
  name: string
  games: string
  scoreline: string
  margin: string
  close: string
  outOfReach: string
  divider?: boolean
}) {
  return (
    <div className={`p-5 sm:p-6 ${divider ? "border-b sm:border-b-0 sm:border-r border-[#3d4855]" : ""}`}>
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <span
          className="text-[13px] font-bold uppercase tracking-[0.12em] text-text-bright"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          {name}
        </span>
        <span className="text-[12px] text-text-dim font-mono tabular-nums">{games}</span>
      </div>
      <div className="space-y-3.5">
        <Stat value={scoreline} label="average scoreline (winner – loser)" />
        <Stat value={margin} label="average cap margin · median 3" />
        <Stat value={close} label="close games (7–5 or 7–6)" />
        <Stat value={outOfReach} label="loser stuck on ≤ 2 caps" />
      </div>
    </div>
  )
}

export default function AlgoVsManualReport() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      {/* ---------------------------------------------------------- header */}
      <header className="mb-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#66fcf1] mb-3">
          Soracle &middot; Balance Analysis
        </p>
        <h1 className="text-3xl md:text-5xl font-extrabold uppercase glow-text text-balance font-[family-name:var(--font-orbitron)] leading-tight">
          Algorithm vs Manual Balancing
        </h1>
        <p className="mt-3 text-lg text-[#c5c6c7] max-w-[42ch] font-mono">
          Do auto-balanced teams produce closer games than hand-picked ones?
        </p>
        <p className="mt-5 pt-4 border-t border-[#3d4855] text-[13px] text-text-dim font-mono tabular-nums">
          318 completed CTF matches &middot; every game ran to the 7-cap limit &middot; March&nbsp;&ndash;&nbsp;September 2026
          &middot; 159 algorithm, 159 manual
        </p>
      </header>

      {/* ---------------------------------------------------------- verdict */}
      <section className="mb-14">
        <SectionLabel>The verdict</SectionLabel>
        <h2 className="text-2xl font-bold text-text-bright mb-3">They perform the same.</h2>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-6">
          Across 318 completed games the two methods land on the same average scoreline and the same spread of
          results. Every gap between them sits inside statistical noise.
        </p>

        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5 border-b border-[#3d4855] bg-[#27ae60]/10">
            <span
              className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#5fd39a]"
              style={{ fontFamily: "var(--font-orbitron)" }}
            >
              No meaningful difference
            </span>
            <span className="text-[12px] text-text-dim font-mono tabular-nums">
              avg margin 3.53 vs 3.38 caps &middot; t &asymp; 0.8
            </span>
          </div>
          <div className="grid sm:grid-cols-2">
            <MethodColumn
              name="Algorithm"
              games="159 games"
              scoreline="7–3.47"
              margin="3.53"
              close="37%"
              outOfReach="33%"
              divider
            />
            <MethodColumn
              name="Manual"
              games="159 games"
              scoreline="7–3.62"
              margin="3.38"
              close="34%"
              outOfReach="26%"
            />
          </div>
          <div className="px-5 py-3.5 border-t border-[#3d4855] bg-[#0b0c10]/40 text-sm text-[#c5c6c7]">
            Manual picks look a shade tighter on every measure, but with ~160 games each that edge is{" "}
            <strong className="text-text-bright font-semibold">well within the margin of error</strong> &mdash; the
            blowout-rate gap alone would need to be roughly twice as large before it meant anything.
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- chart */}
      <section className="mb-14">
        <SectionLabel>Scoreline shape</SectionLabel>
        <h2 className="text-2xl font-bold text-text-bright mb-3">Both methods produce the same distribution</h2>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-6">
          Share of games ending at each scoreline. The two bars track each other almost row for row &mdash; the
          clearest sign that swapping methods changes little.
        </p>

        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-5 sm:p-6">
          <div
            className="flex gap-6 text-[13px] text-text-dim mb-5"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm" style={{ background: ALGO }} />
              Algorithm
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm" style={{ background: MANUAL }} />
              Manual
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            {SCORELINES.map((row) => (
              <div
                key={row.line}
                className={`grid grid-cols-[42px_1fr_74px] items-center gap-2 sm:gap-3 px-1.5 py-1.5 rounded-md ${
                  row.zone ? "bg-[#ff4757]/10" : ""
                }`}
              >
                <span className="text-right text-[15px] font-semibold text-text-bright font-mono tabular-nums">
                  {row.line}
                </span>
                <div
                  className="flex flex-col gap-1"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, #3d4855 0 1px, transparent 1px 20%)",
                  }}
                >
                  <span
                    className="h-3 rounded-r-sm"
                    style={{ width: `${(row.algo / 25) * 100}%`, background: ALGO, minWidth: 2 }}
                  />
                  <span
                    className="h-3 rounded-r-sm"
                    style={{ width: `${(row.manual / 25) * 100}%`, background: MANUAL, minWidth: 2 }}
                  />
                </div>
                <span className="text-right text-[13px] font-medium font-mono tabular-nums leading-snug">
                  <span style={{ color: ALGO }}>{row.algo.toFixed(1)}</span>
                  <span className="text-text-dim"> / </span>
                  <span style={{ color: MANUAL }}>{row.manual.toFixed(1)}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[42px_1fr_74px] gap-2 sm:gap-3 mt-2 px-1.5">
            <span />
            <span className="flex justify-between text-[11px] text-text-dim font-mono tabular-nums">
              <span>0</span>
              <span>5%</span>
              <span>10%</span>
              <span>15%</span>
              <span>20%</span>
              <span>25%</span>
            </span>
            <span />
          </div>

          <p
            className="mt-4 text-[13px] text-text-dim leading-relaxed"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-[2px] border border-[#ff4757] bg-[#ff4757]/20 mr-1.5 align-baseline"
            />
            Values read <span style={{ color: ALGO }}>algorithm</span> /{" "}
            <span style={{ color: MANUAL }}>manual</span>, as a % of that method&apos;s games. The shaded band is the
            &ldquo;no realistic comeback&rdquo; zone. 3 games that ended before the cap (4&ndash;0, 5&ndash;1,
            6&ndash;3) are excluded throughout.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- blowouts */}
      <section className="mb-14">
        <SectionLabel>The blowout problem</SectionLabel>
        <h2 className="text-2xl font-bold text-text-bright mb-3">&ldquo;Blowout&rdquo; is measured too generously</h2>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-6">
          The standard cut for a blowout is a 5-cap margin &mdash; 7&ndash;2 or worse. But a 7&ndash;3 is already
          decided; nobody claws back a 6&ndash;2 deficit. Counting only the 5-cap games undersells how many matches
          are effectively over early.
        </p>
        <div className="border-l-[3px] border-[#ff4757] bg-[#ff4757]/10 rounded-r-lg px-5 py-4">
          <p
            className="text-[17px] font-semibold text-text-bright leading-snug"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            45% of games &mdash; algorithm <span className="text-[#66fcf1]">and</span>{" "}
            manual &mdash; end with the losing team on 3 caps or fewer.
          </p>
          <p className="mt-2.5 text-sm text-[#c5c6c7] leading-relaxed max-w-[60ch]">
            26 games (8%) finished 7&ndash;0. Widen that to 7&ndash;0 through 7&ndash;2 and it is 95 games &mdash;{" "}
            <strong className="text-text-bright font-semibold">roughly one in three</strong>. On this measure the two
            methods are exactly level (45% vs 45%).
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- versions */}
      <section className="mb-14">
        <SectionLabel>Algorithm versions</SectionLabel>
        <h2 className="text-2xl font-bold text-text-bright mb-3">Which balancer iteration gave the evenest games?</h2>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-6">
          Can&apos;t be answered from this data. Of the 159 algorithm games, 90 were balanced by the original
          pre-June logic. Every version since has 13 games or fewer &mdash; far too few to separate from chance.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[470px] text-sm font-mono tabular-nums border-collapse">
            <caption
              className="text-left text-[13px] text-text-dim mb-3"
              style={{ fontFamily: "var(--font-orbitron)" }}
            >
              Algorithm matches by the balancer version live at the time
            </caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-text-dim">
                <th className="text-left font-semibold border-b border-[#3d4855] py-2 pr-3">Version</th>
                <th className="text-right font-semibold border-b border-[#3d4855] py-2 px-3">Games</th>
                <th className="text-right font-semibold border-b border-[#3d4855] py-2 px-3">Avg margin</th>
                <th className="text-right font-semibold border-b border-[#3d4855] py-2 pl-3">Blowouts &ge;5</th>
              </tr>
            </thead>
            <tbody>
              {VERSIONS.map((r, i) => (
                <tr
                  key={i}
                  className={r.baseline ? "bg-[#66fcf1]/10" : ""}
                >
                  <td
                    className={`border-b border-[#3d4855]/60 py-2.5 pr-3 ${
                      r.baseline ? "text-text-bright" : r.thin ? "text-text-dim" : "text-[#c5c6c7]"
                    }`}
                  >
                    {r.v}
                    <span className="block mt-0.5 text-[13px] text-text-dim" style={{ fontFamily: "var(--font-sans)" }}>
                      {r.note}
                    </span>
                  </td>
                  <td
                    className={`text-right border-b border-[#3d4855]/60 py-2.5 px-3 ${
                      r.thin ? "text-text-dim" : "text-[#c5c6c7]"
                    }`}
                  >
                    {r.n}
                  </td>
                  <td
                    className={`text-right border-b border-[#3d4855]/60 py-2.5 px-3 ${
                      r.thin ? "text-text-dim" : "text-[#c5c6c7]"
                    }`}
                  >
                    {r.margin}
                  </td>
                  <td
                    className={`text-right border-b border-[#3d4855]/60 py-2.5 pl-3 ${
                      r.thin ? "text-text-dim" : "text-[#c5c6c7]"
                    }`}
                  >
                    {r.blow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mt-6 mb-3">
          Two things also moved underneath the balancer over these months, so any scoreline shift is not cleanly the
          algorithm&apos;s doing:
        </p>
        <ul className="space-y-2.5 max-w-[62ch] mb-4">
          <li className="flex items-start gap-3">
            <span className="text-[#45a29e] mt-1">&bull;</span>
            <span className="text-[#c5c6c7] leading-relaxed">
              <strong className="text-text-bright font-semibold">Tier data changed.</strong> The auto-calibrator was
              rebuilt on 28 August and ~18 hand tier edits landed over the summer. Better inputs improve scorelines
              regardless of the balancing logic.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[#45a29e] mt-1">&bull;</span>
            <span className="text-[#c5c6c7] leading-relaxed">
              <strong className="text-text-bright font-semibold">The player pool drifted.</strong> Who turns up on a
              given night is not held constant across a six-month window.
            </span>
          </li>
        </ul>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch]">
          The recent heavily-worked versions (#210 / #211) have four games between them. They can&apos;t be judged
          yet.
        </p>
      </section>

      {/* ---------------------------------------------------------- next */}
      <section className="mb-14">
        <SectionLabel>What would settle it</SectionLabel>
        <h2 className="text-2xl font-bold text-text-bright mb-3">The scoreline is a blunt instrument</h2>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-4">
          A final score of 7&ndash;5 could mean an end-to-end match or a 6&ndash;1 rout with garbage-time caps.
          Soracle only stores the final line &mdash; no cap timeline, no lead changes &mdash; so there is no way to
          tell from it whether a team was ever really in the game.
        </p>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch] mb-3">
          That is also <span className="text-[#66fcf1]">why</span> the version comparison comes back blank: even if
          the differences exist, the measure is too coarse to see them. A real answer needs two things:
        </p>
        <ul className="space-y-2.5 max-w-[62ch] mb-4">
          <li className="flex items-start gap-3">
            <span className="text-[#45a29e] mt-1">&bull;</span>
            <span className="text-[#c5c6c7] leading-relaxed">
              <strong className="text-text-bright font-semibold">A version tag on every logged match</strong> going
              forward, then a fresh look at ~40&ndash;50 games per version.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[#45a29e] mt-1">&bull;</span>
            <span className="text-[#c5c6c7] leading-relaxed">
              <strong className="text-text-bright font-semibold">Cap timing from the demo files</strong> &mdash; first
              lead, biggest deficit, when the result was sealed &mdash; which is a parsing job, not a query.
            </span>
          </li>
        </ul>
        <p className="text-[#c5c6c7] leading-relaxed max-w-[64ch]">
          Worth doing only if balancer work continues and needs a scoreboard to grade against. See{" "}
          <Link href="/how-it-works" className="text-primary hover:underline">
            how the balancer grades a split
          </Link>{" "}
          for what it&apos;s optimising toward.
        </p>
      </section>

      <p className="border-t border-[#3d4855] pt-5 text-[12px] text-text-dim font-mono tabular-nums leading-relaxed">
        Source: matches table, pulled 4 September 2026 &mdash; 318 completed matches (3 games that ended before the
        7-cap limit are excluded). Margins are absolute cap differences; &ldquo;close&rdquo; = 7&ndash;5 or 7&ndash;6;
        significance from a two-sample t-test on match margin and a two-proportion z-test on blowout rate.
      </p>
    </div>
  )
}
