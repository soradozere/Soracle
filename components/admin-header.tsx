import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

// Shared glass masthead for the admin pages — the same veil/sweep recipe as the
// public site's header (components/site-header.tsx), minus the nav rail and
// theme machinery that make no sense behind the login. Keeping the two in the
// same visual family is the whole point: the admin panel previously wore
// unthemed defaults and looked like a different product.
export function AdminHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle: string
  actions?: ReactNode
}) {
  return (
    <header
      className="border-b sticky top-0 z-50"
      style={{
        borderColor: "var(--glass-hair)",
        background: `linear-gradient(180deg,
          color-mix(in srgb, var(--color-surface-elevated) calc(var(--glass-mast-veil) * 100%), transparent),
          color-mix(in srgb, var(--color-surface) calc(var(--glass-mast-veil) * 74%), transparent))`,
        backdropFilter: "blur(26px) saturate(170%)",
        WebkitBackdropFilter: "blur(26px) saturate(170%)",
        boxShadow: "inset 0 1px 0 var(--glass-spec), 0 8px 24px -18px var(--glass-shade)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(104deg,
            transparent 8%,
            color-mix(in srgb, var(--color-text-bright) 9%, transparent) 34%,
            color-mix(in srgb, var(--color-text-bright) 3%, transparent) 47%,
            transparent 62%)`,
          mixBlendMode: "overlay",
        }}
      />

      <div className="container mx-auto px-4 py-3 relative">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-3 min-w-0 hover:opacity-90 transition-opacity">
            <span
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0"
              style={{
                border: "1px solid color-mix(in srgb, var(--color-primary) 38%, transparent)",
                background: `radial-gradient(120% 120% at 30% 10%, color-mix(in srgb, var(--color-primary) 26%, transparent), transparent 70%),
                  color-mix(in srgb, var(--color-surface-elevated) 60%, transparent)`,
                boxShadow:
                  "inset 0 1px 0 var(--glass-spec), 0 0 18px -6px color-mix(in srgb, var(--color-primary) 60%, transparent)",
              }}
            >
              <Image
                src="/logo.png"
                alt="JK2 Logo"
                width={30}
                height={30}
                className="w-[30px] h-[30px] object-contain"
                style={{ filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--color-primary) 55%, transparent))" }}
              />
            </span>
            <div className="min-w-0">
              <h1
                className="text-[17px] font-bold glow-text tracking-[0.06em] leading-tight uppercase"
                style={{ fontFamily: "var(--font-orbitron)" }}
              >
                {title}
              </h1>
              <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                {subtitle}
              </p>
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-2 justify-end min-w-0 max-w-full">{actions}</div>
        </div>
      </div>
    </header>
  )
}

/** Section shell for admin content: glass panel with the standard heading row. */
export function AdminSection({
  title,
  description,
  children,
  headerRight,
}: {
  title: string
  description?: string
  children?: ReactNode
  headerRight?: ReactNode
}) {
  return (
    <section className="glass-panel p-6">
      <div className={`flex flex-wrap items-start justify-between gap-4 ${children ? "mb-5" : ""}`}>
        <div className="min-w-0 max-w-2xl">
          <h2
            className="font-mono text-lg font-semibold tracking-[0.04em]"
            style={{ color: "var(--color-text-bright)" }}
          >
            {title}
          </h2>
          {description && (
            <p className="text-sm mt-1" style={{ color: "var(--color-text-dim)" }}>
              {description}
            </p>
          )}
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  )
}
