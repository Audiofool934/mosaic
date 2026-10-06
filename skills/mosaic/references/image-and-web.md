# Image import and the web

The studio keeps imported images in the browser.
No upload service is involved.
JPEG, PNG, WebP, and other image formats supported by the browser can be imported; animated files contribute one decoded frame.
Prefer a source with a clear silhouette and readable lighting.
Inspect fine features after conversion, especially eyes, fingers, thin lines, and text.
Conversion preserves image structure but does not understand those features semantically.

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
Scenes placed with `at: [x, y]` form one wall of several pictures, each cut in its own worker and drawn as soon as it is ready; `controller.ready` resolves when all have joined.
A picture that flows in from the one before it is cut in the same worker.
`createMosaic(canvas, { loop: [from, to] })` plays on from `to` at `from`, until paused; a page can pause at rest times of its own to hold each picture, so the canvas draws nothing while the stones are still.
`play({ to, rate })` plays toward a time, backward if it lies behind, at `rate` times speed, and stops there, which suits a page that moves a film between states as it scrolls.
For a control or plaque set in stone, `createMosaic(canvas, { lamp: { height, power, cone, color } })` lets the page hold a lamp over it with `setLamp({ x, y })` and `setLamp({ active: false })`, a light cone that marks what the pointer is on without moving any stones; exports never show it.
`fov`, in degrees, narrows the lens for a long, low panel, so metal and glass mirror the same light from end to end, and `fringes: false` drops the lens's colour fringes.
The project page in the mosAIc source repository, `home/main.js` and `home/wall.js`, is a complete example: the page measures its own layout and has a picture painted around it.
