"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Save, X, Download, KeyRound, Copy, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { CSVUpload } from "@/components/csv-upload"

interface Player {
  id: string
  name: string
  tier_value: number
  mic: boolean
  capper_rating: number
  chase_rating: number
  camp_rating: number
  cleaner_rating: number
  support_rating: number
  tooltip: string | null
  manually_inactive: boolean
  last_match_at: string | null
  discord_ids: string[]
}

// Discord snowflake IDs are 17-19 digit numbers; allow a little slack on either side.
const DISCORD_ID_PATTERN = /^\d{15,21}$/

// Parse a free-form string of Discord IDs (separated by commas, semicolons, or
// whitespace) into a deduped list of valid IDs plus any tokens that aren't valid.
function parseDiscordIds(raw: string): { ids: string[]; invalid: string[] } {
  const tokens = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)
  const ids: string[] = []
  const invalid: string[] = []
  for (const token of tokens) {
    if (!DISCORD_ID_PATTERN.test(token)) {
      invalid.push(token)
    } else if (!ids.includes(token)) {
      ids.push(token)
    }
  }
  return { ids, invalid }
}

export function PlayerManagementTable() {
  const [players, setPlayers] = useState<Player[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPlayer, setEditingPlayer] = useState<Partial<Player>>({})
  // Raw text the admin types for Discord IDs; parsed into discord_ids on save.
  const [discordInput, setDiscordInput] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  // Player-login password generation: which player the "new password" dialog
  // is showing for, the plaintext (shown once, never re-fetchable), and
  // whether it's mid-request.
  const [passwordFor, setPasswordFor] = useState<Player | null>(null)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
  const [generatingPassword, setGeneratingPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  const supabase = createClient()

  async function generatePasswordFor(player: Player) {
    setPasswordFor(player)
    setGeneratedPassword(null)
    setCopied(false)
    setGeneratingPassword(true)
    try {
      const res = await fetch("/api/player-auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: player.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to generate password", variant: "destructive" })
        setPasswordFor(null)
        return
      }
      setGeneratedPassword(data.password)
    } catch {
      toast({ title: "Error", description: "Failed to generate password", variant: "destructive" })
      setPasswordFor(null)
    } finally {
      setGeneratingPassword(false)
    }
  }

  useEffect(() => {
    fetchPlayers()
  }, [])

  async function fetchPlayers() {
    setIsLoading(true)
    const { data, error } = await supabase.from("players").select("*").order("name")

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch players",
        variant: "destructive",
      })
    } else {
      setPlayers(data || [])
    }
    setIsLoading(false)
  }

  function startEdit(player: Player) {
    setEditingId(player.id)
    setEditingPlayer({ ...player })
    setDiscordInput((player.discord_ids || []).join(", "))
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingPlayer({})
    setDiscordInput("")
    setIsAdding(false)
  }

  async function saveEdit() {
    if (!editingPlayer.name?.trim()) {
      toast({
        title: "Error",
        description: "Player name is required",
        variant: "destructive",
      })
      return
    }

    const { ids: discordIds, invalid } = parseDiscordIds(discordInput)
    if (invalid.length > 0) {
      toast({
        title: "Invalid Discord ID",
        description: `These don't look like Discord IDs (17-19 digit numbers): ${invalid.join(", ")}`,
        variant: "destructive",
      })
      return
    }

    // Pre-check cross-player uniqueness for a friendly message (the DB trigger is
    // the hard guarantee). Find any other player already using one of these IDs.
    if (discordIds.length > 0) {
      const conflict = players.find(
        (p) => p.id !== editingId && (p.discord_ids || []).some((id) => discordIds.includes(id)),
      )
      if (conflict) {
        const shared = (conflict.discord_ids || []).filter((id) => discordIds.includes(id))
        toast({
          title: "Duplicate Discord ID",
          description: `Discord ID ${shared.join(", ")} is already assigned to ${conflict.name}.`,
          variant: "destructive",
        })
        return
      }
    }

    const playerData = {
      name: editingPlayer.name,
      tier_value: editingPlayer.tier_value || 0,
      mic: editingPlayer.mic || false,
      capper_rating: editingPlayer.capper_rating || 0,
      chase_rating: editingPlayer.chase_rating || 0,
      camp_rating: editingPlayer.camp_rating || 0,
      cleaner_rating: editingPlayer.cleaner_rating || 0,
      support_rating: editingPlayer.support_rating || 0,
      tooltip: editingPlayer.tooltip || null,
      manually_inactive: editingPlayer.manually_inactive || false,
      discord_ids: discordIds,
    }

    if (isAdding) {
      const { data, error } = await supabase.from("players").insert(playerData).select().single()

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        })
        return
      }

      setPlayers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      toast({
        title: "Success",
        description: "Player added successfully",
      })
    } else {
      const { error } = await supabase.from("players").update(playerData).eq("id", editingId)

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        })
        return
      }

      // Log tier change if tier was updated
      const originalPlayer = players.find(p => p.id === editingId)
      if (originalPlayer && originalPlayer.tier_value !== editingPlayer.tier_value) {
        await supabase.from("tier_changes").insert({
          player_id: editingId,
          player_name: editingPlayer.name || originalPlayer.name,
          previous_tier: originalPlayer.tier_value,
          new_tier: editingPlayer.tier_value || 0,
        })
      }

      setPlayers((prev) =>
        prev.map((p) => (p.id === editingId ? { ...p, ...playerData } : p))
      )
      toast({
        title: "Success",
        description: "Player updated successfully",
      })
    }

    cancelEdit()
  }

  async function deletePlayer(id: string) {
    if (!confirm("Are you sure you want to delete this player?")) return

    const { error } = await supabase.from("players").delete().eq("id", id)

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      })
      return
    }

    setPlayers((prev) => prev.filter((p) => p.id !== id))
    toast({
      title: "Success",
      description: "Player deleted successfully",
    })
  }

  function startAdd() {
    setIsAdding(true)
    setDiscordInput("")
    setEditingPlayer({
      name: "",
      tier_value: 0,
      mic: false,
      capper_rating: 0,
      chase_rating: 0,
      camp_rating: 0,
      cleaner_rating: 0,
      support_rating: 0,
      tooltip: "",
      manually_inactive: false,
      discord_ids: [],
    })
  }

  function exportToCSV() {
    // Create CSV header
    const headers = ["Player", "Tier rank", "Mic", "Capper skill", "Chase skill", "Camp skill", "Cleaner skill", "Support skill", "Tooltip", "Discord IDs"]

    // Create CSV rows
    const rows = players.map(player => [
      player.name,
      player.tier_value,
      player.mic ? "Yes" : "No",
      player.capper_rating,
      player.chase_rating,
      player.camp_rating,
      player.cleaner_rating,
      player.support_rating,
      player.tooltip || "",
      // Semicolon-separated so the value never contains a comma (keeps CSV parsing simple).
      (player.discord_ids || []).join(";")
    ])
    
    // Combine headers and rows
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => {
        // Escape commas and quotes in cell content
        const cellStr = String(cell)
        if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
          return `"${cellStr.replace(/"/g, '""')}"`
        }
        return cellStr
      }).join(","))
    ].join("\n")
    
    // Create download link
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `players_export_${new Date().toISOString().split("T")[0]}.csv`)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    toast({
      title: "Success",
      description: "Players exported to CSV successfully",
    })
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading players...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Total players: {players.length}</p>
        <div className="flex gap-2">
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <CSVUpload onUploadComplete={fetchPlayers} />
          <Button onClick={startAdd} disabled={isAdding || editingId !== null}>
            <Plus className="h-4 w-4 mr-2" />
            Add Player
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Name</TableHead>
              <TableHead className="w-[80px]">Tier</TableHead>
              <TableHead className="w-[80px]">Mic</TableHead>
              <TableHead className="w-[90px]">Capper</TableHead>
              <TableHead className="w-[90px]">Chase</TableHead>
              <TableHead className="w-[90px]">Camp</TableHead>
              <TableHead className="w-[90px]">Cleaner</TableHead>
              <TableHead className="w-[90px]">Support</TableHead>
              <TableHead className="w-[180px]">Tooltip</TableHead>
              <TableHead className="w-[180px]">Discord IDs</TableHead>
              <TableHead className="w-[100px]">Inactive</TableHead>
              <TableHead className="w-[110px]">Login</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isAdding && (
              <TableRow>
                <TableCell>
                  <Input
                    value={editingPlayer.name || ""}
                    onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
                    placeholder="Player name"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.tier_value || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        tier_value: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={editingPlayer.mic ? "yes" : "no"}
                    onValueChange={(value) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        mic: value === "yes",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.capper_rating || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        capper_rating: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.chase_rating || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        chase_rating: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.camp_rating || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        camp_rating: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.cleaner_rating || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        cleaner_rating: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={editingPlayer.support_rating || 0}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        support_rating: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={editingPlayer.tooltip || ""}
                    onChange={(e) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        tooltip: e.target.value,
                      })
                    }
                    placeholder="Optional"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={discordInput}
                    onChange={(e) => setDiscordInput(e.target.value)}
                    placeholder="Comma-separated IDs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={editingPlayer.manually_inactive ? "yes" : "no"}
                    onValueChange={(value) =>
                      setEditingPlayer({
                        ...editingPlayer,
                        manually_inactive: value === "yes",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">Save first</span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit}>
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {players.map((player) => {
              const isEditing = editingId === player.id
              return (
                <TableRow key={player.id}>
                  <TableCell>
                    {/* Name is intentionally NOT editable: matches store player names in
                        red_team/blue_team arrays, so renaming here would orphan a player's
                        match history + ELO. Use the rename_player() SQL helper
                        (scripts/009_add_rename_player_helper.sql) to rename safely. */}
                    <span title={isEditing ? "Name can't be edited here — use the rename_player() SQL helper" : undefined}>
                      {player.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.tier_value || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            tier_value: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.tier_value
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={editingPlayer.mic ? "yes" : "no"}
                        onValueChange={(value) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            mic: value === "yes",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : player.mic ? (
                      "Yes"
                    ) : (
                      "No"
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.capper_rating || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            capper_rating: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.capper_rating
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.chase_rating || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            chase_rating: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.chase_rating
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.camp_rating || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            camp_rating: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.camp_rating
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.cleaner_rating || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            cleaner_rating: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.cleaner_rating
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editingPlayer.support_rating || 0}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            support_rating: Number.parseInt(e.target.value) || 0,
                          })
                        }
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault() }}
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      player.support_rating
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={editingPlayer.tooltip || ""}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            tooltip: e.target.value,
                          })
                        }
                      />
                    ) : player.tooltip ? (
                      <div
                        className="max-w-[180px] whitespace-normal break-words text-sm line-clamp-3"
                        title={player.tooltip}
                      >
                        {player.tooltip}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={discordInput}
                        onChange={(e) => setDiscordInput(e.target.value)}
                        placeholder="Comma-separated IDs"
                      />
                    ) : (player.discord_ids || []).length > 0 ? (
                      // TableCell is whitespace-nowrap, so a bare `break-all` span can't
                      // wrap — multiple ids then spill across the neighbouring columns.
                      // Same block + max-width + whitespace-normal shape as the tooltip cell.
                      <div
                        className="max-w-[180px] whitespace-normal break-all text-sm"
                        title={player.discord_ids.join(", ")}
                      >
                        {player.discord_ids.join(", ")}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Select
                        value={editingPlayer.manually_inactive ? "yes" : "no"}
                        onValueChange={(value) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            manually_inactive: value === "yes",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no">No</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={player.manually_inactive ? "text-amber-500 font-medium" : ""}>
                        {player.manually_inactive ? "Yes" : "No"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => generatePasswordFor(player)}
                      disabled={editingId !== null || isAdding}
                      title="Generate or reset this player's login password"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEdit}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(player)}
                          disabled={editingId !== null || isAdding}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deletePlayer(player.id)}
                          disabled={editingId !== null || isAdding}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={passwordFor !== null} onOpenChange={(open) => !open && setPasswordFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Login password — {passwordFor?.name}</DialogTitle>
            <DialogDescription>
              Shown once. Send it to {passwordFor?.name} directly — reopening this dialog generates a new one instead.
            </DialogDescription>
          </DialogHeader>
          {generatingPassword ? (
            <p className="text-sm text-muted-foreground py-4">Generating…</p>
          ) : generatedPassword ? (
            <div className="flex items-center gap-2 py-2">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-lg tracking-wider">
                {generatedPassword}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(generatedPassword)
                  setCopied(true)
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordFor(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
