// Resolving an in-game name to a Soracle player.
//
// JK2 players show up on the scoreboard with clan tags ("{FoU} Original"),
// engine colour codes ("^1Ewok"), odd casing and spacing, and sometimes a
// completely different name from one night to the next. This module layers four
// strategies, strongest first, so the importer auto-fills as much as it safely
// can and leaves the rest for an admin:
//
//   1. exact      — the raw name equals a player's Soracle name
//   2. alias      — the raw name equals a known alias (see player_aliases)
//   3. normalized — clan-tag / colour-code / case / whitespace folded name
//                   equals a player's normalized name or normalized alias
//   4. fuzzy      — Fuse.js best match within FUZZY_CONFIDENCE_THRESHOLD
//
// Only confident matches are returned; anything weaker resolves to null so the
// admin is asked rather than guessed at. Shared by the upload modal and the
// server-side bot endpoint, so it must stay free of React / DOM.

import Fuse from "fuse.js"
import type { Player } from "@/lib/types"

// Fuzzy-matching tuning. Lower fuse score = better match.
// THRESHOLD controls which matches fuse returns at all; CONFIDENCE_THRESHOLD
// controls which of those are good enough to auto-prefill.
export const FUZZY_THRESHOLD = 0.4
export const FUZZY_CONFIDENCE_THRESHOLD = 0.3

export interface PlayerAlias {
  player_id: string
  alias: string
}

export type MatchMethod = "exact" | "alias" | "normalized" | "fuzzy"

export interface NameMatch {
  playerId: string
  method: MatchMethod
}

// Fold an in-game name down to a comparable core. Clan tags in the wild come in
// far more shapes than bracketed ones, so we strip, in order:
//   * Quake3/JK2 colour codes (^ followed by any single char),
//   * a leading bracketed tag — {}, [], (), <> — even with inner spaces
//     ("[Big Clan] Foo" -> "Foo"),
//   * a leading symbol-led tag up to the first space (".:FoU:. Original." -> the
//     tail; "=DBD= name" -> "name"),
//   * a leading run of symbols glued to the name ("_-}-_Suvix" -> "Suvix"),
//   * trailing symbols ("Original." -> "Original"),
// then lowercase and collapse internal whitespace. A bare-word tag with no
// surrounding symbols ("CoS # uruma", "clan name") is deliberately left intact —
// stripping leading words would wreck real names like "Christian Craken" — and is
// handled by learned aliases instead.
export function normalizeName(raw: string): string {
  return raw
    .replace(/\^./g, "") // colour codes
    .replace(/^\s*[[{(<][^\])}>]*[\])}>]\s*/, "") // bracketed tag (handles inner spaces)
    .replace(/^\s*[^a-zA-Z0-9\s][^\s]*\s+/, "") // symbol-led tag up to first space
    .replace(/^[^a-zA-Z0-9]+/, "") // glued leading symbol run
    .replace(/[^a-zA-Z0-9]+$/, "") // trailing symbols
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export interface NameResolver {
  resolve(rawName: string): NameMatch | null
}

// Build a resolver over the current roster (and optional known aliases). The
// maps are built once per call; create one resolver and reuse it across all rows
// of a scoreboard. When two players normalize to the same key, the key is left
// out rather than resolving ambiguously.
export function createNameResolver(
  players: Player[],
  aliases: PlayerAlias[] = [],
): NameResolver {
  const exactByName = new Map<string, string>()
  for (const p of players) exactByName.set(p.name.trim(), p.id)

  const exactByAlias = new Map<string, string>()
  for (const a of aliases) exactByAlias.set(a.alias.trim(), a.player_id)

  // Normalized lookup, shared by player names and aliases. Track ambiguity so a
  // key that two different players claim is dropped instead of guessed.
  const normalized = new Map<string, string>()
  const ambiguous = new Set<string>()
  const addNormalized = (key: string, playerId: string) => {
    if (!key || ambiguous.has(key)) return
    const existing = normalized.get(key)
    if (existing === undefined) {
      normalized.set(key, playerId)
    } else if (existing !== playerId) {
      normalized.delete(key)
      ambiguous.add(key)
    }
  }
  for (const p of players) addNormalized(normalizeName(p.name), p.id)
  for (const a of aliases) addNormalized(normalizeName(a.alias), a.player_id)

  const fuse = new Fuse(players, {
    keys: ["name"],
    threshold: FUZZY_THRESHOLD,
    includeScore: true,
    shouldSort: true,
    minMatchCharLength: 2,
  })

  return {
    resolve(rawName: string): NameMatch | null {
      const name = (rawName ?? "").trim()
      if (!name) return null

      const exact = exactByName.get(name)
      if (exact) return { playerId: exact, method: "exact" }

      const alias = exactByAlias.get(name)
      if (alias) return { playerId: alias, method: "alias" }

      const norm = normalizeName(name)
      const normHit = norm ? normalized.get(norm) : undefined
      if (normHit) return { playerId: normHit, method: "normalized" }

      // Fuzzy on the normalized (tag-stripped) form so clan tags don't drag the
      // score; only accept it if it clears the confidence threshold.
      const query = norm || name
      const best = fuse.search(query)[0]
      if (best && best.score !== undefined && best.score <= FUZZY_CONFIDENCE_THRESHOLD) {
        return { playerId: best.item.id, method: "fuzzy" }
      }

      return null
    },
  }
}
