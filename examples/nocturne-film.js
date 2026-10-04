// The same original artwork, directed for the opening shot of a short film.
import { config as stillConfig } from "./nocturne.js";
export { regions, draw } from "./nocturne.js";

export const config = {
  ...stillConfig,
  camera: {
    keys: [[0, 1110, 235, 620], [0.7, 1110, 235, 640], [3.5, 800, 450, 1600], [6, 800, 450, 1600]],
    tilt: [[0, 4], [3.5, 0]],
    yaw: 0,
    aperture: 0.014,
    drift: 0
  }
};
