import type { Player } from "@/lib/types"
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react"

interface RoleCoverageIndicatorProps {
  players: Player[]
}

const ROLE_LABELS = {
  Capper: "CAP",
  Chase: "CHA",
  Camp: "CAM",
  Cleaner: "BC",
  Support: "SUP",
}

export function RoleCoverageIndicator({ players }: RoleCoverageIndicatorProps) {
  const coverage = Object.keys(ROLE_LABELS).map((role) => {
    const viableCount = players.filter((p) => p.roles[role as keyof typeof p.roles] >= 4).length
    const isCritical = role === "Capper" || role === "Chase"

    return {
      role,
      count: viableCount,
      status: viableCount >= 2 ? "good" : viableCount === 1 ? "warning" : "bad",
      isCritical,
    }
  })

  const hasCriticalIssues = coverage.some((c) => c.isCritical && c.status === "bad")

  return (
    <div
      className={`bg-surface/50 backdrop-blur-md border rounded-lg p-3 mb-4 ${hasCriticalIssues ? "border-danger" : "border-border"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-bright font-bold">Role Coverage Analysis</h3>
        {hasCriticalIssues && (
          <span className="text-danger text-sm flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            Missing critical roles
          </span>
        )}
      </div>

      <div className="grid grid-cols-5 gap-2">
        {coverage.map(({ role, count, status, isCritical }) => (
          <div
            key={role}
            className={`p-2 rounded-lg border backdrop-blur-sm ${
              status === "good"
                ? "bg-success/10 border-success/30"
                : status === "warning"
                  ? "bg-warning/10 border-warning/30"
                  : "bg-danger/10 border-danger/30"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-text-bright">
                {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}
              </span>
              {status === "good" ? (
                <CheckCircle className="w-4 h-4 text-success" />
              ) : status === "warning" ? (
                <AlertTriangle className="w-4 h-4 text-warning" />
              ) : (
                <XCircle className="w-4 h-4 text-danger" />
              )}
            </div>
            <div className="text-xl font-bold font-mono text-text-bright">{count}</div>
            <div className="text-xs text-text-dim mt-1">
              {isCritical && <span className="text-warning">Critical</span>}
              {!isCritical && "viable"}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
