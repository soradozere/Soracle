export interface Player {
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
  swapText: string
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
