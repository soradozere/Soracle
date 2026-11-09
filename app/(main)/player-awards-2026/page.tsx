import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { BarChart3, LogIn, ChevronRight } from "lucide-react"
import { AWARD_CATEGORIES, categorySlug, CategoryIcon } from "./award-categories"

export const metadata: Metadata = {
  title: "Player Awards 2026 — JK2 Capture the Flag",
  description: "Vote for who defined the 2026 season across twelve categories. Voting closes 27 November.",
}

const VOTING_CLOSES = "27 November 2026"

export default function PlayerAwards2026Page() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      {/* Hero carries the page's own heading (baked into the image), so there's
          no separate title below it. */}
      <div className="mb-10 relative aspect-[2000/860] w-full overflow-hidden rounded-xl border border-[#3d4855]">
        <Image
          src="/player-awards-2026/hero.jpg"
          alt="JK2 CTF Player Awards 2026"
          fill
          priority
          sizes="(min-width: 1024px) 896px, 100vw"
          className="object-cover"
        />
      </div>

      <p className="text-[#c5c6c7] max-w-xl mx-auto leading-relaxed text-center mb-10">
        Players vote for players — twelve categories covering the whole season, decided by the people who were
        actually out there.
      </p>

      {/* Key facts */}
      <div className="grid gap-4 sm:grid-cols-2 mb-10">
        <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-5 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8892a0] mb-1">Voting closes</p>
          <p className="text-lg font-bold text-white">{VOTING_CLOSES}</p>
        </div>
        <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-5 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8892a0] mb-1">To vote</p>
          <p className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
            <LogIn className="h-4 w-4 text-[#66fcf1]" aria-hidden />
            Log in to your account
          </p>
          <p className="text-xs text-[#8892a0] mt-1">Logging in prevents double votes.</p>
        </div>
      </div>

      <p className="text-center text-sm text-[#c5c6c7] font-bold mb-10">
        Deciding who to vote for? Check the{" "}
        <Link href="/stats" className="text-[#66fcf1] hover:underline inline-flex items-center gap-1">
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          All-Time Leaderboards
        </Link>{" "}
        on the Stats page first.
      </p>

      {/* Categories — each one opens straight to that category's vote page. */}
      <div>
        <h2
          className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#66fcf1] mb-5 text-center"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          Categories
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AWARD_CATEGORIES.map((category) => (
            <Link
              key={category.title}
              href={`/player-awards-2026/vote/${categorySlug(category.title)}`}
              className="group bg-[#1f2833]/40 border border-[#3d4855] rounded-lg p-5 flex items-start gap-3 transition hover:border-[#66fcf1] hover:bg-[#1f2833]/70"
            >
              <CategoryIcon icon={category.icon} color={category.color} className="h-6 w-6 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[#c5c6c7] font-semibold group-hover:text-white">{category.title}</p>
                {category.blurb && <p className="text-sm text-[#8892a0] mt-1">{category.blurb}</p>}
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 mt-1 text-[#8892a0] opacity-0 transition group-hover:opacity-100"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
