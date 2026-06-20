export interface Player {
  id: string
  name: string
  tierValue: number
  mic: boolean
  roles: {
    Capper: number
    Chase: number
    Camp: number
    Cleaner: number
    Support: number
  }
  tooltip?: string
  disabledRoles?: string[]
  is_active?: boolean
  last_match_at?: string | null
  manually_inactive?: boolean
  discord_ids?: string[]
}

export interface BalanceResult {
  teamRed: string[]
  teamBlue: string[]
  redMic: number
  blueMic: number
  redTierTotal: number
  blueTierTotal: number
  // Present only for the admin-only "Balance by ELO" mode — team average ELO. When set,
  // the balance UI shows ELO totals instead of tier totals.
  redEloTotal?: number
  blueEloTotal?: number
  wasRandomized: boolean
}

export interface BalanceOption {
  result: BalanceResult
  score: number
  label: string
  description: string
}

export interface BalanceHistoryEntry {
  id: string
  result: BalanceResult
  timestamp: Date
  selectedPlayers: string[]
}

export interface MatchStats {
  id: string
  match_id: string
  player_id: string
  team: "Red" | "Blue"
  played_partial: boolean

  // Raw in-game scoreboard name (NAME-CLEAN). Null for rows logged before
  // migration 012, when the name wasn't persisted.
  in_game_name: string | null

  // In-game scoreboard score (SCORE-SUM)
  score: number

  // Flag stats
  captures: number
  returns: number
  base_cleaner: number
  assists: number
  flag_grabs: number
  flag_hold_ms: number

  // Combat
  kills: number
  deaths: number

  // Saber kills
  red_kills: number
  yellow_kills: number
  blue_kills: number
  dfa_kills: number
  ydfa_kills: number
  bs_kills: number
  dbs_kills: number
  blubs_kills: number
  upcut_kills: number

  // Saber returns
  red_returns: number
  yellow_returns: number
  blue_returns: number
  dfa_returns: number
  ydfa_returns: number
  bs_returns: number
  dbs_returns: number
  blubs_returns: number
  upcut_returns: number

  // Other kill types
  mine_kills: number
  mine_returns: number
  doom_kills: number
  turret_kills: number
  idle_kills: number

  // Mines
  mine_grabs_red: number
  mine_grabs_blue: number

  // Network
  time_played: number | null

  created_at: string
}

// A match_stats row ready to insert, before match_id / id / created_at exist.
export type MatchStatInsert = Omit<MatchStats, "id" | "match_id" | "created_at">

// Payload handed from the CSV modal to the Log Match form on confirm.
export interface CsvMatchData {
  redTeamNames: string[]
  blueTeamNames: string[]
  redScore: number
  blueScore: number
  matchPlayedAtIso: string | null
  matchStats: MatchStatInsert[]
  csvFile: File
  // Manual vs algorithm pick, set only in pending-review mode (the manual upload
  // flow carries its own match-type control); the approval handler reads it.
  matchType?: "manual" | "algorithm"
}
