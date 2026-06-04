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
