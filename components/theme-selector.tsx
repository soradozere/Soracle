"use client"

import { Paintbrush } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { themes, type ThemeName } from "@/lib/themes"

interface ThemeSelectorProps {
  currentTheme: ThemeName
  onThemeChange: (theme: ThemeName) => void
}

export function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="p-2 rounded-md bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855] transition-all"
        title="Change theme"
      >
        <Paintbrush className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 bg-[#1f2833] border-[#3d4855]">
        <DropdownMenuRadioGroup value={currentTheme} onValueChange={(value) => onThemeChange(value as ThemeName)}>
          {Object.values(themes).map((theme) => (
            <DropdownMenuRadioItem key={theme.name} value={theme.name} className="text-[#c5c6c7] cursor-pointer">
              {theme.displayName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
