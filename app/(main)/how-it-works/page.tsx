import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "How It Works — JK2 Capture the Flag",
  description: "How the 6v6 team balancer builds two even teams out of a twelve-player lobby, and what it grades.",
}

// Fully static explainer — the only main page with no client JS of its own.
//
// Scope: this page is about the BALANCER. The game-side material it used to
// carry — what the five roles do, and how auto-calibration moves your tier —
// moved to /ctf-101, which is the player-facing guide. Anything here should be
// answering "how did the queue build these teams", not "how do I play".
export default function HowItWorksPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
        <h2 className="text-2xl font-bold text-[#66fcf1] mb-6">How A Competitive Queue Works</h2>

        <div className="space-y-6 text-[#c5c6c7]">
          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">The Challenge</h3>
            <p className="leading-relaxed">
              JK2 CTF requires both balanced overall skill AND proper role coverage. You can&apos;t just average
              player ratings — that ignores whether teams can actually cap, chase, or defend effectively. It also
              matters how skill is distributed — two evenly-totalled teams can still produce a blowout if one side
              has all the top players.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Your Rating</h3>
            <p className="leading-relaxed">
              Every player has a tier from 1 to 10, plus a rating for each role — Capper, Chase, Camp, Cleaner,
              Support. Admins set these to start. A tier 8 Capper and a tier 8 Chaser have similar competitive
              impact (same tier) but fill completely different needs on a team (different role profiles). The
              balancer uses tier as the primary balance metric and roles as the composition metric. From there,
              your tier moves based on your results —{" "}
              <Link href="/ctf-101#climb" className="text-primary hover:underline">
                how you climb is covered in CTF 101
              </Link>
              .
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">How Teams Are Balanced</h3>
            <p className="leading-relaxed mb-4">
              The balancer evaluates every one of the 924 ways to split 12 players into two teams of six. Each
              split earns a penalty score for how unbalanced it is — lower is better — and the lowest-scoring
              split wins.
            </p>
            <p className="leading-relaxed mb-4">Here&apos;s what each split is graded on:</p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Tier balance</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Both teams should add up to roughly the same total tier rank. This is the heaviest-weighted
                    check.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Role coverage</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Every team needs at least one viable Capper and one viable Chaser. Missing either makes the
                    match unplayable.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Cappers split fairly</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Capper is the most crucial and scarcest role, so the balancer spreads the best cappers across
                    both teams rather than just matching capper totals. The two elite cappers won&apos;t end up on
                    the same side.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">The best capper and best chaser go to opposite teams</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Those are the two duels that decide most rounds, so one side shouldn&apos;t own both. Sometimes
                    the same player is the best at both, and a dual threat like that can&apos;t be split from
                    himself — so the balancer makes sure the next-best chaser and next-best capper don&apos;t both
                    land on his team either, so the other side always has an answer.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Even role spread</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Beyond capping, each team should have similar total ratings in every other role (Chase, Camp,
                    Cleaner, Support) — not just a matching overall score.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Top-3 vs Top-3</strong>
                  <p className="text-sm text-text-dim mt-1">
                    The three strongest players on each team should be close in combined strength.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Bottom-3 vs Bottom-3</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Same idea for the three weakest, so one team doesn&apos;t get a much lower floor — and the gap
                    between each team&apos;s single weakest player is weighted extra, because a tier 3 drags a team
                    down more than the flat one-point difference to a tier 4 suggests.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">The middle of the roster</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Set each team&apos;s single best and single worst player aside, and the four in between should
                    still be even. A star on one side and a very weak player on the other can otherwise cancel out
                    in the totals while the players who actually decide the game are lopsided.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">No stacked elites</strong>
                  <p className="text-sm text-text-dim mt-1">
                    One team shouldn&apos;t hoard the tier 8+ players while the other goes without. This one is a
                    hard rule rather than a preference — the balancer won&apos;t hand you a top-heavy team just
                    because the roles happen to line up nicely.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Don&apos;t stack the #1</strong>
                  <p className="text-sm text-text-dim mt-1">
                    The single best player shouldn&apos;t be surrounded by too many other top-tier teammates.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Weakest players spread out</strong>
                  <p className="text-sm text-text-dim mt-1">
                    The bottom of the lobby gets split across both sides, the way a manual draft&apos;s last picks
                    naturally would, instead of pooling on one team to pay for a stack on the other.
                  </p>
                </div>
              </li>
            </ul>
            <p className="leading-relaxed mt-4">
              The balancer combines all of these into one score and returns the split with the lowest total
              penalty — plus a couple of close alternatives in case the top pick doesn&apos;t feel right. Mic counts
              are shown on each team for convenience, but they no longer affect the score. The weaker team on
              paper gets Blue base.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Balance Confidence</h3>
            <p className="leading-relaxed">
              Each balance option shows a confidence percentage based on the penalty score — lower penalty
              translates to higher confidence. You&apos;ll also see this on logged matches in the Match History
              tab, so you can track whether higher-confidence balances actually produce closer games.
            </p>
            <p className="leading-relaxed mt-3">
              One caveat when comparing the three cards: the Off-Role option is graded on tiers alone, because
              ignoring role ratings is the whole point of it. Fewer checks means fewer ways to lose points, so it
              will almost always show a higher percentage than the other two. Read its number against other
              Off-Role splits, not against the main recommendation.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">The Roles Being Balanced</h3>
            <p className="leading-relaxed">
              Every player carries a rating in five roles — Capper, Chase, Camp, Base Cleaner and Support — and the
              checks above are mostly about spreading those across both teams.{" "}
              <Link href="/ctf-101#roles" className="text-primary hover:underline">
                CTF 101 explains what each role actually does
              </Link>
              , including which habits separate a good one from a bad one.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Pro Tips</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Hit &quot;Copy Teams&quot; to paste the lineup to Discord</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>
                  Check alternative balance options if the first balance doesn&apos;t feel right, or if you want to
                  rematch with different lineups
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Sides are randomized—use Swap Sides to change up team colours</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>No coverage on a specific role? Time to improvise and try out new positions!</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Check the Match History tab to see past results and player win rates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Watch the tier changelog on the Stats page to see who&apos;s climbing or slumping</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
