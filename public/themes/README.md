# Profile-theme background images

Image-background profile themes (see `lib/titles.ts` → `THEMES`, `background: "image"`)
draw a wallpaper from this folder behind the Player Profile page.

## Nostalgia

`nostalgia.jpg` is currently a **generated placeholder** (a steel-blue scene in the
theme's palette) so the theme renders out of the box. **Drop the real JK2 wallpaper
in over it** — same path, same filename — and the theme picks it up automatically:

    public/themes/nostalgia.jpg

Recommended: a landscape image ~1600×1000 or larger. It's drawn "cover-fit" (scaled
to fill the viewport and centre-cropped), so anything wide and dark works well. If the
file is ever missing, the renderer falls back to a matching steel-blue gradient rather
than a blank screen.

Note: the classic LucasArts Jedi Outcast wallpaper is official promotional art — fine
for a personal/fan community tool, but swap in your own art if this ever needs to be
distributed more widely.
