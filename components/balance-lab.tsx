"use client"

import { useEffect, useMemo, useState } from "react"
import { Beaker, ClipboardCopy, Shuffle, X, Zap } from "lucide-react"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import {
  ALL_ROLES,
  DEFAULT_ORDER_ID,
  DRAFT_ORDERS,
  type DraftOrderId,
  type DraftResult,
  type PickReason,
  formatDraftLog,
  runDraft,
} from "@/lib/balance-draft"
import { type LineupComparison, compareToBaseline } from "@/lib/balance-lab-compare"
import type { Player } from "@/lib/types"

const SQUAD_SIZE = 12

/*
 * Workbench for the experimental snake-draft balancer (lib/balance-draft.ts). Reads the
 * live roster so the tiers and role ranks are the real ones, but writes nothing and
 * shares no state with /balancer — picking a lobby here has no effect anywhere else.
 */

const REASON_LABELS: Record<PickReason, string> = {
  captain: "Captain",
  premium: "Cap / Ret",
  "best-available": "Best avail.",
  fallback: "Fallback",
}

const REASON_COLOURS: Record<PickReason, string> = {
  captain: "#66fcf1",
  premium: "#c084fc",
  "best-available": "#7ed957",
  fallback: "#e74c3c",
}

const fmtZ = (z: number) => (z >= 0 ? "+" : "") + z.toFixed(2)

const SHORT_ROLE: Record<string, string> = { Cleaner: "BC", Support: "Sup", Capper: "Cap" }
const shortRole = (role: string) => SHORT_ROLE[role] ?? role

/**
 * A player's two best roles, for the selection chip. The old chip showed Cap and Ret
 * only, which rendered every base player as "Cap 0 · Ret 0" — the same blindness that
 * made the draft undervalue them.
 */
function topRolesOf(p: Player): string {
  const rated = ALL_ROLES.filter((role) => p.roles[role] > 0).sort(
    (a, b) => p.roles[b] - p.roles[a],
  )
  if (rated.length === 0) return "unrated"
  return rated
    .slice(0, 2)
    .map((role) => `${shortRole(role)} ${p.roles[role]}`)
    .join(" · ")
}

/** A role rating with its z-score underneath, tinted when the player is viable. */
function RoleCell({ rating, z, viable }: { rating: number; z: number; viable: boolean }) {
  return (
    <div className="text-right tabular-nums">
      <div style={{ color: viable ? "#7ed957" : "#8b9199" }}>{rating}</div>
      <div className="text-[10px]" style={{ color: viable ? "#7ed95799" : "#6a7079" }}>
        {fmtZ(z)}
      </div>
    </div>
  )
}

