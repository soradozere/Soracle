import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "How It Works — JK2 Capture the Flag",
  description: "How the 6v6 team balancer grades all 924 possible splits: tiers, role coverage and fairness checks.",
}

// Fully static explainer — the only main page with no client JS of its own.
export default function HowItWorksPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
        <h2 className="text-2xl font-bold text-[#66fcf1] mb-6">How The Balancer Works</h2>

        <div className="space-y-6 text-[#c5c6c7]">
          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">The Challenge</h3>
            <p className="leading-relaxed">
              JK2 CTF requires both balanced overall skill AND proper role coverage. You can&apos;t just average player ratings — that ignores whether teams can actually cap, chase, or defend effectively. It also matters how skill is distributed — two evenly-totalled teams can still produce a blowout if one side has all the top players.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">How It Works</h3>
            <p className="leading-relaxed mb-4">
              The balancer evaluates every one of the 924 ways to split 12 players into two teams of six. Each split earns a penalty score for how unbalanced it is — lower is better — and the lowest-scoring split wins.
            </p>
            <p className="leading-relaxed mb-4">
              Here&apos;s what each split is graded on:
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Tier balance</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Both teams should add up to roughly the same total tier rank. This is the heaviest-weighted check.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Role coverage</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Every team needs at least one viable Capper and one viable Chaser. Missing either makes the match unplayable.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Cappers split fairly</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Capper is the most crucial and scarcest role, so the balancer spreads the best cappers across both teams rather than just matching capper totals. The two elite cappers won&apos;t end up on the same side.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Even role spread</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Beyond capping, each team should have similar total ratings in every other role (Chase, Camp, Cleaner, Support) — not just a matching overall score.
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
                    Same idea for the three weakest, so one team doesn&apos;t get a much lower floor.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">No stacked elites</strong>
                  <p className="text-sm text-text-dim mt-1">
                    One team shouldn&apos;t hoard the tier 8+ players while the other goes without.
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
                  <strong className="text-text-bright">Mic balance</strong>
                  <p className="text-sm text-text-dim mt-1">
                    A light tiebreaker that spreads mic users evenly.
                  </p>
                </div>
              </li>
            </ul>
            <p className="leading-relaxed mt-4">
              The balancer combines all of these into one score and returns the split with the lowest total penalty — plus a couple of close alternatives in case the top pick doesn&apos;t feel right.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Understanding the Two Rating Systems</h3>
            <p className="leading-relaxed">
              Tier values balance overall strength. Role ratings ensure team composition works. A tier 8 Capper and a tier 8 Chaser have similar competitive impact (same tier), but fill completely different needs on a team (different role profiles). The balancer uses tier as the primary balance metric and roles as the composition metric.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Balance Confidence</h3>
            <p className="leading-relaxed">
              Each balance option shows a confidence percentage based on the penalty score — lower penalty translates to higher confidence. You&apos;ll also see this on logged matches in the Match History tab, so you can track whether higher-confidence balances actually produce closer games.
            </p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-text-bright mb-3">Role System</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-background p-3 rounded-md border border-border">
                <span className="inline-block px-2 py-1 bg-[#62d6e8] text-background text-xs font-bold rounded mb-2">
                  CAP
                </span>
                <p className="text-sm">Capper - Flag carrier, evasion and speed specialist</p>
              </div>
              <div className="bg-background p-3 rounded-md border border-border">
                <span className="inline-block px-2 py-1 bg-[#27ae60] text-background text-xs font-bold rounded mb-2">
                  CHA
                </span>
                <p className="text-sm">Chase returner - Pursues enemy flag carrier</p>
              </div>
              <div className="bg-background p-3 rounded-md border border-border">
                <span className="inline-block px-2 py-1 bg-[#45a29e] text-background text-xs font-bold rounded mb-2">
                  CAM
                </span>
                <p className="text-sm">Camp returner - blocks off enemy capper and protects base hallways</p>
              </div>
              <div className="bg-background p-3 rounded-md border border-border">
                <span className="inline-block px-2 py-1 bg-[#9b59b6] text-background text-xs font-bold rounded mb-2">
                  BC
                </span>
                <p className="text-sm">Base Cleaner - Base control specialist</p>
              </div>
              <div className="bg-background p-3 rounded-md border border-border col-span-full">
                <span className="inline-block px-2 py-1 bg-[#f39c12] text-background text-xs font-bold rounded mb-2">
                  SUP
                </span>
                <p className="text-sm">Support - Flexible utility player</p>
              </div>
            </div>
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
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
