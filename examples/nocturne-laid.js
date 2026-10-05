// The same original artwork, laid into a bare bed from the moon outward.
// The camera starts close on the first stones and pulls back as the panel grows.
import { config as stillConfig } from "./nocturne.js";
export { regions, draw } from "./nocturne.js";

export const config = {
  ...stillConfig,
  camera: {
    keys: [[0, 1110, 250, 520], [1.4, 1060, 290, 640], [6.4, 800, 450, 1600], [9, 800, 450, 1600]],
    tilt: [[0, 5], [6.4, 0]],
    yaw: 0,
    aperture: 0.014,
    drift: 0
  },
  build: {
    origin: [1110, 235],
    start: 0.3,
    end: 7,
    speeds: { moon: 1.5, halo: 1.3, bird: 2.2, wing: 2.2, shade: 2.2, bronze: 2, ink: 2 }
  }
};
