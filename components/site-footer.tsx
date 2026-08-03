import Link from "next/link"

// One quiet line at the foot of every main page. The acknowledgements page it
// points at is where the project says whose shoulders it stands on -- the
// footer itself stays out of the way.
export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-16 border-t border-[#2a3441]">
      <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-[#6b7a8a] sm:flex-row">
        <p>Soracle — a fan-made JK2 CTF community project. Not affiliated with Raven Software, Activision or LucasArts.</p>
        <Link href="/acknowledgements" className="shrink-0 text-[#66fcf1]/70 transition-colors hover:text-[#66fcf1]">
          Acknowledgements
        </Link>
      </div>
    </footer>
  )
}
