# mosAIc

This project makes physical mosaic artwork with a shared WebGL2 engine, browser studio, command-line tools, and a portable agent skill.
Preserve the approved stone geometry, contour-following layout, materials, and lighting when extracting or changing the engine.
Continuous video stylization is outside the current scope.

## Structure

- `engine/` contains the rendering and scene code shared by the studio and exports.
- `examples/` contains original scene modules and project manifests.
- `index.html` and `home/` contain the project page; `home/media/` is rendered by `tools/media.mjs`.
- `site/` contains the interactive studio.
- `tools/` contains local serving, capture, and command-line tools.
- `skills/mosaic/` contains portable instructions and supporting resources.
- `tests/` contains focused automated verification.
- `output/` contains ignored local render and verification artifacts.

## Working rules

Draw exported frames from explicit time and a seed.
Keep live pointer input separate from deterministic exports; recorded interactions must reproduce their poses.
Share transforms between stone and shadow passes.
Do not turn the stones into a flat pixelation filter.
Do not copy private paths, project notes, or unrelated artwork into distributable files.
Do not edit generated bundles by hand.
Keep dependencies proportional to their benefit.

Run `npm test` for changed behavior and `npm run check` before release.
Inspect real rendered output for visual changes.
Report the tested browser and platform instead of assuming cross-platform parity.
Own and clean up any browser, driver, or preview server you start.
One complete sentence per line in long Markdown documents.
Never add an agent co-author to commits.
