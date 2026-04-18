import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function importPlayers() {
  console.log("[v0] Fetching CSV from URL...")

  const csvUrl =
    "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Jk2%20Balancer%20bot%20new%20update%20-%20NEW-PDSUyhnOtFIXEYElbFQMTXldYJWe7Z.csv"

  const response = await fetch(csvUrl)
  const csvText = await response.text()

  console.log("[v0] Parsing CSV data...")

  // Parse CSV
  const lines = csvText.trim().split("\n")
  const headers = lines[0].split(",").map((h) => h.trim())

  console.log("[v0] Headers:", headers)
  console.log("[v0] Total rows:", lines.length - 1)

  const players = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim())

    if (values.length < 9 || !values[0]) {
      console.log(`[v0] Skipping invalid row ${i}:`, values)
      continue
    }

    const player = {
      name: values[0],
      tier_value: Number.parseInt(values[1]) || 1,
      mic: values[2].toLowerCase() === "yes",
      capper_rating: Number.parseInt(values[3]) || 1,
      chase_rating: Number.parseInt(values[4]) || 1,
      camp_rating: Number.parseInt(values[5]) || 1,
      cleaner_rating: Number.parseInt(values[6]) || 1,
      support_rating: Number.parseInt(values[7]) || 1,
      tooltip: values[8] || "",
    }

    players.push(player)
  }

  console.log(`[v0] Parsed ${players.length} players`)
  console.log("[v0] Sample player:", players[0])

  // Clear existing players
  console.log("[v0] Clearing existing players...")
  const { error: deleteError } = await supabase
    .from("players")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000") // Delete all

  if (deleteError) {
    console.error("[v0] Error clearing players:", deleteError)
    throw deleteError
  }

  // Insert new players
  console.log("[v0] Inserting players into database...")
  const { data, error } = await supabase.from("players").insert(players).select()

  if (error) {
    console.error("[v0] Error inserting players:", error)
    throw error
  }

  console.log(`[v0] Successfully imported ${data?.length || 0} players!`)
  console.log("[v0] Sample imported player:", data?.[0])

  return data
}

// Run the import
importPlayers()
  .then(() => {
    console.log("[v0] Import complete!")
  })
  .catch((error) => {
    console.error("[v0] Import failed:", error)
  })
