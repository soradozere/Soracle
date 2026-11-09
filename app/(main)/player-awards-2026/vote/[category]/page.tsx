import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { ChevronLeft, LogIn } from "lucide-react"
import { AWARD_CATEGORIES, categorySlug, CategoryIcon } from "../../award-categories"
import { fetchPlayersFromDB, isPlayerInactive } from "@/lib/fetch-players-db"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { createServiceClient } from "@/lib/supabase/admin"
import { PlayerVoteForm } from "./player-vote-form"
import { QuoteVoteForm } from "./quote-vote-form"

interface Props {
  params: Promise<{ category: string }>
}

function findCategory(slug: string) {
  return AWARD_CATEGORIES.find((c) => categorySlug(c.title) === slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params
  const category = findCategory(slug)
  return {
    title: category ? `${category.title} — Player Awards 2026` : "Player Awards 2026",
  }
}

export default async function VoteCategoryPage({ params }: Props) {
  const { category: slug } = await params
  const category = findCategory(slug)
  if (!category) notFound()

  // One voting session per player, so the form itself is gated here -- same
  // session cookie the rest of the site already trusts, not just a note in
  // the copy above it.
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  const signedIn = !!playerId

  // Only the two open kinds need anything fetched. The roster is skipped
  // entirely when signed out, so a logged-out visitor never pulls it just to
  // be told to log in.
  const players =
    category.kind === "player" && signedIn
      ? (await fetchPlayersFromDB())
          .filter((p) => !isPlayerInactive(p))
          .map((p) => ({ id: p.id, name: p.name }))
      : []

  // Re-opening the page after voting should show what you already picked,
  // not an empty form -- award_votes_2026 is one row per (voter, category),
  // so "my vote here" is a single lookup.
  let existingNomineeId: string | null = null
  let existingQuote: string | null = null
  let existingComment: string | null = null
  if (signedIn && category.kind !== "closed") {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from("award_votes_2026")
      .select("nominee_player_id, quote_text, comment")
      .eq("voter_player_id", playerId)
      .eq("category", slug)
      .maybeSingle()
    if (data) {
      existingNomineeId = data.nominee_player_id
      existingQuote = data.quote_text
      existingComment = data.comment
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl relative z-10">
      <Link
        href="/player-awards-2026"
        className="inline-flex items-center gap-1 text-sm text-[#8892a0] hover:text-[#66fcf1] mb-8"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All categories
      </Link>

      <div className="text-center mb-10">
        <CategoryIcon icon={category.icon} color={category.color} className="h-12 w-12 mx-auto mb-4" />
        <h1
          className="text-3xl font-bold text-white mb-2"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          {category.title}
        </h1>
        {category.blurb && <p className="text-[#8892a0]">{category.blurb}</p>}
      </div>

      {category.kind === "closed" ? (
        <div className="bg-[#1f2833]/40 border border-dashed border-[#3d4855] rounded-lg p-10 text-center text-[#8892a0]">
          Voting for this category opens soon.
        </div>
      ) : !signedIn ? (
        <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-10 flex flex-col items-center gap-4 text-center">
          <p className="text-[#8892a0]">You need to be logged in to vote — it's how we keep this to one vote per player.</p>
          <Link
            href="/player-login"
            className="inline-flex items-center gap-2 rounded-lg bg-[#66fcf1] px-6 py-3 font-bold text-[#0b0c10] shadow-[0_0_18px_rgba(102,252,241,0.25)] transition hover:brightness-110"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Log in to vote
          </Link>
        </div>
      ) : category.kind === "player" ? (
        <PlayerVoteForm category={slug} players={players} initialSelectedId={existingNomineeId} initialComment={existingComment ?? ""} />
      ) : (
        <QuoteVoteForm initialQuote={existingQuote ?? ""} initialComment={existingComment ?? ""} />
      )}
    </div>
  )
}
