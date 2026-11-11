# Initial verification

These results were observed on 4 October 2026 on macOS with an Apple M2 Pro.
They describe the 0.1.0 local release candidate; other platforms have not been visually verified, and automated counts below note where they were taken.

## Automated checks

`npm test` passes 63 tests covering manifest validation, image analysis, distance transforms, command input, project generation and image import, the page-wall example, a film's score and its mix, local preview isolation, and distribution integrity.
`npm run check` checks the syntax of all 57 JavaScript modules.
These two counts were last taken on 11 November 2026 on macOS with Node 24.
`npm run test:browser` passes seven GPU lifecycle and rendering checks using Chromium 153 with ANGLE Metal and 9,340 stones at 640 by 360 pixels.

- Seeking frames in different orders produces identical pixels.
- Explicit pointer input changes the frame and reproduces exactly.
- Clearing input restores the baseline frame.
- Resizing and restoring the canvas preserves the baseline.
- PNG export restores the prior time and rendered frame.
- A lost and restored WebGL context produces an identical fresh frame without GL errors.
- Disposing the controller cancels scheduled activity and rejects later renders.

The browser command writes a JSON receipt under `output/` and closes its own server and browser.
Pixel equality is tested within the same graphics stack, not across drivers.

## Visual acceptance

The original heron artwork and the two-scene moon-to-morning film were inspected as rendered images.
The studio was also inspected at desktop size and at a 390 by 844 mobile viewport, including image import and playback controls.
The film export contains 600 decoded frames at 60 fps, is 1920 by 1080 pixels, and lasts ten seconds.
It has no audio track.

A preserved frame from the original renderer was compared with the extracted engine at 1280 by 720 pixels.
The largest difference was one level in an 8-bit colour channel, affecting fewer than 0.003% of pixels.
This checks one representative frame, not every possible composition or graphics driver.

The image importer was inspected with an Earth photograph, a wide landscape, and a portrait.
These local test images came from NASA's [Apollo 17 Blue Marble](https://www.nasa.gov/image-article/apollo-17-blue-marble/), [Mount Sharp panorama](https://science.nasa.gov/photojournal/mount-sharp-panorama-in-white-balanced-colors/), and [Mae Jemison portrait S92-40463](https://images.nasa.gov/details/S92-40463).
They are excluded from the public distributions.
The portrait remains recognizable, but small facial features can merge at coarse stone sizes because the importer has no semantic model.

## Film sound

These results were observed on 11 November 2026 on macOS with an Apple M6, using Chromium 156 with ANGLE Metal.
That Chromium is newer than the one Playwright Core 1.63.0 installs, and was selected with `MOSAIC_BROWSER`.

`npm run test:browser` passed all 27 of its checks, two of them new.
The film's own mix differed from the browser's mix of the same landings by less than a ten-thousandth of the loudest sample.
A laid film gave the same landings each time, a part of it gave those of the whole, and a second of it played exactly its landings.

`render --sound` was run twice on `examples/laid.json` at 640 by 360 pixels.
Both MP4 files had the same hash, with 540 video frames and nine seconds of 48 kHz stereo AAC.
395 stones were heard over the 6.9 seconds in which the stones are laid, peaking at -10.7 dBFS.
`examples/film.json` gave 46 landings as its flow lands, and its first second, where no stone lands, was written without a sound track.
The studio played the laid film with no voices while **Hear the stones** was off, and about sixty a second once it was on.

The sound was checked by measurement and as a spectrogram, not by ear.
Its level and its density of sixty stones a second follow the pointer's sound and have not been tuned for films by listening.

## Agent portability

A fresh Codex agent used a complete copied skill bundle outside the checkout to author and render an original copper leaf.
A separate Claude Code run used the same skill format to author and render a gold crescent over jade waves.
Both produced real PNGs and export receipts from the shared engine.
These trials used the development name before it changed to `mosaic`; final packaging separately checks the renamed wrapper and bundled source integrity.

## Remaining acceptance

Safari, Firefox, Windows, and Linux still need visual acceptance.
Image import is intentionally bounded and may simplify texture or small details.
Continuous video conversion is outside this release.
The `Verify` workflow runs `npm test`, `npm run check`, and `npm run build` on Node 20 and 24 for every push, and the `Pages` workflow publishes the website from `main`; neither runs the GPU browser check.
