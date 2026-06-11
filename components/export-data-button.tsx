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
export function ExportDataButton() {
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    try {
      const supabase = createClient()
      const players = await fetchPlayersFromDB()

      const { data: matches, error: matchError } = await supabase
        .from("matches")
        .select("id, created_at, red_team, blue_team, red_score, blue_score, match_type, balance_confidence")
        .order("created_at", { ascending: true })
      if (matchError) throw new Error(matchError.message)

      const { data: stats, error: statsError } = await supabase.from("match_stats").select("*")
      if (statsError) throw new Error(statsError.message)

      const tierByName = new Map(players.map((p) => [p.name, p.tierValue]))
      const nameById = new Map(players.map((p) => [p.id, p.name]))

      // --- Matches sheet (with balance-success columns) ---
      const matchRows = (matches || []).map((m) => {
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
        let wins = 0
        let losses = 0
        let draws = 0
        for (const m of matches || []) {
          const onRed = m.red_team?.includes(p.name)
          const onBlue = m.blue_team?.includes(p.name)
          if (!onRed && !onBlue) continue
          if (m.red_score === m.blue_score) draws++
          else if ((m.red_score > m.blue_score) === !!onRed) wins++
          else losses++
        }
        const games = wins + losses + draws
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

      // --- Per-player match stats sheet ---
      const matchById = new Map((matches || []).map((m) => [m.id, m]))
      const statRows = (stats || []).map((s: any) => {
        const m = matchById.get(s.match_id)
        const playerName = nameById.get(s.player_id) ?? "unknown"
        let won = ""
        if (m) {
          const onRed = s.team === "Red"
          won = m.red_score === m.blue_score ? "draw" : (m.red_score > m.blue_score) === onRed ? "yes" : "no"
        }
        return {
          match_id: s.match_id,
          date: m ? (m.created_at || "").slice(0, 10) : "",
          player: playerName,
          team: s.team,
          won,
          played_partial: s.played_partial ? "yes" : "no",
          time_played_s: s.time_played != null ? Math.round(s.time_played / 1000) : "",
          score: s.score,
          captures: s.captures,
          returns: s.returns,
          BC: s.base_cleaner,
          assists: s.assists,
          flag_grabs: s.flag_grabs,
          flag_hold_s: s.flag_hold_ms != null ? Math.round(s.flag_hold_ms / 1000) : "",
          kills: s.kills,
          deaths: s.deaths,
          red_kills: s.red_kills,
          yellow_kills: s.yellow_kills,
          blue_kills: s.blue_kills,
          dfa_kills: s.dfa_kills,
          ydfa_kills: s.ydfa_kills,
          bs_kills: s.bs_kills,
          dbs_kills: s.dbs_kills,
          blubs_kills: s.blubs_kills,
          upcut_kills: s.upcut_kills,
          red_returns: s.red_returns,
          yellow_returns: s.yellow_returns,
          blue_returns: s.blue_returns,
          dfa_returns: s.dfa_returns,
          ydfa_returns: s.ydfa_returns,
          bs_returns: s.bs_returns,
          dbs_returns: s.dbs_returns,
        }
      })

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
        ["Matches", "Every logged match. Tier totals use CURRENT player tiers, not the tiers at match time."],
        ["Match player stats", "One row per player per match, from the uploaded match CSVs."],
        ["Balance summary", "Quick aggregates incl. how often the tier-favourite team won."],
        [],
        ["Not included", "Discord ids, tooltips, admin notes, or any account data."],
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "Read me")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(playerRows), "Players")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchRows), "Matches")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "Match player stats")
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Balance summary")
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
