// An image as a picture, for the studio set in the wall: its pixels are analysed in the worker
// that cuts them, so the page stays responsive while it is laid. `image` is { width, height,
// data } in RGBA, and `options` are imageToPicture's.
import { analyzeImage } from "../engine/image.js";

export function imagePicture({ image, options }) {
  return analyzeImage(image, options);
}
