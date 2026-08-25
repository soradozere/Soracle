"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { listPlayersWithRoles, setPlayerRole, type PlayerRoleRow } from "@/app/admin/roles-actions"

const ROLE_LABEL: Record<PlayerRoleRow["role"], string> = {
  full_admin: "Full Admin",
  captain: "Captains",
  player: "Player",
}

export function AdminRoles() {
  const [rows, setRows] = useState<PlayerRoleRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    const result = await listPlayersWithRoles()
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
    } else {
      setRows(result.data)
    }
    setIsLoading(false)
  }

  async function changeRole(row: PlayerRoleRow, role: PlayerRoleRow["role"]) {
    setSavingId(row.id)
    const result = await setPlayerRole(row.id, role)
    setSavingId(null)
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, role } : r)))
    toast({
      title: "Success",
      description: role === "player" ? `${row.name} is back to a normal player.` : `${row.name} is now ${ROLE_LABEL[role]}.`,
    })
  }

  const promoted = rows.filter((r) => r.role !== "player")
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return rows.filter((r) => r.role === "player" && r.name.toLowerCase().includes(q)).slice(0, 8)
  }, [rows, query])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading roles…</p>
  }

  return (
    <div className="space-y-6">
      {promoted.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="w-[180px]">Role</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {promoted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <Select
                      value={row.role}
                      disabled={savingId === row.id}
                      onValueChange={(value) => changeRole(row, value as PlayerRoleRow["role"])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_admin">Full Admin</SelectItem>
                        <SelectItem value="captain">Captains</SelectItem>
                        <SelectItem value="player">Player</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savingId === row.id}
                      onClick={() => changeRole(row, "player")}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No player has Full Admin or Captains access yet.</p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Promote a player</p>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the roster by name…"
        />
        {candidates.length > 0 && (
          <div className="border rounded-lg divide-y">
            {candidates.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm">{row.name}</span>
                {row.hasLogin ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savingId === row.id}
                      onClick={() => {
                        setQuery("")
                        void changeRole(row, "captain")
                      }}
                    >
                      Make Captains
                    </Button>
                    <Button
                      size="sm"
                      disabled={savingId === row.id}
                      onClick={() => {
                        setQuery("")
                        void changeRole(row, "full_admin")
                      }}
                    >
                      Make Full Admin
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No login yet — generate one in Player Management first
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
