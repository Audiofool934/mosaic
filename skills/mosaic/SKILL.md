---
name: mosaic
description: Create physical mosaic artwork, image conversions, animated mosaic films, or interactive mosaic websites using the bundled mosAIc engine. Use for shaped tesserae, contour-following stonework, glass, marble, and gold; not generic pixelation or continuous video stylization.
license: MIT
metadata:
  version: "0.1.0"
---

# mosAIc

Requires Node.js 20+, a WebGL2 browser, and Chromium/Playwright for capture; MP4 export also uses FFmpeg.

Make artwork from individually cut, bevelled stones with visible mortar, contour-following courses, material response, and real shadows.
The bundled engine is the visual foundation; retain its geometry and materials when adapting a composition.

Use `node <skill-directory>/scripts/mosaic.mjs` for the commands below.
Paths are relative to the current working directory, so each work can live in its own folder.
Run `--help` for the implemented command flags.

## Choose the source

For original artwork, start with `init <directory>`, then edit its `scene.js` and `project.json`.
Read [scene-authoring.md](references/scene-authoring.md) for the drawing, material, camera, and timeline contracts.
Use a clear silhouette, a controlled palette, and stone courses that explain the subject's form.
Show macro and full-frame views during iteration; a beautiful close-up does not guarantee a legible composition.

For a supplied image, run `import <image> <directory>` to make a project of it, then inspect, preview, and capture it like any other.
In a page of your own, use the `imageToPicture()` API; people can also use the browser studio's import control.
For an existing web page, start from `assets/runtime/examples/page-wall/`, which cuts a wall around the page's own blocks.
Read [image-and-web.md](references/image-and-web.md) for import options, the page wall, and website embedding.
Image conversion is a bounded colour analysis followed by contour tessellation.
It does not infer semantic objects or turn an arbitrary video into coherent animation.
Treat material choice as an artistic decision; gold is opt-in.

For a film, compose the key pictures and their camera/light/stone transitions.
Let the user's brief determine aspect, duration, pacing, and sound.
The renderer exports silent video; add licensed or user-supplied sound separately only when requested.
Do not assume one genre, franchise, aspect ratio, or duration from the example.

## Work and verify

1. Establish the requested subject, output, composition, palette, materials, and motion using the brief and reasonable defaults.
2. Run `inspect <project.json>` for the manifest, then `preview <project.json>` for the actual artwork.
3. Export a still with `still <project.json> --time 2 --width 1920 --samples 4 --out <output.png>`.
4. Inspect the rendered image, adjust the scene where needed, and use `render` only when a movie is requested.

Read [rendering.md](references/rendering.md) before capture, installation, or troubleshooting.
Preserve meaningful source files and the export receipt alongside the final artwork.
Use explicit time and seed for exports; export pointer input only through an explicit recorded trace.
The 65,535-stone limit applies per scene layer; enlarge stones or simplify distant regions if exceeded.
Keep region labels within 254 authored regions plus the empty label.

Preview and export share the engine, so do not replace it with a CSS grid or a flat image filter when a command fails.
Report the failure and repair the relevant environment or project input.
Validate the actual requested output: inspect exported stills, check movie frame count and dimensions, and verify playback when claiming a completed video.
Clean up preview servers and capture browsers started for the task.
Public hosting, messages, and paid services remain subject to the user's requested scope.
