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
A region whose mode is `grid` is set instead as opus tessellatum, one square stone on each cell of a grid from its `origin`, for small lettering in the stone type of `examples/type.js`, where courses would lose the letters' shapes.
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
The slide is measured over the wall, so a still pointer over a page that scrolls is heard as the wall moves under it, while a jump of the view, as when it is cut again, is not.
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
A frame can also be a function of the film time, read once for every frame drawn, so a page can follow its own scroll, or move its view as its film plays; `requestFrame()` draws once on the next animation frame.
A picture whose config sets `rows: true` lists its stones by height, so each frame draws only the stones within reach of its view.
Pictures without it keep their own drawing order and their exact pixels.
A picture placed with `at` can flow in from the scene before it and keeps its place; the flow takes in the whole picture, since on a wall the page frames the view rather than the picture's own camera, and the pictures of such a chain are cut in one worker.
A scene set `front: true` stays in front of every stone flying past it.
Where its stones are seated the depth is cleared before they are drawn, it is shaded only by its own stones, and its mortar is laid last; where its stones have not landed yet, or have lifted off, whatever lies under them shows.
The mortar is drawn once for each pair of pictures, the newest two last, and a later pair covers an earlier one only where it has a stone or a seat, so a wall of more than two pictures keeps every picture's mortar.
`createMosaic(canvas, { loop: [from, to] })` plays on from `to` at `from` until paused.
`play({ to, rate })` plays toward a time, backward if it lies behind, `rate` times as fast, and stops there.
`setTime(t)` moves the film to a time and draws it at once, keeping live input, for a page that moves the clock itself.
`createMosaic(canvas, { lamp })` gives the page a lamp to hold over the wall: `setLamp({ x, y })` moves a cone of light, `lamp.height` millimetres above the wall, toward a point on the canvas, and `setLamp({ active: false })` puts it out.
The lamp glides and fades on its own, lights stones and mortar alike, and shines in live frames only, so exports never show it.
A flow can lift its stones on its own clock: with `rise: [from, to, mm]` the outgoing picture's stones lift off together before they fly, each a touch askew, with `arc` below 1 they fly closer to the wall, and with `settle: [from, to]` they land hovering and come down onto the wall together, so a flow played backward starts with a lift as well.
`createMosaic(canvas, { transparent: true })` draws a see-through wall, clear wherever no picture has a stone's place, for a canvas laid over the rest of a page; it has no depth of field and no colour fringes.
`setHidden(id)` takes the stones of a scene off the wall in every frame drawn, as when the same stones are being drawn on another canvas, and leaves their bed bare, the grout alone with the print of each stone pressed in it; `setHidden(id, false)` puts them back.
`fov` narrows the lens, so the camera stands back and looks straight at every part of a long, low panel, and `fringes: false` drops the lens's colour fringes.
`coat` sets the colour of the bare bed, which shows wherever no stone has been set yet, or where stones have lifted off in a flow.

