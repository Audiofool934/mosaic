// The nocturne, laid to a track of any length. The picture is a function of plain arguments,
// so a project names it by path with its film's duration: the stones are laid from the moon
// outward, and the camera is directed: it follows the laying shot by shot and pulls back to
// the finished panel for the last moments. With `music` in the project, the stones land on the
// track's onsets, and the camera moves to each new shot on a strong one.
import { config as still } from "../nocturne.js";
import { regions, draw } from "../nocturne.js";

export function laid({ duration = 9 } = {}) {
  if (!(Number.isFinite(duration) && duration >= 2)) throw new Error("laid needs a duration of at least two seconds.");
  // The laying ends before the film does, at most two and a half seconds, so the camera has
  // time to pull back and rest on the whole picture.
  const end = duration - Math.min(2.5, duration / 4);
  return {
    regions,
    draw,
    config: {
      ...still,
      camera: {
        direct: true,
        tilt: [[0, 4], [end, 0]],
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
