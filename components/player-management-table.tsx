"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Save, X, Download } from 'lucide-react'
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
}

export function PlayerManagementTable() {
  const [players, setPlayers] = useState<Player[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPlayer, setEditingPlayer] = useState<Partial<Player>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const { toast } = useToast()
  const supabase = createClient()

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
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingPlayer({})
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
    }

    if (isAdding) {
      const { error } = await supabase.from("players").insert(playerData)

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        })
        return
      }

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

      toast({
        title: "Success",
        description: "Player updated successfully",
      })
    }

    cancelEdit()
    fetchPlayers()
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

    toast({
      title: "Success",
      description: "Player deleted successfully",
    })

    fetchPlayers()
  }

  function startAdd() {
    setIsAdding(true)
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
    })
  }

  function exportToCSV() {
    // Create CSV header
    const headers = ["Player", "Tier rank", "Mic", "Capper skill", "Chase skill", "Camp skill", "Cleaner skill", "Support skill", "Tooltip"]
    
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
      player.tooltip || ""
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
        <Table>
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
              <TableHead className="w-[200px]">Tooltip</TableHead>
              <TableHead className="w-[100px]">Inactive</TableHead>
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
                    {isEditing ? (
                      <Input
                        value={editingPlayer.name || ""}
                        onChange={(e) =>
                          setEditingPlayer({
                            ...editingPlayer,
                            name: e.target.value,
                          })
                        }
                      />
                    ) : (
                      player.name
                    )}
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
                    ) : (
                      player.tooltip || "-"
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
    </div>
  )
}
