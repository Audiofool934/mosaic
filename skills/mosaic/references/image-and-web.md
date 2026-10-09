# Image import and the web

The studio keeps imported images in the browser.
No upload service is involved.
JPEG, PNG, WebP, and other image formats supported by the browser can be imported; animated files contribute one decoded frame.
Prefer a source with a clear silhouette and readable lighting.
Inspect fine features after conversion, especially eyes, fingers, thin lines, and text.
Conversion preserves image structure but does not understand those features semantically.

## From the command line

`import <image> <directory>` makes a project of a PNG, JPEG, WebP, or GIF file.
It copies the image and the engine into the directory, writes `photo.js`, and sets the manifest's `band` to the image's shape, upright as a browser shows it.
`--material` chooses `glass`, `stone`, or `gold`, and `--stone-size` the stone size in millimetres.
Then `inspect`, `preview`, `still`, and `render` work on it as on any project.

```bash
node <skill-directory>/scripts/mosaic.mjs import ./photo.jpg ./photo-mosaic --material glass --stone-size 12
node <skill-directory>/scripts/mosaic.mjs still ./photo-mosaic/project.json --width 1600 --samples 4 --out ./photo-mosaic/output/still.png
```

The picture is the function in `examples/photo/photo.js`: its `src` is the image's path relative to the module, and its other arguments are `imageToPicture()` options, so `paletteSize`, `detail`, or `seed` can be added to the scene's `args` in `project.json`.
The image is analysed in the capture browser, never uploaded.
If you change the image, keep `band` at 1600 by 1600 × height / width so the output keeps its shape.
`examples/photo/` is the same project made from a flat painting of the nocturne; inspect or capture it to check an installation.

```javascript
import { createMosaic } from './engine/runtime.js';
const artwork = await createMosaic(document.querySelector('canvas'), {
  image: file,
  imageOptions: { stoneSize: 12, paletteSize: 18, material: 'glass', detail: .6, seed: 42 },
  width: 1280,
  samples: 1
});
```

`imageToPicture(source, options)` also accepts a URL with browser CORS access or `{width,height,data}` RGBA data.
`analyzeImage()` is the pure synchronous RGBA entry point.
The maximum working dimension defaults to 768 pixels; export resolution remains independent.
`paletteSize` ranges from 2 to 48, `detail` from 0 to 1, and `material` is `glass`, `stone`, or `gold`.
Transparent pixels leave unfilled mortar; the exported canvas itself is opaque.
Higher detail retains smaller islands but can produce visual noise.

For a code-authored scene, replace `image` with `project: './project.json'`, and add `worker: true` to cut its stones off the page's main thread.
The controller exposes `seek`, `play`, `pause`, `setPointer`, `setView`, `resize`, `exportPNG`, `getState`, and `dispose`.
`info` contains native aspect, dimensions, duration, frame rate, and stone counts.
Use `resize(width, height)` when the display needs different render dimensions and call `dispose()` when replacing or removing an artwork.

```javascript
canvas.addEventListener('pointermove', event => {
  const r = canvas.getBoundingClientRect();
  artwork.setPointer({ x: (event.clientX-r.left)/r.width, y: (event.clientY-r.top)/r.height, active: true });
});
canvas.addEventListener('pointerleave', () => artwork.setPointer({ active: false }));
artwork.setView({ zoom: 1.4, light: .25 });
```

Pointer positions are normalized canvas coordinates.
The bounded curl displaces and tilts nearby stones, while both colour and shadow passes share the pose.
Each stone follows the pointer's recent path on a damped spring, so stones trail a moving pointer and rock back into place when it leaves.
Send pointer events as they happen; the engine does its own smoothing.
Respect reduced-motion preferences and make pointer motion optional; keep image controls and export keyboard accessible.

A normal `seek(t)` clears live input for deterministic inspection.
`startRecording()` and `stopRecording()` return a version 2 trace of the normalized pointer input samples and their strength.
Replay with `seek(t, {trace: recording.points})` or supply an explicit `pointer` object, which poses the stones as under a resting pointer.
Traces use their own elapsed seconds; align the project time with the recording start when replaying moving films.
PNG export uses the current view and time with no live pointer unless a trace or pointer is explicitly supplied.

To hear the stones, create `createStoneSound()` from `engine/sound.js`, call its `start()` from a click, and pass `artwork.onContact(events => sound.play(events))` its contacts; keep sound off until the viewer asks for it.

A page that scrolls across a wall can keep one viewport-sized canvas moving with the scroll and give `setView({ frame })` a function returning `{ x, y, w }` in panel millimetres for the stretch in view; call `requestFrame()` on scroll.
The function is given the film time it is drawn at, so a page can also move its view as its film plays.
Scenes placed with `at: [x, y]` form one wall of several pictures, each cut in its own worker and drawn as soon as it is ready, one picture to an animation frame; `controller.ready` resolves when all have joined.
A picture that flows in from the one before it is cut in the same worker.
A wide picture can set `columns` in its config, a width in millimetres, so each frame draws only the stones within a column of the view; pair its flows within the same columns, so a page of screens side by side draws only the screens near the one in view.
`createMosaic(canvas, { loop: [from, to] })` plays on from `to` at `from`, until paused; a page can pause at rest times of its own to hold each picture, so the canvas draws nothing while the stones are still.
`play({ to, rate })` plays toward a time, backward if it lies behind, at `rate` times speed, and stops there, which suits a page that moves a film between states as it scrolls.
For a control or plaque set in stone, `createMosaic(canvas, { lamp: { height, power, cone, color } })` lets the page hold a lamp over it with `setLamp({ x, y })` and `setLamp({ active: false })`, a light cone that marks what the pointer is on without moving any stones; exports never show it.
`fov`, in degrees, narrows the lens for a long, low panel, so metal and glass mirror the same light from end to end, and `fringes: false` drops the lens's colour fringes.
`coat` sets the colour of the bare bed, which shows, in that one plain colour, wherever a stone is not yet set or has come off its bed, lifted by the pointer or a flow, or gone; a dark coat keeps a page that flows between screens from flashing pale between them, and a page's lifted stones from opening pale holes.
Give a picture `insets` in its config, `[x, y, w, h]` in its millimetres, for squares that should move on their own, such as material samples: the pointer then moves only the stones of the inset it is on, and the wall round the insets stays still.
A page that turns between pictures with gestures can move one film's clock from the hand with `setTime(t)`, which keeps live input, easing it toward where the hand is, so the stones follow it both ways and a turn can be rewound.

## A wall around an existing page

`examples/page-wall/` cuts a wall around the words of an existing page.
Its `index.html` marks blocks with `data-wall`, measures them in CSS pixels, and passes them as plain arguments to `pageWall()` in `wall.js`, which paints a plate of dark glass in a gold rim for each block so the courses flow around them.
The canvas stays a screen high behind the page, and `setView({ frame })` follows the page's scroll across a wall as long as the page.
A resize that moves the blocks cuts the wall again; otherwise the canvas only takes the new size.
A very long page is laid with a coarser working raster and larger stones, so it stays within the engine's limits.
Preview it with `preview` and open `/examples/page-wall/index.html` on the printed server, or capture its sample layout with `still <skill-directory>/assets/runtime/examples/page-wall/project.json`.
To use it on another page, copy `wall.js`, the page's script, and the `engine/` directory next to the page, mark its blocks with `data-wall`, and change the two import paths to match.
`wall.js` has no imports of its own; change its `field`, `rim`, and `plate` colours or its stone size through the arguments.
