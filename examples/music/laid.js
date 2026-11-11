// The nocturne, laid to a track of any length. The picture is a function of plain arguments,
// so a project names it by path with its film's duration: the stones are laid from the moon
// outward while the camera pulls back, and the finished panel is held for the last moments.
// With `music` in the project, the stones land on the track's onsets.
import { config as still } from "../nocturne.js";
import { regions, draw } from "../nocturne.js";

export function laid({ duration = 9 } = {}) {
  if (!(Number.isFinite(duration) && duration >= 2)) throw new Error("laid needs a duration of at least two seconds.");
  // The laying ends a little before the film does, at most a second and a half.
  const end = duration - Math.min(1.5, duration / 5);
  return {
    regions,
    draw,
    config: {
      ...still,
      camera: {
        keys: [[0, 1110, 250, 520], [0.2 * end, 1060, 290, 640], [0.92 * end, 800, 450, 1600], [duration, 800, 450, 1600]],
        tilt: [[0, 5], [0.92 * end, 0]],
        yaw: 0,
        aperture: 0.014,
        drift: 0
      },
      build: {
        origin: [1110, 235],
        start: 0,
        end,
        speeds: { moon: 1.5, halo: 1.3, bird: 2.2, wing: 2.2, shade: 2.2, bronze: 2, ink: 2 }
      }
    }
  };
}
