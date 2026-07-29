# 3D models

Assets served to the model viewer (`components/model-viewer.tsx`, workbench at `/lab/model`).

## fox.glb

Khronos glTF reference model, used as scaffolding to prove the rendering pipeline
before any JK2 asset exists. Three animation clips: Survey, Walk, Run.

Source: [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox)

Attribution (required by the licences):

- Model — PixelMannen, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Rigging & animation — tomkranis, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- glTF conversion — @AsoboStudio and @scurest, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

If this model ever appears on a public-facing page rather than the unlisted lab,
that CC BY attribution needs to be visible in the UI. It can be deleted outright
once the JK2 models take over.

## JK2 player models

Not added yet — see `docs/jk2-model-conversion.md` for the Blender pipeline.

JK2 assets are Raven/Activision copyright and were never released (only the engine
source, GPLv2, in 2013). Keep this directory to the minimum needed to render a
profile widget, and don't add a bulk download path for raw game assets.
