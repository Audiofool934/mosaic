// Headless Chromium with a real GPU: Metal on a Mac, SwiftShader where there is none.
// `--disable-gpu` would give an empty canvas.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

export async function launch(angle) {
  const backend = angle || process.env.ANGLE || (process.platform === "darwin" ? "metal" : "swiftshader");
  const args = backend === "swiftshader"
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    : ["--headless=new", `--use-angle=${backend}`, "--enable-webgl", "--ignore-gpu-blocklist"];
  // --expose-gc lets the render free each posted frame at once: Chrome's blob store
  // otherwise fills with 25 MB frames faster than the collector reclaims them.
  const configured = process.env.MOSAIC_BROWSER;
  if (configured && !existsSync(configured)) throw new Error("MOSAIC_BROWSER must point to an existing Chromium executable.");
  try {
    return await chromium.launch({ executablePath: configured || undefined, args: args.concat(["--force-color-profile=srgb", "--js-flags=--expose-gc"]) });
  } catch (error) {
    throw new Error(`Cannot start Chromium. Set MOSAIC_BROWSER to an installed Chromium executable or run npx playwright-core install chromium. ${error.message}`);
  }
}

export function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
}
