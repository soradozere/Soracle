/**
 * JKA's `_humanoid` skeleton, by bone index — 53 bones against JK2's 72.
 *
 * A JKA player model's `.glm` declares the same `models/players/_humanoid/
 * _humanoid` anim path as every JK2 model, but its bone REFS index into this
 * shorter, differently-ordered list, not JK2's — reading them against JK2's
 * own `_humanoid.gla` (which resolves to the same path and would silently
 * "work") hands back all the wrong names past the first ~11 bones, where the
 * two skeletons start to diverge.
 *
 * Shared between scripts/glm-graft.mjs (the mesh) and scripts/glm-bolts.mjs
 * (the tags) for the same reason jk2-shaders.mjs is shared between the graft
 * and the skins: one definition, so the two halves of the pipeline can't drift
 * apart on what a JKA bone index means.
 *
 * Transcribed from mvdevs/jk2mv's `NewToOldRemapTable` in
 * src/renderer/tr_ghoul2.cpp, the JK2MV engine's own JKA→JK2 bone remap used to
 * play JKA models on the JK2 skeleton at runtime. That table maps by index; JK2
 * and JKA agree on bone NAMES wherever both skeletons have the bone at all, so
 * matching by name (like the rest of this pipeline already does) needs only
 * the names, not the numeric table — and JKA's own source comments spell out
 * all 53 of them in order, so no JKA assets are needed to get them.
 */
const JKA_HUMANOID_BONES = [
  "model_root",
  "pelvis",
  "Motion",
  "lfemurYZ",
  "lfemurX",
  "ltibia",
  "ltalus",
  "rfemurYZ",
  "rfemurX",
  "rtibia",
  "rtalus",
  "lower_lumbar",
  "upper_lumbar",
  "thoracic",
  "cervical",
  "cranium",
  "ceyebrow",
  "jaw",
  "lblip2",
  "leye",
  "rblip2",
  "ltlip2",
  "rtlip2",
  "reye",
  "rclavical",
  "rhumerus",
  "rhumerusX",
  "rradius",
  "rradiusX",
  "rhand",
  "r_d1_j1",
  "r_d1_j2",
  "r_d2_j1",
  "r_d2_j2",
  "r_d4_j1",
  "r_d4_j2",
  "rhang_tag_bone",
  "lclavical",
  "lhumerus",
  "lhumerusX",
  "lradius",
  "lradiusX",
  "lhand",
  "l_d4_j1",
  "l_d4_j2",
  "l_d2_j1",
  "l_d2_j2",
  "l_d1_j1",
  "l_d1_j2",
  "ltail",
  "rtail",
  "lhang_tag_bone",
  "face",
]

/**
 * The three JKA bones above with no JK2 counterpart, aliased onto the nearest
 * sensible JK2 bone — the same substitutions jk2mv's own remap table makes
 * (tail bones fold onto the hip they hang off; JKA's separate left-hand tag
 * bone folds onto the hand itself, since JK2 only has a right-hand one).
 */
const JKA_BONE_ALIASES = {
  ltail: "lfemurYZ",
  rtail: "rfemurYZ",
  lhang_tag_bone: "lhand",
}

/** JKA bone index → the JK2 donor's bone name, ready to look up in its joints. */
export const JKA_HUMANOID_JOINT_NAMES = JKA_HUMANOID_BONES.map((name) => JKA_BONE_ALIASES[name] ?? name)

/** Whether a `.glm`'s own bone count matches JKA's `_humanoid`, not JK2's. */
export function isJkaHumanoidBoneCount(numBones) {
  return numBones === JKA_HUMANOID_BONES.length
}
