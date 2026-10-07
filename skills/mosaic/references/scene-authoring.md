# Scene authoring

A project manifest owns time and output framing.
All scene times and keyframe times are in seconds on the project clock.
Panel and stone dimensions are in millimetres; renderer world coordinates are metres.

```json
{
  "version": 1,
  "title": "An original mosaic",
  "seed": 42,
  "fps": [60, 1],
  "frames": 480,
  "band": [1920, 1080],
  "scenes": [
    { "id": "scene", "picture": "./scene.js", "start": 0, "end": 8, "in": { "type": "settled" } }
  ]
}
```

Each picture is an ES module exporting `config`, `regions()`, and `draw(g, mode, D)`.
The initialized example is a complete original scene and the most useful starting reference.
Imports are relative URLs, including the `.js` extension.
Do not put machine-specific absolute paths in manifests.

```javascript
import { circle, poly } from './engine/paint.js';
export const config = {
  panel: { w: 1600, h: 900 }, res: 1, background: 'sky',
  camera: { keys: [[0, 800, 450, 1600], [8, 800, 450, 1600]], tilt: 0, yaw: 0, drift: 0 },
  light: { exposure: .3, grout: '#35444b' }
};
export function regions() {
  return [
    { name: 'sky', size: 13, mode: 'contour', mat: 'glass', tray: ['#173b4b', '#35667c'] },
    { name: 'moon', size: 9, mode: 'radial', center: [1100, 230], mat: 'gold', tray: ['#b18a50', '#efcf91'] }
  ];
}
export function draw(g, mode, D) {
  D.fill(poly([[0,0], [1600,0], [1600,900], [0,900]]), 'sky', '#173b4b');
  D.fill(circle(1100,230,100), 'moon', '#efcf91');
}
```

`D.fill(path, regionName, colour)` and `D.line(path, width, regionName, colour)` paint both the region map and the reference colour.
Use these helpers for shapes so colour and geometry stay aligned.
`D.linear(x0,y0,x1,y1,stops)` provides a colour gradient without replacing region boundaries.
Path2D supports custom curves.
A region tray accepts hex colours or `{hex, mat, emit}` objects.
Materials are `glass`, `gold`, `silver`, `marble`, `basalt`, `emit`, `limestone`, and `terracotta`.
The bundled `examples/materials.json` renders one sample of each, one per second.

Courses support `contour`, `radial` with a centre, and `flow` with an angle; consult the original example before introducing a new layout.
`grid` sets one square stone on each cell of a grid the region's size across, from its `origin`, for lettering too small for courses: set words with `examples/type.js`, whose capitals are five by seven cells, on that grid.
Use coarse stones in quiet backgrounds and finer stones around the focal silhouette.
Avoid tiny fragmented regions that tessellation cannot resolve.
The working raster has a 32-megapixel limit; increasing `res` is not the same as increasing final export resolution.

Camera keys are `[time, centreX, centreY, visibleWidth]`.
A visible width equal to the panel width gives a full composition when panel and output aspects match.
`tilt`, `yaw`, `roll`, `aperture`, and `drift` shape the physical view.
Set drift to zero for a still or repeatable design inspection.
Lighting supports a directional key and fill, ambient sky/ground, point lights, and keyframed exposure.

`in.type: "settled"` displays completed stonework immediately.
`"laid"` schedules stones into the mortar using the picture's `build` configuration.
The bundled `examples/laid.json` lays the nocturne outward from the moon while the camera pulls back; `"bed": 0` shows the bare mortar and its sinopia from the first frame.
The sinopia outlines every region, or the groups of regions listed in the config's `sinopia: { groups }`; `sinopia: false` lays the stones straight onto bare plaster with no drawing first.
`"flow"` pairs outgoing stones with an incoming picture; its `launch` and `land` intervals are on the project clock.
A flow can lift the outgoing picture's stones off the wall together first with `"rise": [from, to, millimetres]`, fly them closer to the wall with an `"arc"` below 1, as for a long flight across it, and land them hovering to settle onto the wall together with `"settle": [from, to]`, so the flow reads the same played backward.
Scenes with `"at": [x, y]` are placed side by side on one wall, in millimetres from its top left corner, and can share the same clock.
A scene placed with `at` can flow in from the scene before it and keeps its place; the whole picture flows, since on a wall the page frames the view rather than the picture's own camera.
`"front": true` keeps a scene's stones and mortar in front of every stone flying past it, so a name or emblem stays clear while the pictures behind it flow; give the pictures behind it a hole in its shape.
The bundled `examples/inscription.json` sets the mosAIc name in front of four scenes that flow in turn, and `examples/inscription-tall.json` is the same film on a tall screen.
A scene's `picture` can be a module path, or `{ "module": "./scenes.js", "export": "scene", "args": { ... } }`, a function in a local module that returns a picture from plain arguments, so one module can draw a family of pictures.
For a first film, inspect the timeline implementation and adapt a small two-scene test before scaling to a long sequence.
Scenes can also export `events` for ignition, dissolution, and bursts, or `arrivals` for separately tessellated figures.
These are advanced authored effects, not inferred motion from a source image.
