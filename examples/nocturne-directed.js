// The same original artwork with a directed camera: the engine finds the picture's subjects
// and tours them, and follows the stones if the scene is laid.
import { config as stillConfig } from "./nocturne.js";
export { regions, draw } from "./nocturne.js";

export const config = { ...stillConfig, camera: { direct: true, tilt: 0, yaw: 0, aperture: 0.014, drift: 0 } };
