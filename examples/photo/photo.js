// An image of your own, laid in stone. The picture is a function of plain arguments, so a
// project can name it by path and the command line can capture it like any drawn scene.
// `src` is relative to this module; the other arguments are imageToPicture() options.
import { imageToPicture } from "../../engine/image.js";

export function photo({ src, ...options } = {}) {
  if (typeof src !== "string" || !src) throw new Error("photo needs a src, the image's path relative to photo.js.");
  return imageToPicture(new URL(src, import.meta.url).href, options);
}
