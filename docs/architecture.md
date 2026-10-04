# Architecture

mosAIc uses one rendering pipeline for authored scenes, imported images, the browser studio, and command-line exports.
The agent skill directs that pipeline through files and commands.
It does not contain an independently maintained renderer.

## From picture to stone

An authored scene exports its panel configuration, named regions, and drawing function.
`engine/picture.js` turns that scene into color and region rasters.
For an imported image, `engine/image.js` performs bounded image analysis and produces the same picture representation.
Regions describe material, stone size, palette, and how courses follow the picture.

`engine/tessellate.js` uses region boundaries to construct an andamento field, lays courses through that field, and cuts stones along them.
The distance transform in `engine/util.js` supplies nearest-boundary distances and coordinates.
The resulting geometry represents individual stones with thickness and bevels, not colored squares painted over an image.

`engine/timeline.js` places scene layers on an explicit clock and evaluates camera, light, entry, and exit states at a requested time.
`engine/renderer.js` draws stone materials, mortar, shadows, depth of field, sampled motion blur, and tone mapping.
The studio and exports both use this renderer.

## Browser controller

`engine/runtime.js` exposes `createMosaic(canvas, options)`.
Choose either a project URL or an image source and pass the target width, height, and temporal sample count.
The returned controller owns its graphics resources and must be disposed when its canvas is removed.

```js
import { createMosaic } from './engine/runtime.js';

const canvas = document.querySelector('canvas');
const mosaic = await createMosaic(canvas, {
  project: new URL('./examples/nocturne.json', import.meta.url).href,
  width: 1280,
  height: 720,
  samples: 1,
  interactive: true,
});
mosaic.seek(2);

function move(event) {
  const bounds = canvas.getBoundingClientRect();
  mosaic.setPointer({
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
    active: true,
  });
}
function leave() { mosaic.setPointer({ active: false }); }
canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerleave', leave);

function dispose() {
  canvas.removeEventListener('pointermove', move);
  canvas.removeEventListener('pointerleave', leave);
  mosaic.dispose();
}
// Call dispose() when your application removes or replaces this artwork.
```

The controller also supports `setView`, `resize`, `play`, `pause`, `exportPNG`, and pointer recording.
`site/app.js` connects this API to import controls, pointer and keyboard input, reduced-motion preferences, and PNG saving.
Images imported through that studio are processed locally.
An application that loads remote image URLs still needs the server's normal cross-origin permission to read those images.

## Reproducible frames and live input

Exported frames are evaluated from explicit time, source, seed, and render settings.
Live pointer easing is separate state used for interactive preview.
`seek(time)` pauses live playback and clears unrecorded pointer input.
An explicit pointer state or recorded trace can be passed when interaction is part of a reproducible render.
Stone rendering and shadow rendering use the same movement transform.

Repeated renders can be compared exactly within a fixed browser and graphics environment.
Different drivers can differ in rasterization and floating-point rounding, so a matching source hash is not a claim of universal pixel identity.

## Tools and skill

`tools/cli.mjs` exposes `init`, `inspect`, `preview`, `still`, and `render`.
Initialization creates a project manifest and editable scene source.
Preview serves the project to a browser, while capture evaluates the same engine at explicit times.
MP4 encoding uses a separately installed FFmpeg executable.

The source skill lives in `skills/mosaic/`.
Its wrapper first checks for `assets/runtime/tools/cli.mjs` inside an installed bundle, then falls back to the checkout while developing the skill.
This lets the instructions and executable examples stay portable without absolute workstation paths.

## Distribution layout

`npm run build` generates two ignored directories:

```text
dist/
  site/
    index.html                 Root redirect to the studio
    site/                      Studio HTML, CSS, and JavaScript
    engine/                    Canonical shared engine
    examples/                  Original example source
    docs/                      Public architecture and provenance
    README.md
    LICENSE
    THIRD_PARTY_NOTICES.md
    manifest.json
  mosaic/
    SKILL.md
    scripts/
    references/
    agents/
    assets/runtime/            Engine, tools, studio, examples, tests, docs
    manifest.json
```

The runtime includes the canonical package manifest and lockfile, but no installed npm dependencies, browsers, or FFmpeg binary.
It also includes tests and public development documents so the package's development commands remain available.
Running the build from an installed runtime finds the enclosing skill source and excludes its already generated runtime to prevent recursive copying.

Each distribution manifest records its kind, package version, and every distributed file's relative destination, canonical source name, byte count, and SHA-256 digest.
Generated files use a null source name.
The manifest does not include itself, timestamps, or absolute paths.
Source bytes are read once per build so duplicated web and skill files agree exactly.
Tests compare generated files with their canonical sources, verify notice inclusion, exercise the installed wrapper, and rebuild from the copied runtime.

## Limits and verification

Keep scene layers below 65,536 stones and authored pictures within 254 named regions.
The engine rejects oversized working rasters and requires WebGL2 with the floating-point framebuffer features used by the renderer.
Image conversion approximates colors and boundaries; it does not identify semantic objects or maintain coherence across video frames.

Unit and packaging checks establish numerical behavior and distribution integrity.
They do not replace rendered inspection, pointer testing, or playback of an exported film.
The initial GPU visual check targets Chromium on macOS Apple Silicon; other platform and browser acceptance remains pending.
