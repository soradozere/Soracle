"use client"

import { useState } from "react"
import * as XLSX from "xlsx"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"

// One-click export of all non-sensitive Soracle data as a multi-sheet Excel
// workbook, for community analysis. Deliberately excluded: discord ids,
// tooltips, admin notes, account/auth data.

// supabase-js caps a select at 1000 rows, and match_stats grows ~12 rows per
// match — so every table is paged, or the export silently truncates.
const PAGE_SIZE = 1000

async function fetchAllRows<T>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

// match_stats columns that identify/annotate a row rather than count something.
// Everything else is a summable career counter, discovered from the rows
// themselves so new scoreboard columns flow into the export automatically.
const NON_STAT_COLUMNS = new Set([
  "id",
  "match_id",
  "player_id",
  "team",
  "name_raw",
  "in_game_name",
  "created_at",
  "played_partial",
  "ping_mean", // an average, not a total — carried separately
])

// Stat column names in the order Postgres returns them, minus the meta columns.
function statColumnsOf(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (NON_STAT_COLUMNS.has(key) || seen.has(key)) continue
      if (typeof row[key] !== "number" && row[key] !== null) continue
      seen.add(key)
      cols.push(key)
    }
  }
  return cols
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp

export function ExportDataButton() {
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    try {
      const supabase = createClient()
      const players = await fetchPlayersFromDB()

      const matches = await fetchAllRows<any>(
        supabase,
        "matches",
        "id, created_at, red_team, blue_team, red_score, blue_score, match_type, balance_confidence",
      )
      const stats = await fetchAllRows<any>(supabase, "match_stats", "*")

      const tierByName = new Map(players.map((p) => [p.name, p.tierValue]))
      const nameById = new Map(players.map((p) => [p.id, p.name]))

      // All-time W/L per player, computed once and shared by the Players and
      // Career sheets.
      const recordFor = (name: string) => {
        let wins = 0
        let losses = 0
        let draws = 0
        for (const m of matches) {
          const onRed = m.red_team?.includes(name)
          const onBlue = m.blue_team?.includes(name)
          if (!onRed && !onBlue) continue
          if (m.red_score === m.blue_score) draws++
          else if ((m.red_score > m.blue_score) === !!onRed) wins++
          else losses++
        }
        return { wins, losses, draws, games: wins + losses + draws }
      }
      const recordByName = new Map(players.map((p) => [p.name, recordFor(p.name)]))

      // --- Matches sheet (with balance-success columns) ---
      const matchRows = matches.map((m) => {
        const redTier = (m.red_team || []).reduce((s: number, n: string) => s + (tierByName.get(n) ?? 0), 0)
        const blueTier = (m.blue_team || []).reduce((s: number, n: string) => s + (tierByName.get(n) ?? 0), 0)
        const winner = m.red_score === m.blue_score ? "Draw" : m.red_score > m.blue_score ? "Red" : "Blue"
        const predicted = redTier === blueTier ? "Even" : redTier > blueTier ? "Red" : "Blue"
        return {
          match_id: m.id,
          date: (m.created_at || "").slice(0, 10),
          type: m.match_type,
          red_team: (m.red_team || []).join(", "),
          blue_team: (m.blue_team || []).join(", "),
          red_score: m.red_score,
          blue_score: m.blue_score,
          winner,
          margin: Math.abs(m.red_score - m.blue_score),
          red_tier_total: redTier,
          blue_tier_total: blueTier,
          predicted_stronger: predicted,
          prediction_correct: winner === "Draw" || predicted === "Even" ? "" : predicted === winner ? "yes" : "no",
          balance_confidence: m.balance_confidence ?? "",
        }
      })

      // --- Players sheet (all-time W/L from match history) ---
      const playerRows = players.map((p) => {
        const { wins, losses, draws, games } = recordByName.get(p.name)!
        return {
          name: p.name,
          tier: p.tierValue,
          mic: p.mic ? "yes" : "no",
          Capper: p.roles.Capper,
          Chase: p.roles.Chase,
          Camp: p.roles.Camp,
          BC: p.roles.Cleaner,
          Support: p.roles.Support,
          active: p.is_active && !p.manually_inactive ? "yes" : "no",
          matches: games,
          wins,
          losses,
          draws,
          winrate: games ? Math.round((wins / games) * 100) + "%" : "",
          last_match: p.last_match_at ? String(p.last_match_at).slice(0, 10) : "",
        }
      })

      // --- Per-player match stats sheet: EVERY match_stats counter, not a subset ---
      const statCols = statColumnsOf(stats)
      const matchById = new Map(matches.map((m) => [m.id, m]))
      const statRows = stats.map((s: any) => {
        const m = matchById.get(s.match_id)
        let won = ""
        if (m) {
          const onRed = s.team === "Red"
          won = m.red_score === m.blue_score ? "draw" : (m.red_score > m.blue_score) === onRed ? "yes" : "no"
        }
        const row: Record<string, unknown> = {
          match_id: s.match_id,
          date: m ? (m.created_at || "").slice(0, 10) : "",
          player: nameById.get(s.player_id) ?? "unknown",
          in_game_name: s.in_game_name ?? "",
          team: s.team,
          won,
          played_partial: s.played_partial ? "yes" : "no",
          ping_mean: s.ping_mean ?? "",
        }
        for (const c of statCols) row[c] = s[c] ?? 0
        return row
      })

      // --- Data issues sheet -------------------------------------------------
      // Two scoreboard rows for the same (match, player) mean one of two things,
      // and they are NOT interchangeable:
      //   same team  -> a mid-match reconnect. Two stints of one human; summing
      //                 them is the true match total.
      //   both teams -> a mis-map. JK2 players "fake" each other's names, so two
      //                 different humans got mapped onto one player at approval.
      //                 Summing would credit an opponent's stats to this player.
      // The second case is a data error to fix at source (re-map the match), so
      // surface it rather than quietly folding it into the career totals.
      const rowsByPair = new Map<string, any[]>()
      for (const s of stats as any[]) {
        const key = `${s.match_id}:${s.player_id}`
        const list = rowsByPair.get(key)
        if (list) list.push(s)
        else rowsByPair.set(key, [s])
      }
      const misMappedPairs = new Set<string>()
      const issueRows: Record<string, unknown>[] = []
      for (const [key, rs] of rowsByPair) {
        if (rs.length < 2) continue
        const teams = [...new Set(rs.map((r) => r.team))]
        const crossTeam = teams.length > 1
        if (crossTeam) misMappedPairs.add(key)
        const m = matchById.get(rs[0].match_id)
        issueRows.push({
          match_id: rs[0].match_id,
          date: m ? (m.created_at || "").slice(0, 10) : "",
          player: nameById.get(rs[0].player_id) ?? "unknown",
          rows: rs.length,
          teams: teams.join(" + "),
          issue: crossTeam
            ? "MIS-MAPPED — same player on both teams (likely a faked name). Career totals EXCLUDE this match."
            : "Reconnect — stints summed into one match",
          detail: rs
            .map((r) => `${r.team} ${r.time_played}m ${r.kills}k${r.in_game_name ? ` "${r.in_game_name}"` : ""}`)
            .join("  |  "),
        })
      }
      if (!issueRows.length) issueRows.push({ issue: "No duplicate player rows found." })

      // --- Career stats sheet: all-time totals per player, every counter ---
      // Totals keyed by player id, then emitted for the whole roster (players
      // with no CSV-covered games come out as zeroes rather than vanishing).
      // A reconnect gives a player two rows for one match (one per stint), so
      // every stint is summed but the match is counted once — otherwise per-game
      // averages would be divided by an inflated match count.
      const totalsById = new Map<string, { matchIds: Set<string>; pings: number[]; totals: Record<string, number> }>()
      for (const s of stats as any[]) {
        // Skip mis-mapped (both-teams) pairs entirely — see the Data issues sheet.
        // Their rows belong to two different humans, so neither summing nor picking
        // one is defensible; the match must be re-mapped in the admin panel.
        if (misMappedPairs.has(`${s.match_id}:${s.player_id}`)) continue
        let rec = totalsById.get(s.player_id)
        if (!rec) {
          rec = { matchIds: new Set(), pings: [], totals: {} }
          totalsById.set(s.player_id, rec)
        }
        rec.matchIds.add(s.match_id)
        if (typeof s.ping_mean === "number") rec.pings.push(s.ping_mean)
        for (const c of statCols) rec.totals[c] = (rec.totals[c] ?? 0) + (s[c] ?? 0)
      }

      const careerRows = players
        .map((p) => {
          const rec = totalsById.get(p.id)
          const t = rec?.totals ?? {}
          const { wins, losses, draws, games } = recordByName.get(p.name)!
          const statMatches = rec?.matchIds.size ?? 0
          const kills = t.kills ?? 0
          const deaths = t.deaths ?? 0
          const perGame = (v: number) => (statMatches ? round(v / statMatches) : 0)
          const row = {
            player: p.name,
            tier: p.tierValue,
            active: p.is_active && !p.manually_inactive ? "yes" : "no",
            games,
            wins,
            losses,
            draws,
            winrate: games ? Math.round((wins / games) * 100) + "%" : "",
            stat_tracked_matches: statMatches,
            // Every raw counter, summed across the player's whole history.
            ...Object.fromEntries(statCols.map((c) => [c, t[c] ?? 0])),
            // Derived conveniences. time_played is MINUTES; flag_hold_ms is milliseconds.
            kd: deaths ? round(kills / deaths) : kills,
            time_played_hours: round((t.time_played ?? 0) / 60, 1),
            flag_hold_minutes: round((t.flag_hold_ms ?? 0) / 60000, 1),
            score_per_game: perGame(t.score ?? 0),
            kills_per_game: perGame(kills),
            captures_per_game: perGame(t.captures ?? 0),
            returns_per_game: perGame(t.returns ?? 0),
            avg_ping: rec?.pings.length ? round(rec.pings.reduce((a, b) => a + b, 0) / rec.pings.length, 1) : "",
          }
          // Career leaders first; players with no scoreboard data sink to the bottom.
          return { row, sortScore: t.score ?? 0 }
        })
        .sort((a, b) => b.sortScore - a.sortScore)
        .map((r) => r.row)

      // --- Balance summary sheet ---
      const decided = matchRows.filter((r) => r.prediction_correct !== "")
      const correct = decided.filter((r) => r.prediction_correct === "yes").length
      const byType = new Map<string, number>()
      for (const r of matchRows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
      const summaryRows = [
        { metric: "players", value: players.length },
        { metric: "matches", value: matchRows.length },
        ...[...byType.entries()].map(([t, n]) => ({ metric: `matches (${t})`, value: n })),
        { metric: "matches with a tier favourite & a winner", value: decided.length },
        {
          metric: "tier favourite won",
          value: decided.length ? `${correct} (${Math.round((correct / decided.length) * 100)}%)` : "n/a",
        },
        {
          metric: "average score margin",
          value: matchRows.length
            ? (matchRows.reduce((s, r) => s + r.margin, 0) / matchRows.length).toFixed(1)
            : "n/a",
        },
        { metric: "first match", value: matchRows[0]?.date ?? "n/a" },
        { metric: "last match", value: matchRows[matchRows.length - 1]?.date ?? "n/a" },
      ]

      const readme = [
        ["Soracle data export", new Date().toISOString().slice(0, 10)],
        [],
        ["Players", "Roster with role ratings and all-time W/L computed from the match history."],
        ["Career stats", "One row per player: all-time totals of EVERY scoreboard counter, plus K/D and per-game averages. Players with no scoreboard-covered games appear as zeroes."],
        ["Data issues", "Matches where one player has more than one scoreboard row — reconnects (harmless, summed) and mis-maps (excluded, need fixing)."],
        ["Matches", "Every logged match. Tier totals use CURRENT player tiers, not the tiers at match time."],
        ["Match player stats", "One row per player per match — every match_stats column, straight from the uploaded CSVs."],
        ["Balance summary", "Quick aggregates incl. how often the tier-favourite team won."],
        [],
        ["Units", "time_played is in MINUTES. flag_hold_ms is in MILLISECONDS. The Career sheet also gives time_played_hours and flag_hold_minutes."],
        ["Coverage", "Career and Match player stats only cover matches that had a scoreboard CSV uploaded; Players/Matches cover every logged match."],
        ["Reconnects", "A player who reconnected mid-match has one row per stint, sometimes under a different in-game name. When both stints are on the SAME team, career totals sum them; stat_tracked_matches counts distinct matches, so per-game averages stay honest."],
        ["Data issues", "Because JK2 players fake each other's names, two scoreboard rows can be mapped onto one player even though they were two different humans — the tell is the same player appearing on BOTH teams. Those matches are excluded from that player's career totals and listed on the Data issues sheet; fix them by re-mapping the match in the admin panel."],
        [],
        ["Not included", "Discord ids, tooltips, admin notes, or any account data."],
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "Read me")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerRows), "Players")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(careerRows), "Career stats")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchRows), "Matches")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "Match player stats")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Balance summary")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issueRows), "Data issues")
      XLSX.writeFile(wb, `soracle-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : "unknown error"}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
      Export All Soracle data
    </Button>
  )
}
