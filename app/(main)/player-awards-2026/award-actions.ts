"use server"

import { cookies } from "next/headers"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { createServiceClient } from "@/lib/supabase/admin"
import { AWARD_CATEGORIES, categorySlug } from "./award-categories"

const QUOTE_CATEGORY = categorySlug("Quote of the year")
const QUOTE_MAX_LENGTH = 500
const COMMENT_MAX_LENGTH = 500

type ActionResult = { success: true } | { success: false; error: string }

// Players sign in through the cookie-session system (lib/player-auth.ts), not
// Supabase Auth -- there's no auth.uid() for RLS to key a write policy off
// of, so every vote write re-derives the voter from this cookie server-side
// and goes through the service-role client. A client can submit a category
// and a pick; it can never submit who it's voting as.
async function requireVoter(): Promise<{ ok: true; playerId: string } | { ok: false; error: string }> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return { ok: false, error: "You need to be logged in to vote." }
  return { ok: true, playerId }
}

export async function castPlayerVote(category: string, nomineePlayerId: string, comment: string): Promise<ActionResult> {
  const auth = await requireVoter()
  if (!auth.ok) return { success: false, error: auth.error }

  const known = AWARD_CATEGORIES.find((c) => categorySlug(c.title) === category)
  if (!known || known.kind !== "player") return { success: false, error: "Unknown category." }
  if (!nomineePlayerId) return { success: false, error: "Pick a player first." }

  const supabase = createServiceClient()
  // A vote for someone no longer on the roster (left, renamed away, etc.)
  // would otherwise fail the foreign key with an opaque error.
  const { data: nominee } = await supabase.from("players").select("id").eq("id", nomineePlayerId).maybeSingle()
  if (!nominee) return { success: false, error: "That player isn't on the roster." }

  const { error } = await supabase.from("award_votes_2026").upsert(
    {
      category,
      voter_player_id: auth.playerId,
      nominee_player_id: nomineePlayerId,
      quote_text: null,
      comment: comment.trim().slice(0, COMMENT_MAX_LENGTH) || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "voter_player_id,category" },
  )
  if (error) return { success: false, error: "Could not save your vote. Try again." }
  return { success: true }
}

export async function castQuoteVote(quoteText: string, comment: string): Promise<ActionResult> {
  const auth = await requireVoter()
  if (!auth.ok) return { success: false, error: auth.error }

  const trimmed = quoteText.trim()
  if (!trimmed) return { success: false, error: "Enter the quote first." }
  if (trimmed.length > QUOTE_MAX_LENGTH) return { success: false, error: `Keep it under ${QUOTE_MAX_LENGTH} characters.` }

  const supabase = createServiceClient()
  const { error } = await supabase.from("award_votes_2026").upsert(
    {
      category: QUOTE_CATEGORY,
      voter_player_id: auth.playerId,
      nominee_player_id: null,
      quote_text: trimmed,
      comment: comment.trim().slice(0, COMMENT_MAX_LENGTH) || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "voter_player_id,category" },
  )
  if (error) return { success: false, error: "Could not save your vote. Try again." }
  return { success: true }
}
