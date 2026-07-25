# Converting a JK2 player model to glTF

How to turn a Ghoul2 `.glm` + `.gla` pair into a `.glb` that the Soracle model viewer can load.
Run this on the machine that has JK2 installed. Output goes in `public/models/`.

Nothing on the web understands Ghoul2, so we convert offline in Blender rather than parsing
`.glm`/`.gla` in the browser. Once a model is a `.glb`, Three.js loads it with stock `GLTFLoader`
and no custom code.

**Target for the first pass:** stock Kyle, one idle animation, under 2 MB.

---

## 0. What you need

| Thing | Notes |
|---|---|
| JK2 installed | We need `assets0.pk3` from `GameData/base/` |
| Blender **4.1+** | The addon's automated tests cover 4.1 and 5.2, with spot checks on 4.5, 5.0 and 5.1. **Blender 4.5 LTS** is the safe pick. |
| [mrwonko's Blender Jedi Academy Tools](https://github.com/mrwonko/Blender-Jedi-Academy-Tools/releases) **v2.0.0** | Download `jediacademy.zip`. Don't use older releases — v2.0.0 fixes Ghoul2 properties silently failing to read/write on Blender 5.0+. |
| Any zip tool | `.pk3` files are just renamed `.zip` archives |

Install the addon: **Edit → Preferences → Add-ons → Install from disk…** → pick `jediacademy.zip` → tick it to enable.

---

## 1. Extract the assets

Copy `assets0.pk3` somewhere scratch, rename it to `assets0.zip`, unzip it.

The importer resolves texture and skeleton paths relative to a **Base Path**, so keep the folder
structure intact. You want a layout like:

```
<scratch>/GameData/Base/
  models/players/kyle/
    model.glm
    model_default.skin
    *.jpg            (the textures)
  models/players/_humanoid/
    _humanoid.gla    (the skeleton + all animation data)
    animation.cfg    (names → frame ranges)
```

Those are the only files needed — not the whole pk3. Both the model *and* the `_humanoid` folder
are required: the `.glm` stores bone *indices*, and only the `.gla` knows what those indices mean.

> **Copyright:** JK2 assets are Raven/Activision property and were never released — only the engine
> source, GPLv2, in 2013. The converted `.glb` goes in the repo because a profile widget needs it;
> the raw extracted assets do not. Don't commit the pk3 or its contents.

---

## 2. Pick your animation range from `animation.cfg`

This is the step that decides what the model actually *does*, and it's the one worth slowing down for.

`_humanoid.gla` is a single continuous timeline of **20,000+ frames** containing every animation in
the game. `animation.cfg` is the index that carves it into named clips. Each line is:

```
ANIM_NAME    firstFrame    numFrames    loopFrames    fps
```

- **firstFrame** — where the clip starts in the big timeline (this is what the importer calls "Start Frame", and it's zero-based)
- **numFrames** — how many frames long it is
- **loopFrames** — the loop point
- **fps** — playback rate. **A negative value means the animation plays backwards.**

Open `animation.cfg` in a text editor and find your clip. Write down its `firstFrame`, `numFrames`
and `fps`; you'll type the first two into the importer.

**Do not import the whole file.** 20,000+ frames will crawl or fall over.

### Pick an IDLE, not a STAND

This one is a trap, and we walked straight into it on the first conversion.

The bare `BOTH_STAND1`…`BOTH_STAND8` entries are **1–2 frame static poses** — the stance the engine
snaps to, not something that moves. Exporting `BOTH_STAND1` gives you a perfectly correct `.glb`
containing a 0.04-second animation, which on screen is a statue.

The animation that actually breathes is the `IDLE` variant that follows it. Verified from JK2's own
`animation.cfg`:

| Animation | firstFrame | numFrames | fps | Length |
|---|---|---|---|---|
| `BOTH_STAND1` | 12257 | **2** | 20 | 0.1 s — a pose |
| **`BOTH_STAND1IDLE1`** | **12259** | **150** | 20 | **7.5 s — use this** |
| `BOTH_STAND2IDLE1` | 12448 | 151 | 20 | 7.6 s |
| `BOTH_STAND2IDLE2` | 12599 | 75 | 20 | 3.8 s |
| `BOTH_STAND5IDLE1` | 12686 | 150 | 20 | 7.5 s |
| `BOTH_GESTURE1` | 7330 | 130 | 20 | 6.5 s |
| `BOTH_TALKGESTURE1` | 14745 | 61 | 20 | 3.1 s |

**Avoid clips with a negative `fps`** (e.g. `BOTH_STAND2TO1` at `-15`). Those are the same frames as
another animation played backwards; the importer reads frames forwards, so you'd get the reverse of
what you expect. Where a negative-fps clip is the one you want, import its forward twin and reverse
it in Blender.

To find your own candidates — anything longer than ~20 frames that plays forwards:

```bash
awk '$3 > 20 && $5 > 0 {printf "%-26s start=%-7s frames=%-5s fps=%s\n", $1,$2,$3,$5}' animation.cfg
```

---

## 3. Import into Blender

**File → Import → Ghoul 2 model (.glm)** and select `models/players/kyle/model.glm`.

Set these in the import options panel:

| Option | Value |
|---|---|
| **Base Path** | your `<scratch>/GameData/Base/` folder |
| **Skin** | `default` (matches `model_default.skin`) |
| **Skeleton Changes** | `Jedi Academy _humanoid` — gives a cleaner, animation-friendly hierarchy |
| **Animations** | `Range` |
| **Start Frame** | `firstFrame` from `animation.cfg` |
| **Number of Frames** | `numFrames` from `animation.cfg` |
| **Scale** | leave default |

Scale genuinely doesn't matter here — the viewer normalises every model to a fixed height on load,
so a Quake-units Kyle and a 2-metre Kyle render identically.

If the model imports untextured or with corrupted texture paths, tick **Guess Textures** and
re-import; that option exists specifically for `.glm` files with mangled paths.

> **JK2 vs JA caveat:** this addon is built for Jedi *Academy*. JK2's skeleton has 72 bones and JA's
> has more (JA's `ltail`/`rtail` have no JK2 equivalent). The `Jedi Academy _humanoid` skeleton-changes
> option assumes JA's hierarchy. If the import errors or the rig looks wrong, re-import with
> **Skeleton Changes: none** — the animation still works, the bone tree is just messier.

### Check before exporting

- Scrub the timeline — Kyle should idle, not T-pose or explode
- Switch the viewport to **Material Preview** — textures should be present, not magenta or flat white
- Check the armature has roughly **72 bones**

---

## 3.5 Delete the LODs, tags and caps

**Do this before exporting.** The importer brings in *everything* the `.glm` contains, and most of it
is not meant to be drawn. On the first Kyle conversion that meant 328 meshes and **589 draw calls per
frame**, against 7 for a normal glTF model — an 84× overdraw for zero visual gain. Triangle count
isn't the problem (6,297 is tiny); the number of separate meshes is.

Here's what's actually in a converted Kyle, measured:

| Group | Meshes | Triangles | Keep? |
|---|---|---|---|
| LOD 0 — visible surfaces | 19 | 2,762 | **yes** |
| LOD 0 — tag surfaces (`*` prefix) | 46 | 46 | no — but see §7 |
| LOD 0 — cap surfaces (`_off` suffix) | 17 | 140 | no |
| LOD 1 / 2 / 3 (all three) | 246 | 3,349 | no |
| **Total imported** | **328** | **6,297** | |

### The trap: surfaces are a hierarchy, not a flat list

Before deleting anything by name, understand how the importer lays a model out. The four LODs arrive
as sibling roots — `model_root_0` … `model_root_3` — and **within each LOD the surfaces are parented
to each other**, mirroring the Ghoul2 surface hierarchy in the `.glm`:

```
model_root_0
└── stupidtriangle_off_0        ← the hierarchy ROOT. Everything hangs off this.
    └── hips_0
        ├── hips_cap_l_leg_off_0    ← leaf, safe to delete
        ├── hips_cap_r_leg_off_0    ← leaf, safe to delete
        ├── l_leg_0
        │   └── l_leg_cap_hips_off_0
        ├── r_leg_0
        └── torso_0
            ├── head_0
            │   └── head_cap_torso_off_0
            └── l_arm_0 …
```

`stupidtriangle_off_0` matches an "ends in `_off`" rule, but deleting it **orphans the entire model** —
the children lose their parent, fall back to their local transforms, and the mesh explodes across the
viewport. Same hazard for any surface with children.

So the rule is not "delete everything named `_off`". It's:

1. **Delete `model_root_1`, `model_root_2`, `model_root_3` entirely** (right-click → **Delete
   Hierarchy**, not plain Delete — plain Delete leaves the children behind). That's 246 of the 328
   meshes gone. Leave `skeleton_root` alone.
2. **Delete tag and cap surfaces only where they are leaves** — no child objects. Caps and tags are
   always leaves, so this catches all of them and can never break the chain. Deleting all 46 tags is
   safe even though we intend to attach sabers and flags later — see below.
3. **Keep `stupidtriangle_off_0` as a node, but empty its geometry.** It has to stay to hold the
   hierarchy together; it doesn't have to draw anything.

That leaves **19 surfaces with geometry** — matching the 19 non-`_off` entries in
`model_default.skin` exactly. Good way to check your work: count the skin-file lines that don't end
in `_off`.

### Just run this

Blender's **Scripting** tab, paste, Run. It does all three steps in the safe order:

```python
import bpy

# 1. LODs 1-3: delete children before parents so nothing is orphaned mid-way.
for name in ("model_root_1", "model_root_2", "model_root_3"):
    root = bpy.data.objects.get(name)
    if root:
        for ob in reversed([root, *root.children_recursive]):
            bpy.data.objects.remove(ob, do_unlink=True)

root = bpy.data.objects["model_root_0"]

# 2. Tags and caps, LEAVES ONLY — never delete something other surfaces hang off.
for ob in list(root.children_recursive):
    if not ob.children and (ob.name.startswith("*") or "_off" in ob.name):
        bpy.data.objects.remove(ob, do_unlink=True)

# 3. Keep the hierarchy root as a node, but bin its geometry.
for ob in root.children_recursive:
    if "stupidtriangle" in ob.name and ob.type == "MESH":
        ob.data.clear_geometry()

kept = [o for o in root.children_recursive if o.type == "MESH" and len(o.data.polygons)]
print(f"{len(kept)} meshes with geometry left")
```

Expect `19 meshes with geometry left`. Scrub the timeline afterwards — the model should still be
intact and animating, not scattered.

### Attachments: use bones, not tag surfaces

Ghoul2 attaches weapons and effects to **tag surfaces** — the 46 `*`-prefixed objects the cleanup
deletes (`*r_hand`, `*back`, `*hip_bl`, `*chestg`, …). It's tempting to keep them for a lightsaber or
a flag. **Don't — you don't need them.**

The exported skeleton carries the attachment points already, as named bones. From Kyle's 72 joints:

| Want to attach | Bone to use |
|---|---|
| Lightsaber / blaster in hand | `rhand` (or `lhand`) |
| Holstered saber | `rhang_tag_bone` — JK2's own weapon-hang bone |
| Flag on the back | `thoracic` with an offset |
| Trip mines on the hip | `pelvis` or `lower_lumbar` with an offset |
| Companion model (e.g. a sentry) | none — it's a separate object in the scene |

In Three.js, anything added as a child of a `Bone` inherits its animated world transform for free, so
a saber parented to `rhand` follows the idle without any extra code. Tag surfaces would be more
faithful to how the engine does it, but a Ghoul2 tag encodes its orientation in the *vertex positions*
of its triangle, so using one means reading geometry back and reconstructing a matrix — real work for
no visible gain.

Keep the export clean. Attach to bones.

## 4. Export as `.glb`

**File → Export → glTF 2.0 (.glb/.gltf)**

| Setting | Value |
|---|---|
| **Format** | `glTF Binary (.glb)` — one self-contained file |
| **Include → Selected Objects** | off (export everything) |
| **Data → Mesh → Apply Modifiers** | on |
| **Data → Material** | `Export` |
| **Data → Shape Keys** | off (JK2 models don't use them) |
| **Animation** | **on** — this is the one people forget |
| **Animation → Skinning** | **on** — without it you get a frozen mesh with no rig |
| **Animation → Limit to Playback Range** | on |
| **Compression (Draco)** | **off** — see below |

Leave Draco compression off. Three.js can read Draco, but only with a separate `DRACOLoader` plus a
decoder file fetched at runtime — extra moving parts for a model that should already be small. If we
blow the size budget we'll revisit it.

---

## 5. Acceptance gate

Check all four **before** sending it over — this is cheaper than finding out after it's wired in:

1. **Size under 2 MB.** Bigger means we look at texture resolution first, geometry second.
2. **It opens in an external glTF viewer** — [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/) is the standard one. Drag the `.glb` in.
3. **The skeleton survived** — the model is posed and deformed, not a rigid statue. Expect **72 joints**.
4. **The animation loops**, doesn't snap or jitter at the loop point, and is **visibly moving** — if it looks frozen, you exported a `BOTH_STAND*` pose instead of an `IDLE` (see §2).
5. **Roughly 19 meshes, not 300+.** If the viewer reports hundreds, the LODs/tags/caps are still in (see §3.5).

If it looks right there, it will look right in Soracle — same loader, same format.

### Send me

- the `.glb`
- the `animation.cfg` line(s) you used
- which skin you picked

I'll drop it into `public/models/`, add it to the switcher at `/lab/model`, and report the real
numbers — file size, load time, frame rate on mobile.

---

## 6. Multiple animations in one `.glb`

One clip proves the pipeline; the finished widget wants a few, so profiles don't all look identical.

Because the `.gla` is one long timeline, **each animation is just a different frame range of the same
file**. You want them all in a single `.glb` as separate named clips — one mesh, one skeleton, many
animations. Exporting one `.glb` per animation also works but re-exports the geometry and textures
every time, so it costs roughly N× the bytes for N animations.

### The operator you want

**File → Import → JA Ghoul 2 Skeleton (.gla)**, with **Animations: Range**.

The name says "Skeleton", which is why it's easy to miss — it's the same operator that imports
animation, and it's the one to use for every range *after* the first. It will **not** give you a
second model or a second armature: the importer looks for an existing object called `skeleton_root`
and reuses it if it finds one.

### The trap: stash before every import

Each import writes its keyframes at **frames 0 to N-1** — not at the animation's real offset in the
`.gla` — and it writes them into whatever Action is currently active on the armature.

So if you import a second range without doing anything first, it lands **on top of the first one at
identical frame numbers** and you end up with one mangled Action instead of two clean ones. This is
the step that makes the whole thing feel broken.

Between every import:

1. **Dope Sheet → Action Editor**, with the armature selected.
2. Rename the current Action to the JK2 animation name (`BOTH_STAND1IDLE1`).
3. Click **Stash**.

Stash pushes the Action onto its own NLA track *and* gives it a fake user, so it survives a save and
reload with nothing actively using it. Plain "Push Down" doesn't guarantee that.

After stashing, the armature has no active Action and the viewport drops to the bind pose — that's
expected, not a sign anything went wrong.

### The loop

```
import .glm + first range          (as in §3)
  ↓
rename Action → Stash
  ↓
File → Import → JA Ghoul 2 Skeleton (.gla), Animations: Range, next start + count
  ↓
rename Action → Stash
  ↓
… repeat …
  ↓
export .glb
```

On export, leave **Animation Mode** on its default, **Actions** — the exporter describes it as
"export actions (actives and on NLA tracks) as separate animations", which is exactly the stashed
Actions from above. Keep **Skinning** on, as in §4.

### Name the clips properly — the viewer reads them

The names carry meaning downstream. The viewer picks the clip whose name contains **`idle`** as the
looping animation, and treats **every other clip** as a one-shot that the action button plays at
random before easing back into the idle. Keep the JK2 names and that just works; call everything
`Action.001` and it won't.

### Ranges worth taking

Verified against this install's `animation.cfg` (`NAME  firstFrame  numFrames  loopFrames  fps`):

| Animation | Range | What it is |
|---|---|---|
| `BOTH_STAND1IDLE1` | `12259 150` | The current idle — relaxed, breathing |
| `BOTH_STAND2IDLE1` | `12448 151` | Alternate idle, different stance |
| `BOTH_STAND2IDLE2` | `12599 75` | Shorter alternate idle |
| `BOTH_STAND5IDLE1` | `12686 150` | Third idle variant |
| `BOTH_GESTURE1` | `7330 130` | Big pointing gesture — the best "taunt" JK2 has |
| `BOTH_TALKGESTURE1` | `14745 61` | Shorter, chattier gesture |

Note there is **no** `TAUNT`, `VICTORY`, `BOW` or `MEDITATE` in JK2's `_humanoid` — those are Jedi
Academy additions. Don't go hunting for them because an Academy tutorial mentioned them.

Only take **one** clip with `idle` in its name, or the viewer picks the first and the rest become
one-shots — harmless, but not what you meant. An idle plus `BOTH_GESTURE1` and `BOTH_TALKGESTURE1` is
a good first set.

### The easier way: one animation per file, merged afterwards

Everything above works, and the stashing dance is genuinely fiddly. If it's fighting you, don't do it
— export **one animation per `.glb`**, which Blender does with no ceremony at all, and merge them:

```bash
node scripts/glb-merge-anims.mjs idle.glb --name idle gesture.glb --name gesture --out kyle.glb
```

`--name` sets the clip name, which is what the viewer keys off: the one matching `idle` becomes the
loop, the rest become one-shots for the action button. Worth passing, because Blender names every
export `skeleton_rootAction` regardless of what's in it.

Channels are retargeted **by node name**, so the exports don't have to agree on node ordering — and
Blender's doesn't between runs. Anything pointing at a node the base file hasn't got is dropped with
a warning rather than quietly producing a file that animates nothing.

Run the merge **before** §7, since the bolt bake wants a fresh export and this produces one.

---

## 7. Bake the bolt points back in

**Run this after every export.** One command, no Blender.

```bash
node scripts/glm-bolts.mjs <model.glm> <_humanoid.gla> <exported.glb> --out public/models/kyle.glb
```

Props — sabers, trip mines, flags — don't hang off bones. Ghoul2 hangs them off **bolts**: the
three-vertex `*` surfaces you deleted back in §3.5. Each one's triangle encodes a position *and* an
orientation, which is why a saber sits in the fist at the right angle on every model in the game
without anyone hand-tuning an offset per character.

Deleting them for the export was still right — as *drawn* surfaces they're 46 wasted draw calls. This
step recovers them as empty nodes, which cost nothing to render, parented to the bone that drives
them. The script reads the tags from the original `.glm`, resolves each one's bone through the
`.gla`, and converts the triangle into a local transform using the `.glb`'s own inverse bind matrix,
so the result is correct no matter what scale the Blender import used. It checks that: if the `.glm`
and `.glb` disagree about scale on any axis it stops rather than writing something subtly wrong.

Expect 46 bolts on a stock player model. The ones worth knowing:

| Bolt | Bone | Used for |
|---|---|---|
| `*r_hand` | `rhang_tag_bone` | The saber. **Not** the `rhand` joint — attaching there puts the hilt in roughly the right place at entirely the wrong angle. |
| `*l_hand` | `lhand` | Off-hand props |
| `*back` | `thoracic` | The flag |
| `*hip_bl` `*hip_br` `*hip_l` `*hip_r` | `pelvis` | Holstered weapons, trip mines |
| `*head_top` | `cranium` | Anything worn on the head |

The viewer looks these up by name (`bolt_r_hand` and so on) and renders nothing if a model doesn't
have them, so a `.glb` that skipped this step still loads — it just won't carry a saber. That's the
tell if a prop silently fails to appear.

Because this rewrites the `.glb`, always run it against a **fresh export**, not against a file that's
already been through it — it refuses rather than corrupting node indices.

---

## 7.5 Converting the props themselves

Props are `.md3`, not `.glm` — static geometry, no skeleton — so they skip Blender entirely:

```bash
A="/path/to/assets0"
node scripts/md3-to-gltf.mjs "$A/models/flags/r_flag.md3" public/models/props/flag-red.glb --assets "$A"
node scripts/md3-to-gltf.mjs "$A/models/flags/b_flag.md3" public/models/props/flag-blue.glb --assets "$A"
# Textures are TGA, which glTF can't embed. Convert them into a throwaway asset
# root that mirrors the real one, rather than writing into the game's folders.
T=/tmp/texroot/models/weapons2/laser_trap && mkdir -p "$T"
sips -s format jpeg "$A/models/weapons2/laser_trap/laser_trap.tga" --out "$T/laser_trap.jpg"
sips -s format jpeg "$A/models/weapons2/laser_trap/carrier.tga"    --out "$T/carrier.jpg"
node scripts/md3-to-gltf.mjs "$A/models/weapons2/laser_trap/laser_trap_w.glm" \
  public/models/props/trip-mine.glb --assets /tmp/texroot
```

**Pick the right one of the five.** A JK2 weapon folder holds a model for each
context, and only the `_w` one is what other players see you carrying:

| File | What it is |
|---|---|
| `laser_trap.md3` | **First-person view** model — a single flat charge plus a `w_hand` to hold it. Converting this is why the mine first rendered as a 2D sliver. |
| `laser_trap_1/2.md3` | LOD variants of the view model — same surfaces, fewer verts. |
| `laser_trap_pu.md3` | The **pickup** lying on the ground: three mine bodies and a carrier strap. Looks convincing in a screenshot and is still wrong. |
| **`laser_trap_w.glm`** | The **worn / world** model — what's in the hand of the player you're looking at. Ghoul2, not MD3. **This is the one.** |

I got this wrong twice: first the view model, then the pickup. The rule that
actually works is the suffix — `_w` is the worn model, `_pu` is the pickup, bare
is first-person — not how right the shape looks in isolation.

Worn weapon models exist **only** as `.glm`, which is why this converter reads
Ghoul2 as well as MD3. It takes them because they are static: `animName` of
`*default` and a single bone, so every vertex is rigidly bound and its stored
position is final. Animated player `.glm`s are weighted against a separate
`.gla` and still need the Blender route — the converter refuses those rather
than quietly emitting a bind-pose puddle.

Nothing about placement is configured anywhere. The converter keeps the MD3's own origin and axes,
§7 bakes each bolt with the orientation Ghoul2 gives it, and the viewer just parents one to the
other — so a prop lands where the game puts it, or the conversion is wrong. Resist the urge to nudge
an offset until it looks right; that hides the real fault and only holds for one model.

Three flags earn their keep:

| Flag | Why |
|---|---|
| `--assets <root>` | JK2 shader strings are full asset-root-relative paths. The flags live in `models/flags/` but name textures in `models/map_objects/mp/`, so a resolver that only looks in the MD3's own directory finds nothing — and *succeeds*, writing an untextured white model. Always pass this. |
| `--exclude <surface>` | World weapon models ship a gloved `w_hand` so the first-person view has something to hold. Leave it in and the player grows a second right hand. |
| `--texture <path>` | Last resort, when the shader name doesn't resolve to a file at all. |

Two things about JK2's texture naming, both handled but worth knowing: shaders name `.tga` while the
assets ship `.jpg` (a Quake 3 convention), and a model with more than one shader needs one material
per shader — share a material across a flag's pole and cloth and the pole gets painted with the
banner.

**Sizing is derived, never dialled in.** MD3s are in raw Quake units and a JK2 player is 64 of them
(Kyle measures 64.0 exactly), so `MD3_SCALE` in `components/md3-prop.tsx` is `TARGET_HEIGHT / 64` and
that's the whole story for every prop but one.

**The exception, and the lesson.** `r_flag.md3` is the flag that STANDS IN THE BASE: a 112.8-unit
pole and a 66.4-unit banner, so 1.76x a player. JK2 shrinks it when a player picks it up, and
*nothing in the file records that* — so reading the file alone gives a confidently wrong answer, and
the render towers over the figure. `CARRIED_FLAG_SCALE` in `components/model-viewer.tsx` exists for
exactly this, and it is the only scale factor in the pipeline.

The general rule still holds: a prop that looks wrong is a conversion bug, not a number to nudge.
The flag is the one case where the *engine* applies something the asset doesn't carry. Before adding
another such factor, get evidence the game does the same — and prefer checking against real footage
over measuring screenshots, which carry more perspective error than this kind of question can
tolerate (an in-game shot from above and behind, with the flag leaning toward the camera, inflated
every vertical estimate I took from it). `/lab/model` has bolt and scale pickers for the flag so the
two can be compared side by side against the game instead of argued from stills.

---

## 7.6 How JK2 actually mounts props — from the source

Two of these were guessed wrong for days. The answers are in JK2's own multiplayer
cgame, `code/cgame/cg_players.c` in [mvdevs/mvsdk](https://github.com/mvdevs/mvsdk),
which is the real JK2 MP source (OpenJK's `codemp/` is Jedi Academy, not this).

**A weapon mounts by the WEAPON'S own tag, not by its origin.** The worn model is
attached as a second Ghoul2 model and the engine aligns its `*weapon` tag with the
player's `*r_hand` bolt. On `laser_trap_w.glm` that tag's up runs along −Z and its
forward is rotated ~136°, so mounting by origin puts the mine in the fist backwards.
Hence `--mount weapon`, which bakes the inverse of that frame into the geometry.

This went unnoticed on the saber for a reason worth remembering: `saber_w.md3`'s
`tag_parent` sits at the origin with identity axes, so origin-mounting happened to
be correct there and proved nothing about the rule.

**The flag is not bolted to a tag at all.** `CG_PlayerFlag` positions it against the
`lower_lumbar` **bone** — `trap_G2API_AddBolt(ghoul2, 0, "lower_lumbar")`, a bone
name, not a `*` surface — and then builds the orientation from the *player's* angles
rather than inheriting the bolt's. That is why none of the 46 tag bolts lines up, and
no amount of picking between them ever would have:

```c
GetBoltMatrix(... bolt_llumbar ...);          // origin of the lower_lumbar bone
GiveMeVectorFromMatrix(&boltMatrix, POSITIVE_X, tAng);  vectoangles(tAng, tAng);
VectorCopy(cent->lerpAngles, angles);         // the PLAYER's angles

boltOrg[2] -= 12;                             // down 12
AngleVectors((0, lerpAngles[YAW], 0), 0, right, 0);
boltOrg += right * 8;                         // 8 to the player's right

angles[PITCH] = -lerpAngles[PITCH]/2 - 30;
angles[YAW]   = tAng[YAW] + 270;
AnglesToAxis(angles, axis);
ent.origin = boltOrg + 24 * axis[0];          // 24 along the flag's own forward

angles[ROLL] += 20;
AnglesToAxis(angles, ent.axis);
ent.modelScale = { 0.5, 0.5, 0.5 };           // the carried-flag scale, exactly
```

So the carried flag is: the lower-lumbar bone's position, dropped 12 and pushed 8
right and 24 forward, at a fixed −30° pitch, yaw offset 270° from the bone's own X
axis, 20° of roll, and **scale exactly 0.5**. All offsets are Quake units.

**The lesson**, having burned two rounds on it: when a prop won't line up, read the
engine rather than measuring screenshots or cycling through mount points. The game
is open source and the answer is fifteen lines long.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Model explodes / scatters after deleting surfaces | You deleted a surface that had children — almost always `stupidtriangle_off`, the hierarchy root. Undo, and delete leaves only (see §3.5). |
| Textures magenta, white or missing | **Base Path** isn't pointing at the folder that contains `models/`. Try **Guess Textures**. |
| Model imports with no skeleton | The `.gla` wasn't found. Check `models/players/_humanoid/_humanoid.gla` exists under Base Path, or set **GLA Override** to the base-relative path. |
| Import hangs or takes forever | You imported the whole animation file. Use **Animations: Range** with a real frame range. |
| Mesh exports rigid / T-posed | **Skinning** was off in the glTF export's Animation section. |
| No animation in the `.glb` at all | The **Animation** section was off, or the playback range didn't cover the imported frames. |
| Ghoul2 properties not saving, Blender 5.0+ | Addon older than v2.0.0. Update. |
| Rig looks wrong / import errors on the JK2 `.gla` | Re-import with **Skeleton Changes: none** (see the JK2-vs-JA note above). |
| Saber / flag doesn't appear at all | The `.glb` has no bolt nodes — §7 wasn't run, or the model in the bucket predates it. |
| `glm-bolts.mjs` says the files disagree about axes | The `.glm` and `.glb` aren't the same model, or the export used a non-uniform scale. |
| Converted prop is plain white, conversion reported success | `--assets <root>` wasn't passed, so the shader's asset-relative texture path never resolved (§7.5). |
| Prop appears, but a spare gloved hand comes with it | World weapon models bundle a `w_hand` surface. `--exclude w_hand`. |
| Prop is attached but nothing is on screen | Check the bolt chain in the scene graph before assuming it's misplaced — it's usually mounted correctly and simply out of frame. The base-standing CTF flag at full size does this. |

---

## Reference

- [mrwonko/Blender-Jedi-Academy-Tools](https://github.com/mrwonko/Blender-Jedi-Academy-Tools) — the addon; the mature Ghoul2 implementation and the de-facto reference
- [mrwonko/ghoul2-browser-tools](https://github.com/mrwonko/ghoul2-browser-tools) — TypeScript, format documentation only. Not a loader (no vertices, triangles, UVs, weights or animation frames). Its `reference/mdx_format.h` is the useful part if we ever build a runtime parser.
- `animation.cfg` column meanings verified against `BG_ParseAnimationFile` in [OpenJK](https://github.com/JACoders/OpenJK) (`codemp/game/bg_panimate.c`)
