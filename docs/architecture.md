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

Pass `worker: true` to cut a project's stones in a module worker, so the page stays responsive while they are cut.
The worker builds the film from plain data and hands back only the finished stone and bed buffers.
A scene's picture can therefore be a module path, or `{ module, export, args }`: a function in a module that returns a picture from plain arguments.
If a worker cannot start, or the browser cannot paint on an `OffscreenCanvas`, the film is built on the page instead.
An imported image is always analysed on the page.

## Sound

`controller.onContact(listener)` hears the stones the pointer sets off as it slides, like a handful of small stones poured onto a table.
A sliding pointer sets off stones near its path, about seventy for each width of the view it covers and at most sixty a second, the first as soon as it moves, and only where there are stones.
Each contact has its kind (`touch`), the material and size in millimetres of its stone, a strength from 0 to 1 that grows with the pointer's speed, the seconds after now it is heard, and its position on the canvas.
`engine/sound.js` turns them into sound with `createStoneSound()`: each stone is heard as its own material landing on something solid, most of them softly and a few hard.
Each material's voice comes from published measurements of it: the speed of sound in it sets its pitch, its density how hard it lands, and its internal damping how long it rings.
So gold and silver ring longest and lowest, glass and the dense stones ring for a moment, and fired clay is the dullest of all.
[Sound](sound.md) gives the method, the measurements and their sources, and how to add a material.
The sounds are short and kept below the sharp range, with no hiss, and they are synthesised, with nothing recorded or downloaded.
Browsers start audio only from a click or a key, so pages keep it off until asked for and call `start()` from that click.
Contacts come only from live input; seeks, replays, and exports are silent.

## Walls of pictures

Scenes placed with `at: [x, y]` share one wall, in millimetres from its top left corner, instead of each being centred on its own.
With `worker: true`, each picture of such a wall is cut in its own worker.
The wall is drawn from the moment the first picture is ready, and the others join it as they finish; `controller.ready` resolves once all of them have.
`setView({ frame: { x, y, w } })` looks straight at part of the wall, in the wall's millimetres, instead of following the scene's camera.
A frame can also be a function, read once for every frame drawn, so a page can follow its own scroll; `requestFrame()` draws once on the next animation frame.
A picture whose config sets `rows: true` lists its stones by height, so each frame draws only the stones within reach of its view.
Pictures without it keep their own drawing order and their exact pixels.

The project page is such a wall.
`home/wall.js` sets the nocturne at the top, unchanged, and paints a second picture of the page around it from the page's measured layout: tablets and emblems become gold-framed openings, headings rest on level courses, and the material samples are medallions in the wall itself.
`home/main.js` measures the layout, has both pictures cut in workers, keeps a canvas one viewport tall (plus a margin) moving with the scroll, and cuts the wall again when a new width reflows the page.
Images imported through that studio are processed locally.
An application that loads remote image URLs still needs the server's normal cross-origin permission to read those images.

## Reproducible frames and live input

Exported frames are evaluated from explicit time, source, seed, and render settings.
Live pointer input is kept as timestamped samples, separate from film time.
Each stone answers the pointer's last 0.6 seconds as a damped spring of its own: it rises under the pointer, trails it, and rocks back into the mortar once the pointer has passed.
A resting pointer holds the plain curl, and drawing stops once the stones are still.
The mortar under a stone answers the same motion: as a stone moves off its bed, the footprint it left there, tinted and shadowed, gives way to plain lime lit by the scene and shaded by the stone above it.
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
