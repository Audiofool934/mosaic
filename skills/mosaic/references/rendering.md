# Rendering and portability

The toolchain uses Node.js 20+, a WebGL2 browser, and FFmpeg for movie encoding.
Browser preview, initialization, and manifest inspection need no installed npm dependency.
Capture uses Playwright Core with Chromium.

For a repository checkout, run `npm ci` and `npx playwright-core install chromium` in the repository root.
For a packaged skill, run those commands in `<skill-directory>/assets/runtime`.
FFmpeg must already be available on PATH for MP4 export.
Do not install system software or use paid rendering infrastructure outside the user's authorization.

```bash
node <skill-directory>/scripts/mosaic.mjs init ./my-mosaic
node <skill-directory>/scripts/mosaic.mjs inspect ./my-mosaic/project.json
node <skill-directory>/scripts/mosaic.mjs preview ./my-mosaic/project.json
node <skill-directory>/scripts/mosaic.mjs still ./my-mosaic/project.json --time 2 --width 1920 --samples 4 --out ./output/art.png
node <skill-directory>/scripts/mosaic.mjs render ./my-mosaic/project.json --width 1920 --samples 4 --from 0 --to 120 --out ./output/art.mp4
```

`--from` is inclusive and `--to` is exclusive in project frame numbers.
The manifest's rational FPS owns the output timing.
Preview uses fewer samples for responsiveness; four temporal samples are a useful movie export default.
Output height follows the manifest aspect ratio.
Use the actual tool help if a flag or command is unclear.

Exports are fresh renders, so changed source cannot silently reuse old frame segments.
Keep receipts for frame range, dimensions, settings, seed, and source identity.
The engine's arbitrary-time poses make out-of-order seeking possible.
Same-browser/GPU repeated renders can be compared exactly, while different drivers can differ in rasterization and floating-point results.

On macOS, capture defaults to ANGLE Metal; other systems default to SwiftShader software rendering.
An `ANGLE` environment override selects another installed backend.
A missing WebGL2 or floating-point framebuffer error usually indicates an unsupported graphics configuration.
Do not use `--disable-gpu` as a fix for an empty canvas.
Software rendering takes seconds per frame at 1920 pixels wide, so a full film can take half an hour or more.
Without a GPU, check a film with a short `--to` range, a smaller `--width`, and two samples before the full render.
`render` draws every frame of the project unless `--to` is given.

The common SKILL.md and Node entry point work in skill-aware coding agents.
Codex can install the bundle under `~/.codex/skills/mosaic`; Claude Code can use `~/.claude/skills/mosaic` or a project's `.claude/skills` directory.
Optional `agents/openai.yaml` only supplies Codex interface metadata.
Do not require a particular model, paid connector, or vendor-specific tool to author a scene.
