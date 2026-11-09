import { NextResponse } from "next/server"
import { fetchHistoryRows } from "@/lib/achievements-server"

// Match history for the client-side leaderboards (components/elo-leaderboard.tsx,
// trueskill-leaderboard.tsx, production-leaderboard.tsx, impact-leaderboard.tsx).
//
// Those boards used to query matches/players/match_stats straight from the
// browser with the anon key -- unbounded, on every mount and every month
// change, which meant Supabase re-served the whole history to every visitor
// on every load. fetchHistoryRows() already fetches and caches this same data
// (unstable_cache, HISTORY_TAG, see lib/achievements-server.ts) for the
// achievements/homepage/players pages, so this route just re-shapes it for
// these four boards instead of running a second, uncached set of queries.
//
// The stats fields below are the union of what the four boards read: kills/
// deaths for ELO/TrueSkill's K/D column, the rest for Production/Impact's
// per-job and per-stat maths. Kept to that union rather than every
// match_stats column (see STAT_COLUMNS in lib/achievements-server.ts) so the
// JSON shipped to every browser stays small.
//
// No-store rather than a browser/CDN-cacheable max-age: freshness already
// lives in fetchHistoryRows' own cache + HISTORY_TAG invalidation (including
// the tier-change writers in app/admin/player-actions.ts, which this route's
// existence is why they now call updateTag). A second cache layered on top
// here would just risk serving stale data past that.
export async function GET() {
  const { matches, players, stats, killPairs } = await fetchHistoryRows()

  return NextResponse.json(
    {
      matches,
      players: players.map((p) => ({ id: p.id, name: p.name, tier_value: p.tier_value })),
      // Only what the Production/Impact board's Cap tooltip needs (lib/cap-conversion.ts's
      // KillRow) -- killer_player_id and kills ride along in fetchHistoryRows for the
      // achievement passes but have no reader here.
      killPairs: killPairs.map((k) => ({ match_id: k.match_id, victim_player_id: k.victim_player_id, rets: k.rets })),
      stats: stats.map((s) => ({
        player_id: s.player_id,
        match_id: s.match_id,
        team: s.team,
        score: s.score,
        kills: s.kills,
        deaths: s.deaths,
        captures: s.captures,
        flag_grabs: s.flag_grabs,
        flag_hold_ms: s.flag_hold_ms,
        returns: s.returns,
        assists: s.assists,
        base_cleaner: s.base_cleaner,
        mine_kills: s.mine_kills,
        mine_grabs_red: s.mine_grabs_red,
        mine_grabs_blue: s.mine_grabs_blue,
        mine_returns: s.mine_returns,
        time_played: s.time_played,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
