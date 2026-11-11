// The morning picture with a directed camera, for a film whose camera the engine directs.
import { config as dawnConfig } from "./dawn.js";
export { regions, draw } from "./dawn.js";

export const config = { ...dawnConfig, camera: { direct: true, tilt: 0, yaw: 0, aperture: 0.014, drift: 0 } };