The project page is such a wall.
`home/wall.js` sets the name on the first screen, in white marble with its AI inlaid in gold, in front of four scenes from `examples/landscapes.js` that flow into one another in turn: moonlit water, dunes at dusk, sweeping currents, and peaks at first light.
Each scene is drawn on a stage 1600 by 900 millimetres, scaled evenly until it covers the first screen, the way a cover image fills a frame: a narrow screen cuts its sides around the scene's focus, and there the name is set as MOS over AIC, while a wide one cuts its foot.
Below the first screen the scene runs on to a long wave, where a second picture takes over, painted from the page's measured layout: tablets and emblems become gold-framed openings, headings rest on level courses, and the material samples are medallions in the wall itself.
The page is a column of rooms, each a screen high, which the browser settles on one at a time; on a phone, a room too full for one screen is set as pages, each a screen of its own.
`home/rooms.js` makes sure a deliberate turn of the wheel always reaches the next room where a browser would snap a short scroll back, and leaves scrolling itself to the browser.
Where motion is welcome and the screen is tall enough, `home/stage.js` sets the page on a stage, which turns sideways instead of scrolling.
The first screen is page 0, and each screen under it is a page of its own, standing in place with its words until it is turned to.
`stageFilm` in `home/wall.js` sets the pages side by side along one long wall: one sea runs along all of them after the first, and in front of it each page's own blocks, cut around its words, follow a copy of the first screen's name in one film.
Each turn has three parts: the stones of the blocks of the page in front lift off the wall together, then the view travels right along the sea, which stays on the wall, while they fly on, close to the wall, into the next page's blocks, and they settle onto the wall together as the view arrives.
The page takes the wheel, a trackpad's sideways and upward strokes, the keys, and touch, and moves the film's clock from them with `setTime`, like a weight on a damped spring, so the stones carry their speed from one notch of a wheel to the next and ease into each stop: a short push only lifts the stones, a fuller one turns the page, and the turn follows the hand both ways, so it can be held, rewound, or let go, when it finishes whichever way the hand was going if it got past the lift at that end, and settles back if not.
A turn finished under the hand is not carried on by the rest of a flick; a fresh push turns the next.
The stage's canvas is see-through and lies over the first screen's, and its camera looks at a whole screen of the wall where the stage stands at each moment of its film, so its stones, the words, and the first screen move as one.
As a turn from the first screen begins, the first screen takes its name's stones off its wall with `setHidden`, and the stage's copy, the same to the stone, lifts in their place and flies, leaving the letters' bed bare in the first screen's scene, which slides away to the left as the view travels on; its scenes hold still while a turn from it is under way.
Each page's words travel with their page, going as its stones fly off and coming as the next page's land.
Links, the browser's back and forward, an address naming a part of the page, and a keyboard's focus all turn the stage to the right page; with motion reduced, or on a short screen, the page scrolls as a column of rooms instead.
The name's letters are drawn as shapes in `examples/letters.js` rather than set in a typeface, so the word is cut the same in every browser; `examples/inscription.json` is the same first screen as a film of its own.
`home/bar.js` and `home/nav.js` set a bar of black glass over the top of the page, naming its sections in marble stone type, in a small canvas of its own at the screen's full resolution, with a link over each name.
The section in view is inlaid in gold, and the bar's own film flows the gold from name to name as the page moves.
Its stones never lift under the pointer: the pointer holds a lamp over the bar instead, so the glass glitters and the name under it is lit, and a keyboard's focus is lit the same way.
The bar's lens is narrow, so it looks straight down at the whole bar and the lamp's reflection lands under the pointer.
`home/main.js` measures the layout, has the pictures cut in workers, keeps a canvas one viewport tall (plus a margin) moving with the scroll, and cuts the wall again when a new width reflows the page.
The name is laid first, and the page waits there until every picture has been cut before the first scene and the page are laid around it, so none appears half laid.
Once laid, the wall plays in a loop that ends where the first scene flows back in, and the page pauses it at each scene's rest for a few seconds, so nothing is drawn while the stones are still and nothing flows while the first screen is out of view.
Images imported through that studio are processed locally.
An application that loads remote image URLs still needs the server's normal cross-origin permission to read those images.

## Reproducible frames and live input

Exported frames are evaluated from explicit time, source, seed, and render settings.
Live pointer input is kept as timestamped samples, separate from film time.
Each stone answers the pointer's last 0.6 seconds as a damped spring of its own: it rises under the pointer, trails it, and rocks back into the mortar once the pointer has passed.
A resting pointer holds the plain curl, and drawing stops once the stones are still.
On a page that follows its own scroll, each point of that trail is where the pointer was over the wall at that moment, through the view as it was then, so a wall scrolling under a still pointer ripples the stones as a moving pointer does and they settle into the same resting curl.
Exports and replays have no such view, so their frames are unchanged.
The mortar under a stone answers the same motion: as a stone moves off its bed, the shadowed footprint it left there gives way to a deeper shade of the stone's own grout, lit by the scene and shaded by the stone above it, so a lifted stone floats over its own colour.
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
