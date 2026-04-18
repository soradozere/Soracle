import type { Player } from "./types"

const CSV_URL =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Jk2%20Balancer%20bot%20new%20update%20-%20PrivateData%20%283%29-xjNv4nyuqusZIH9EAlJS7UY52YP9hR.csv"

export async function fetchPlayers(): Promise<Player[]> {
  try {
    const response = await fetch(CSV_URL)
    const text = await response.text()

    const lines = text.split("\n").slice(1) // Skip header

    return lines
      .map((line) => {
        const parts = line.split(",")
        if (parts.length < 8 || !parts[0]?.trim()) return null

        const [name, tier, mic, cap, cha, cam, cle, sup, tooltip] = parts

        return {
          name: name.trim(),
          tierValue: Number(tier) || 0,
          mic: mic?.trim().toLowerCase() === "yes",
          roles: {
            Capper: Number(cap) || 0,
            Chase: Number(cha) || 0,
            Camp: Number(cam) || 0,
            Cleaner: Number(cle) || 0,
            Support: Number(sup) || 0,
          },
          tooltip: tooltip?.trim() || undefined,
        }
      })
      .filter((p): p is Player => p !== null)
  } catch (error) {
    console.error("Failed to fetch players:", error)
    return []
  }
}
