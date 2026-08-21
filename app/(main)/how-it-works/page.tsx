import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "How It Works — JK2 Capture the Flag",
  description:
    "How ratings, the 6v6 team balancer, and auto-calibration work together for a competitive JK2 CTF queue.",
}

// Fully static explainer — the only main page with no client JS of its own.
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
              your tier moves based on your results — see Auto-Calibration below.
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
                  <p className="text-sm text-text-dim mt-1">Same idea for the three weakest, so one team doesn&apos;t get a much lower floor.</p>
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
            <h3 className="text-xl font-bold text-text-bright mb-3">Auto-Calibration: How You Climb</h3>
            <p className="leading-relaxed mb-4">
              Your tier is not set-and-forget. After every logged match, the system checks all 12 players in it:
              your actual win rate versus what your tier predicted. Every match records the tiers both teams had
              when it was played, so it knows what was expected of you — win roughly your team&apos;s share of
              games. Consistently beat that expectation and you rank up. Consistently fall short and you rank down.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Only games at your current tier count</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Get moved — by the system or an admin — and your record starts fresh. You need at least 10
                    games at the new tier before you can move again.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Only your last 15 games count</strong>
                  <p className="text-sm text-text-dim mt-1">It measures current form, not your entire history.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">The gap has to be real</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Roughly a 7-3 stretch when 5-5 was expected. One lucky night moves nobody.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">One tier at a time</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Moves are ±1 per evaluation, anywhere from tier 1 to tier 10. A genuinely mis-ranked player gets
                    there in hops, re-proving themselves at each level.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Every move is public</strong>
                  <p className="text-sm text-text-dim mt-1">
                    Auto-moves show up in the tier changelog on the Stats page, marked AUTO. Nothing happens
                    silently.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary font-mono font-bold">•</span>
                <div>
                  <strong className="text-text-bright">Admins still have the final say</strong>
                  <p className="text-sm text-text-dim mt-1">
                    An admin can change any tier by hand at any time. A hand-set tier stands until fresh games
                    prove it wrong.
                  </p>
                </div>
              </li>
            </ul>
            <p className="leading-relaxed mt-4">
              To climb: play games, and win more than your tier says you should. That&apos;s the whole system.
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
