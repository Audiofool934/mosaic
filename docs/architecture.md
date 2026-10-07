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
With `worker: true`, each picture of such a wall is cut in its own worker, which also lists its stones for drawing, so the page only uploads them.
The wall is drawn from the moment the first picture is ready, and the others join it as they finish, one to an animation frame, so no frame waits on more than one picture's upload; `controller.ready` resolves once all of them have.
A page out of sight draws no frames, so pictures that finish while it is hidden join once it is shown.
`setView({ frame: { x, y, w } })` looks straight at part of the wall, in the wall's millimetres, instead of following the scene's camera.
A frame can also be a function of the film time, read once for every frame drawn, so a page can follow its own scroll, or move its view as its film plays; `requestFrame()` draws once on the next animation frame.
A picture whose config sets `rows: true` lists its stones by height, so each frame draws only the stones within reach of its view.
A wide picture whose config sets `columns`, a width in millimetres, lists its stones along the wall, and each frame draws only those seated within a column of its view, as far out as the shadows they can throw into it.
That suits a picture whose stones keep within a column of their seats, as a flow paired within columns keeps them; a stone that goes further, as one that scatters when it has no partner in a flow, is listed apart and drawn wherever the view is while any such stone is on its way, so a frame comes out the same to the pixel as one drawn whole.
Pictures without either keep their own drawing order and their exact pixels.
Pictures cut alike, as copies of one scene are, share one map of which stone owns each patch of mortar on the graphics card, and a picture with no figures arriving apart, or no sinopia, holds a single texel in place of that map, so a long wall of pictures takes less memory.
A picture placed with `at` can flow in from the scene before it and keeps its place; the flow takes in the whole picture, since on a wall the page frames the view rather than the picture's own camera, and the pictures of such a chain are cut in one worker.
A flow's wave runs out from its `focus`, a point in the incoming picture's millimetres, or from the nearest of a list of them, over `reach` millimetres, three quarters of the view's width unless set.
With `columns`, a width in millimetres, a flow pairs the stones within each column of the wall, counted from the incoming picture's left edge, so none flies further than its own column; a wall of screens side by side can then flow on every screen at once, each from its own middle, and draw only the screens in view.
A scene set `front: true` stays in front of every stone flying past it.
Where its stones are seated the depth is cleared before they are drawn, it is shaded only by its own stones, and its mortar is laid last; where its stones have not landed yet, or have lifted off, whatever lies under them shows.
The mortar is drawn once for each pair of pictures, the newest two last, and a later pair covers an earlier one only where it has a stone or a seat, so a wall of more than two pictures keeps every picture's mortar.
`createMosaic(canvas, { loop: [from, to] })` plays on from `to` at `from` until paused.
`play({ to, rate })` plays toward a time, backward if it lies behind, `rate` times as fast, and stops there.
`setTime(t)` moves the film to a time and draws it at once, keeping live input, for a page that moves the clock itself.
`createMosaic(canvas, { lamp })` gives the page a lamp to hold over the wall: `setLamp({ x, y })` moves a cone of light, `lamp.height` millimetres above the wall, toward a point on the canvas, and `setLamp({ active: false })` puts it out.
The lamp glides and fades on its own, lights stones and mortar alike, and shines in live frames only, so exports never show it.
A flow can lift its stones on its own clock: with `rise: [from, to, mm]` the outgoing picture's stones lift off together before they fly, each a touch askew, with `arc` below 1 they fly closer to the wall, and with `settle: [from, to]` they land hovering and come down onto the wall together, so a flow played backward starts with a lift as well.
A view that jumps half its width or more from one frame to the next has been cut, not slid, so the pointer's trail starts again from it.
`fov` narrows the lens, so the camera stands back and looks straight at every part of a long, low panel, and `fringes: false` drops the lens's colour fringes.
`coat` sets the colour of the bare bed, which shows wherever no stone has been set yet, or where stones have lifted off in a flow.