export function BalanceLab() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [result, setResult] = useState<DraftResult | null>(null)
  // Both orders are drafted at once, so switching between them is instant and the
  // comparison strip can show what each costs on THIS lobby, not just in aggregate.
  const [runs, setRuns] = useState<Record<DraftOrderId, DraftResult> | null>(null)
  const [orderId, setOrderId] = useState<DraftOrderId>(DEFAULT_ORDER_ID)
  // The shipped balancer's answer for the same twelve, per pick order (the draft side of
  // the comparison changes with the order; the baseline doesn't, but caching per order
  // keeps the switch instant).
  const [compare, setCompare] = useState<Record<DraftOrderId, LineupComparison | null> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchPlayersFromDB()
      .then(setPlayers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return players
      .filter((p) => !query || p.name.toLowerCase().includes(query))
      .sort((a, b) => b.tierValue - a.tierValue || a.name.localeCompare(b.name))
  }, [players, search])

  const toggle = (name: string) => {
    setResult(null)
    setRuns(null)
    setCompare(null)
    setSelected((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : prev.length < SQUAD_SIZE
          ? [...prev, name]
          : prev,
    )
  }

  const randomTwelve = () => {
    setResult(null)
    setRuns(null)
    setCompare(null)
    const pool = players.filter((p) => p.is_active !== false && !p.manually_inactive)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    setSelected(pool.slice(0, SQUAD_SIZE).map((p) => p.name))
  }

  const run = () => {
    setError(null)
    try {
      const lobby = selected
        .map((name) => players.find((p) => p.name === name))
        .filter((p): p is Player => p !== undefined)
      const drafted = Object.fromEntries(
        (Object.keys(DRAFT_ORDERS) as DraftOrderId[]).map((id) => [id, runDraft(lobby, id)]),
      ) as Record<DraftOrderId, DraftResult>
      const compared = Object.fromEntries(
        (Object.keys(drafted) as DraftOrderId[]).map((id) => [id, compareToBaseline(drafted[id], players)]),
      ) as Record<DraftOrderId, LineupComparison | null>
      setRuns(drafted)
      setResult(drafted[orderId])
      setCompare(compared)
    } catch (e) {
      setRuns(null)
      setResult(null)
      setCompare(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const selectOrder = (id: DraftOrderId) => {
    setOrderId(id)
    if (runs) setResult(runs[id])
  }

  const gapOf = (r: DraftResult) => r.tierTotals.RED - r.tierTotals.BLUE

  const cmp = compare?.[orderId] ?? null
  const moverSet = useMemo(() => new Set(cmp?.movers ?? []), [cmp])

  const copyLog = () => {
    if (!result) return
    const teams =
      `\n\nRED  (tier ${result.tierTotals.RED}): ${result.teams.RED.map((p) => p.name).join(", ")}` +
      `\nBLUE (tier ${result.tierTotals.BLUE}): ${result.teams.BLUE.map((p) => p.name).join(", ")}`
    navigator.clipboard.writeText(formatDraftLog(result) + teams)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading) {
    return (
      <div className="text-center py-24">
        <div className="w-12 h-12 border-4 border-[#66fcf1] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#c5c6c7]">Loading roster…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-1">
          <Beaker className="w-5 h-5" style={{ color: "#66fcf1" }} />
          <h1 className="text-xl font-bold text-white">Balance Lab — Composition Draft</h1>
        </div>
        <p className="text-sm text-[#c5c6c7] max-w-3xl mb-3">
          An experimental balancer. The two highest-tier players captain — the weaker of the two
          picks first as a counterweight — then a draft builds each team around the standard
          six-role composition. Runs on the live roster but is completely separate from{" "}
          <span className="text-[#66fcf1]">/balancer</span> — nothing here changes the shipped
          algorithm or is used by the bot.
        </p>
        <p className="text-xs text-[#8b9199] max-w-3xl">
          The role each player is drafted into is a <span className="text-[#c5c6c7]">starting point</span>,
          not an assignment — swap freely in game, the teams stay balanced because they were built
          from balanced parts. Cap and Chase are secured first and always; after that the strongest
          player left goes, slotted where he fits best. The full reasoning is in{" "}
          <span className="text-[#c5c6c7]">Pick Reasoning</span> below.
        </p>
      </header>

      {/* ---- Lobby selection ---- */}
      <section className="glass-panel p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="font-mono text-lg font-bold text-white">
            {selected.length}/{SQUAD_SIZE}
          </span>
          <div className="flex-1 min-w-[120px] h-2 bg-[#0b0c10] rounded-full overflow-hidden border border-[#3d4855]">
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${(selected.length / SQUAD_SIZE) * 100}%`, backgroundColor: "#66fcf1" }}
            />
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="px-3 py-1.5 rounded-md bg-[#0b0c10] border border-[#3d4855] text-sm text-[#c5c6c7] placeholder:text-[#5a6069] focus:outline-none focus:border-[#66fcf1]"
          />
          <button
            onClick={randomTwelve}
            className="px-3 py-1.5 rounded-md text-sm bg-[#2a3441]/60 text-[#c5c6c7] border border-[#3d4855] hover:bg-[#3d4855] transition-all"
          >
            <Shuffle className="w-4 h-4 inline mr-1" />
            Random 12
          </button>
          <button
            onClick={() => {
              setSelected([])
              setResult(null)
              setRuns(null)
              setCompare(null)
            }}
            disabled={selected.length === 0}
            className="px-3 py-1.5 rounded-md text-sm bg-[#8b3a3a] text-white border border-[#3d4855] disabled:opacity-40 hover:bg-[#ff4757] transition-all"
          >
            <X className="w-4 h-4 inline mr-1" />
            Clear
          </button>
          <button
            onClick={run}
            disabled={selected.length !== SQUAD_SIZE}
            className="px-5 py-1.5 rounded-md text-sm font-bold bg-[#66fcf1] text-[#0b0c10] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Zap className="w-4 h-4 inline mr-1" />
            RUN DRAFT
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 max-h-[340px] overflow-y-auto pr-1">
          {visible.map((p) => {
            const isSelected = selected.includes(p.name)
            return (
              <button
                key={p.name}
                onClick={() => toggle(p.name)}
                className="px-2 py-1.5 rounded-md border text-left transition-all"
                style={{
                  borderColor: isSelected ? "#66fcf1" : "#3d4855",
                  backgroundColor: isSelected ? "rgba(102,252,241,0.12)" : "rgba(42,52,65,0.4)",
                }}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-sm truncate text-white">{p.name}</span>
                  <span className="text-xs font-mono shrink-0" style={{ color: "#f39c12" }}>
                    T{p.tierValue}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-[#8b9199] truncate">
                  {topRolesOf(p)}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {error && (
        <div className="glass-panel p-4 border-l-2 border-l-[#e74c3c] text-sm text-[#e74c3c]">{error}</div>
      )}

      {runs && result && (
        <>
          {/* ---- Pick order A/B ----
              Both orders are drafted from the same lobby, so the gap each produces is
              directly comparable. Aggregate figures come from 4,000 random twelves. */}
          <section className="glass-panel p-4">
            <h2 className="font-bold text-white mb-1">Pick Order</h2>
            <p className="text-xs text-[#8b9199] mb-3">
              Both orders deal six picks a side. They differ only in where those picks fall — which,
              together with the weaker captain picking first, decides how close the two teams end up.
              Over 4,000 random lobbies the first-pick side lands within 0.6 tier of the other under
              alternating, but 2.6 short under the snake — it over-corrects.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(DRAFT_ORDERS) as DraftOrderId[]).map((id) => {
                const spec = DRAFT_ORDERS[id]
                const gap = gapOf(runs[id])
                const active = id === orderId
                return (
                  <button
                    key={id}
                    onClick={() => selectOrder(id)}
                    className="text-left p-3 rounded-lg border transition-all"
                    style={{
                      borderColor: active ? "#66fcf1" : "#3d4855",
                      backgroundColor: active ? "rgba(102,252,241,0.10)" : "rgba(42,52,65,0.35)",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="font-bold text-sm" style={{ color: active ? "#66fcf1" : "#c5c6c7" }}>
                        {spec.label}
                      </span>
                      <span className="font-mono text-[11px] text-[#8b9199]">{spec.pattern}</span>
                    </div>
                    <p className="text-[11px] text-[#8b9199] mb-2">{spec.note}</p>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-[#5a6069]">this lobby</span>
                      <span
                        style={{ color: gap === 0 ? "#7ed957" : gap <= 2 ? "#f39c12" : "#e74c3c" }}
                      >
                        RED {runs[id].tierTotals.RED} · BLUE {runs[id].tierTotals.BLUE}
                        {gap === 0 ? " — level" : ` — ${gap} tier apart`}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---- Pick log ---- */}
          <section className="glass-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-white">Draft Log</h2>
              <button
                onClick={copyLog}
                className="px-3 py-1 rounded-md text-xs bg-[#2a3441]/60 text-[#c5c6c7] border border-[#3d4855] hover:bg-[#3d4855] transition-all"
              >
                <ClipboardCopy className="w-3.5 h-3.5 inline mr-1" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {result.turns.map((turn) => (
                <div key={turn.turnNumber}>
                  <span className="text-[#5a6069]">PICK {turn.turnNumber}. </span>
                  <span style={{ color: turn.team === "RED" ? "#ff6b6b" : "#5dade2" }}>
                    {turn.isCaptain ? `CAPTAIN ${turn.team}` : turn.team}
                  </span>
                  <span className="text-[#5a6069]"> = </span>
                  <span className="text-white">{turn.players.join(", ")}</span>
                </div>
              ))}
            </pre>
          </section>

          {/* ---- Final teams ---- */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["RED", "BLUE"] as const).map((team) => (
              <div
                key={team}
                className="glass-panel p-4 border-t-2"
                style={{ borderTopColor: team === "RED" ? "#ff6b6b" : "#5dade2" }}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <h2 className="font-bold" style={{ color: team === "RED" ? "#ff6b6b" : "#5dade2" }}>
                    {team}
                  </h2>
                  <span className="text-sm font-mono text-[#c5c6c7]">
                    tier total {result.tierTotals[team]}
                  </span>
                </div>
                <p className="text-[10px] text-[#5a6069] mb-3">
                  Roles are a suggested starting point — swap freely in game.
                </p>
                {/* Highest tier first, so the two rosters line up for eyeballing. Role is
                    a faint hint, not a badge — see the header. */}
                <div className="space-y-1">
                  {[...result.teams[team]]
                    .sort((a, b) => b.tierValue - a.tierValue || a.name.localeCompare(b.name))
                    .map((member) => (
                      <div
                        key={member.name}
                        className="flex items-center gap-2 text-sm py-1 border-b border-[#3d4855]/40 last:border-0"
                      >
                        <span className="text-white flex-1 truncate">
                          {member.name}
                          {member.reason === "captain" && (
                            <span
                              className="ml-1.5 text-[9px] font-bold uppercase tracking-wide align-middle"
                              style={{ color: "#66fcf1" }}
                            >
                              (C)
                            </span>
                          )}
                          {moverSet.has(member.name) && (
                            <span
                              className="ml-1.5 text-[9px] font-bold align-middle"
                              style={{ color: "#c084fc" }}
                              title="The live balancer puts this player on the other team"
                            >
                              ⇄
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-mono shrink-0 text-[#6a7079] w-10 text-right">
                          {member.slotLabel}
                        </span>
                        <span
                          className="text-[10px] font-mono shrink-0"
                          style={{ color: REASON_COLOURS[member.reason] }}
                          title={REASON_LABELS[member.reason]}
                        >
                          #{member.pickNumber}
                        </span>
                        <span className="text-xs font-mono shrink-0 w-7 text-right" style={{ color: "#f39c12" }}>
                          T{member.tierValue}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </section>

          {/* ---- A/B against the shipped balancer ---- */}
          {cmp && (
            <section className="glass-panel p-4">
              <h2 className="font-bold text-white mb-1">vs the live balancer</h2>
              <p className="text-xs text-[#8b9199] mb-4">
                The same twelve run through{" "}
                <span className="text-[#66fcf1]">/balancer</span>&rsquo;s scoring search — its first
                option, the split the bot serves. The draft&rsquo;s teams are also fed back through
                that evaluator so the two ratings are on one scale.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg border border-[#3d4855] bg-[#2a3441]/35 p-3">
                  <div className="text-2xl font-bold font-mono text-white">{cmp.sameSide}/12</div>
                  <div className="text-[11px] text-[#8b9199]">
                    players on the same side
                    {cmp.sameSide === 12
                      ? " — identical teams"
                      : cmp.sameSide === 6
                        ? " — no overlap beyond chance"
                        : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-[#3d4855] bg-[#2a3441]/35 p-3">
                  <div className="text-2xl font-bold font-mono">
                    <span style={{ color: cmp.draftGap <= cmp.baseline.gap ? "#7ed957" : "#f39c12" }}>
                      {cmp.draftGap}
                    </span>
                    <span className="text-[#5a6069] text-base"> vs </span>
                    <span className="text-[#c5c6c7]">{cmp.baseline.gap}</span>
                  </div>
                  <div className="text-[11px] text-[#8b9199]">tier gap — draft vs live&rsquo;s own</div>
                </div>
                <div className="rounded-lg border border-[#3d4855] bg-[#2a3441]/35 p-3">
                  {cmp.draftScoredLive ? (
                    <>
                      <div className="text-2xl font-bold font-mono">
                        <span
                          style={{
                            color:
                              cmp.baseline.confidence - cmp.draftScoredLive.confidence <= 5
                                ? "#7ed957"
                                : cmp.baseline.confidence - cmp.draftScoredLive.confidence <= 15
                                  ? "#f39c12"
                                  : "#e74c3c",
                          }}
                        >
                          {cmp.draftScoredLive.confidence}%
                        </span>
                        <span className="text-[#5a6069] text-base"> vs </span>
                        <span className="text-[#c5c6c7]">{cmp.baseline.confidence}%</span>
                      </div>
                      <div className="text-[11px] text-[#8b9199]">
                        live evaluator&rsquo;s rating — draft&rsquo;s split vs its own pick
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] text-[#8b9199]">draft split couldn&rsquo;t be scored</div>
                  )}
                </div>
              </div>

              {cmp.movers.length > 0 && (
                <p className="text-xs text-[#c5c6c7] mb-3">
                  <span style={{ color: "#c084fc" }}>⇄ </span>
                  The live balancer would move{" "}
                  <span className="font-mono text-white">{cmp.movers.join(", ")}</span> to the other
                  team ({cmp.movers.length} of 12).
                </p>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-[#8b9199] hover:text-[#c5c6c7]">
                  Live balancer&rsquo;s teams
                </summary>
                <div className="mt-2 font-mono space-y-1 text-[#c5c6c7]">
                  <div>
                    <span style={{ color: "#ff6b6b" }}>RED</span> (tier {cmp.baseline.redTierTotal}):{" "}
                    {cmp.baseline.teamRed.join(", ")}
                  </div>
                  <div>
                    <span style={{ color: "#5dade2" }}>BLUE</span> (tier {cmp.baseline.blueTierTotal}):{" "}
                    {cmp.baseline.teamBlue.join(", ")}
                  </div>
                </div>
              </details>
            </section>
          )}

          {/* ---- Why each pick happened ---- */}
          <section className="glass-panel p-4">
            <h2 className="font-bold text-white mb-3">Pick Reasoning</h2>
            <div className="space-y-1.5">
              {result.picks.map((pick) => (
                <div key={pick.pickNumber} className="flex gap-2 text-xs items-baseline">
                  <span className="text-[#5a6069] font-mono w-6 shrink-0 text-right">
                    {pick.pickNumber}.
                  </span>
                  <span
                    className="font-mono w-10 shrink-0"
                    style={{ color: pick.team === "RED" ? "#ff6b6b" : "#5dade2" }}
                  >
                    {pick.team}
                  </span>
                  <span className="text-white w-24 shrink-0 truncate">{pick.player}</span>
                  <span
                    className="px-1.5 py-0.5 rounded shrink-0 w-[76px] text-center"
                    style={{
                      color: REASON_COLOURS[pick.reason],
                      backgroundColor: `${REASON_COLOURS[pick.reason]}1a`,
                    }}
                  >
                    {REASON_LABELS[pick.reason]}
                  </span>
                  <span className="text-[#8b9199] flex-1">{pick.detail}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ---- Role statistics ---- */}
          <section className="glass-panel p-4">
            <h2 className="font-bold text-white mb-1">Role Statistics</h2>
            <p className="text-xs text-[#8b9199] mb-3">
              Each rating with its z-score below, green where the player is above this lobby's mean
              for the role. Roles are compared on z, not the raw number — a Chase 7 is rarer than a
              BC 7, so the two aren't the same asset.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
              {ALL_ROLES.map((role) => (
                <span key={role} className="text-[11px] font-mono text-[#8b9199]">
                  <span style={{ color: "#c5c6c7" }}>{role}</span> mean{" "}
                  {result.stats[role].mean.toFixed(2)} · SD {result.stats[role].sd.toFixed(2)}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#5a6069] border-b border-[#3d4855]">
                    <th className="text-left font-normal py-1 pr-2">Player</th>
                    <th className="text-right font-normal py-1 px-2">Tier</th>
                    {ALL_ROLES.map((role) => (
                      <th key={role} className="text-right font-normal py-1 px-2">
                        {role === "Cleaner" ? "BC" : role === "Support" ? "Supp" : role}
                      </th>
                    ))}
                    <th className="text-left font-normal py-1 px-2">Viable at</th>
                    <th className="text-right font-normal py-1 pl-2">Role avg</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.players]
                    .sort((a, b) => b.tierValue - a.tierValue || a.name.localeCompare(b.name))
                    .map((p) => (
                      <tr key={p.name} className="border-b border-[#3d4855]/30">
                        <td className="py-1 pr-2 text-white whitespace-nowrap">{p.name}</td>
                        <td className="py-1 px-2 text-right font-mono" style={{ color: "#f39c12" }}>
                          {p.tierValue}
                        </td>
                        {ALL_ROLES.map((role) => (
                          <td key={role} className="py-1 px-2 font-mono">
                            <RoleCell rating={p.roles[role]} z={p.z[role]} viable={p.viable[role]} />
                          </td>
                        ))}
                        <td
                          className="py-1 px-2 whitespace-nowrap"
                          style={{ color: "#7ed957" }}
                        >
                          {ALL_ROLES.filter((role) => p.viable[role])
                            .map((role) => (role === "Cleaner" ? "BC" : role === "Support" ? "Supp" : role))
                            .join(", ") || <span className="text-[#5a6069]">nothing</span>}
                        </td>
                        <td className="py-1 pl-2 text-right font-mono text-[#8b9199]">
                          {p.roleAverage.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
