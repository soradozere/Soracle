import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AdminHeader, AdminSection } from "@/components/admin-header"
import { requireFullAdminPage } from "@/lib/player-role"
import { createServiceClient } from "@/lib/supabase/admin"
import { AWARD_CATEGORIES, categorySlug } from "../../(main)/player-awards-2026/award-categories"

interface VoteRow {
  id: string
  category: string
  voter_player_id: string
  nominee_player_id: string | null
  quote_text: string | null
  comment: string | null
  updated_at: string
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export default async function PlayerAwardsAdminPage() {
  const { label } = await requireFullAdminPage()

  // Service-role, not the player-session-aware anon client: a player-session
  // full_admin has no auth.uid() for the RLS admin policies on
  // award_votes_2026 to match (see 049_create_award_votes_2026.sql), same
  // reasoning as the rest of /admin.
  const supabase = createServiceClient()
  const [{ data: votes }, { data: players }] = await Promise.all([
    supabase
      .from("award_votes_2026")
      .select("id, category, voter_player_id, nominee_player_id, quote_text, comment, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("players").select("id, name"),
  ])

  const nameById = new Map((players ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const votesByCategory = new Map<string, VoteRow[]>()
  for (const v of (votes ?? []) as VoteRow[]) {
    const list = votesByCategory.get(v.category) ?? []
    list.push(v)
    votesByCategory.set(v.category, list)
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--color-background)" }}>
      <AdminHeader
        title="Player Awards 2026"
        subtitle={`Votes as they come in, 12 categories · signed in as ${label}`}
        actions={
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
          </Link>
        }
      />

      <main className="w-full px-6 py-8 space-y-6">
        {AWARD_CATEGORIES.map((category) => {
          const slug = categorySlug(category.title)
          const rows = votesByCategory.get(slug) ?? []

          // Nominee picks only — a tally has nothing to count for freeform quotes.
          const tally = new Map<string, number>()
          if (category.kind === "player") {
            for (const row of rows) {
              if (!row.nominee_player_id) continue
              const name = nameById.get(row.nominee_player_id) ?? "Unknown player"
              tally.set(name, (tally.get(name) ?? 0) + 1)
            }
          }
          const sortedTally = [...tally.entries()].sort((a, b) => b[1] - a[1])

          return (
            <AdminSection
              key={category.title}
              title={category.title}
              description={
                category.kind === "closed"
                  ? "Not open yet."
                  : `${rows.length} vote${rows.length === 1 ? "" : "s"} so far.`
              }
            >
              {category.kind === "closed" ? null : rows.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
                  No votes yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {sortedTally.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {sortedTally.map(([name, count]) => (
                        <span
                          key={name}
                          className="rounded-md px-2.5 py-1 text-xs font-semibold"
                          style={{
                            border: "1px solid var(--glass-hair)",
                            color: "var(--color-text-bright)",
                          }}
                        >
                          {name} <span style={{ color: "var(--color-primary)" }}>×{count}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left" style={{ color: "var(--color-text-dim)" }}>
                          <th className="font-normal pb-2 pr-4">Voter</th>
                          <th className="font-normal pb-2 pr-4">{category.kind === "quote" ? "Quote" : "Pick"}</th>
                          <th className="font-normal pb-2 pr-4">Comment</th>
                          <th className="font-normal pb-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} style={{ borderTop: "1px solid var(--glass-hair)" }}>
                            <td className="py-2 pr-4" style={{ color: "var(--color-text-bright)" }}>
                              {nameById.get(row.voter_player_id) ?? "Unknown player"}
                            </td>
                            <td className="py-2 pr-4" style={{ color: "var(--color-text-bright)" }}>
                              {row.nominee_player_id ? nameById.get(row.nominee_player_id) ?? "Unknown player" : row.quote_text}
                            </td>
                            <td className="py-2 pr-4 max-w-xs" style={{ color: "var(--color-text-dim)" }}>
                              {row.comment ?? "—"}
                            </td>
                            <td className="py-2 whitespace-nowrap" style={{ color: "var(--color-text-dim)" }}>
                              {fmtWhen(row.updated_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </AdminSection>
          )
        })}
      </main>
    </div>
  )
}