The project page is such a wall.
`home/wall.js` sets the name on the first screen, in white marble with its AI inlaid in gold, in front of four scenes from `examples/landscapes.js`: moonlit water, dunes at dusk, sweeping currents, and peaks at first light.
Each scene is drawn on a stage 1600 by 900 millimetres, scaled evenly until it covers the first screen, the way a cover image fills a frame: a narrow screen cuts its sides around the scene's focus, and there the name is set as MOS over AIC, while a wide one cuts its foot.
Given a `total` width, a scene is drawn as a panorama that keeps the first screen as it is and runs on to the right with more of the same: more stars and reeds by the water, more rows of dunes, the currents carried on, and more peaks.
Where motion is welcome and the screen is tall enough, the page's screens stand side by side along one wide wall that scrolls sideways: the first screen, then each room, or on a phone each of a room's pages.
The wheel scrolls it sideways as it would scroll a page down, gliding there, and a trackpad's sideways stroke, the keys, touch, links, the bar, an address naming a part of the page, and the browser's back and forward all move along it.
`wideFilm` in `home/wall.js` sets the whole wall in one film: the name, then the page's own blocks in front of each scene in turn as a panorama along all of the screens.
The page marks its blocks with `data-wall`: an emblem is a picture or film the page shows, which the wall frames in gold; a frame is the gold alone, round openings the page fills; and a sample is a square of one material, its stones following a disc in a square field, set in the wall in a thin gold rim.
The method's picture is the heron by the moon in four bands, each a stage of it, in one gold frame: the flat drawing, its courses, and its cut stones are images that `tools/media.mjs` renders from `examples/nocturne.js`, and the fourth band is live, an opening the wall fills with the rest of the same picture in its own stones, which lift under the pointer like the rest of the wall.
The wall is laid outward from behind the name, or from the middle of the screen the page opens on, and then every few seconds one scene flows into the next on every screen at once, the stones of each screen flying within it, out from its middle, as the first screen's run out from behind the name.
A flow waits while the page is being scrolled, so the wall never moves two ways at once, and a button pauses the scenes where they are.
The bare bed between two scenes is a deep slate, so a flow never flashes pale.
The wall's canvas is a screen wide, with a margin either side, and follows the scroll, and each scene draws only the screens near the one in view.
With motion reduced, or on a short screen, the page scrolls down as a column of rooms instead, each a screen high, which the browser settles on one at a time; it is laid over the first scene alone, which runs on below the first screen to a long wave, where a second picture painted from the page's layout takes over.
`home/rooms.js` makes sure a deliberate turn of the wheel always reaches the next room in the column where a browser would snap a short scroll back, and leaves scrolling itself to the browser.
The name's letters are drawn as shapes in `examples/letters.js` rather than set in a typeface, so the word is cut the same in every browser; `examples/inscription.json` sets the name in front of all four scenes, flowing into one another in turn, as a film of its own.
`home/bar.js` and `home/nav.js` set a bar of black glass over the top of the page, naming its sections in marble stone type, in a small canvas of its own at the screen's full resolution, with a link over each name.
The section in view is inlaid in gold, and the bar's own film flows the gold from name to name as the page moves.
Its stones never lift under the pointer: the pointer holds a lamp over the bar instead, so the glass glitters and the name under it is lit, and a keyboard's focus is lit the same way.
The bar's lens is narrow, so it looks straight down at the whole bar and the lamp's reflection lands under the pointer.
The page's words are set the same way, on slabs of black glass in a thin gold rim: `home/slab.js` draws each slab marked `data-slab` as a picture of its own, its millimetres CSS pixels, with its headings, labels, and buttons in stone type over the glass, marked `data-type`, recesses of darker glass under buttons and code, marked `data-well`, and lines of gold, marked `data-rule`.
The glass round each line of stone type is laid on the type's own grid, a square stone to each cell, as round the letters of an inscription, so no stone of the plate's courses strays among the letters and even small type keeps its shape.
`home/slabs.js` sizes each line of stone type from its cell, so the page lays out around it, and sets it on more lines, from `data-type-narrow`, where it would not fit its slab; then it cuts and lights every slab at the screen's full resolution, the ones in view first, and keeps each as a still canvas behind the slab's words.
The camera stands four metres from every slab with a lens just wide enough for it, so it looks almost straight down and the whole slab stays within its reach.
The pointer holds the bar's lamp over the slab it is on, and so does a keyboard's focus: that slab is cut again on a canvas of its own, to the same stones, and drawn live over its still while the lamp is held.
The gallery hangs every work at once, each in its frame with a slab under it for its plaque; a film plays while it is pointed at, and any work opens whole, as large as the screen allows, with its caption.
The studio's room lays an image in stone in a frame on the page, with `home/atelier.js`: one of three flat paintings `tools/media.mjs` renders from the examples, or an image of one's own, dropped on the frame or chosen, in glass, stone, or gold.
The image is read on the page, cropped to the frame, and analysed and cut in a worker by `home/image.js`, so the page stays responsive, and it never leaves the browser.
`home/main.js` measures the layout, has the pictures cut in workers, keeps the canvas moving with the scroll, and cuts the wall again when a new size reflows the page, on the screen that was in view.
The name is laid first, and the page waits there until the pictures it lays next have been cut, so none appears half laid; the wide wall's scenes flow only once every one of them has been cut.
Nothing is drawn while the stones are still: a column of rooms rests once laid, and the wide wall between flows.
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
