// Builds a film off the page's main thread: the pictures are painted, cut, and scheduled
// here, and only the finished stones and beds are handed back.
import { loadFilm, packFilm } from "./timeline.js";

self.onmessage = async ({ data }) => {
  try {
    const built = await loadFilm(data.project, { baseURL: data.baseURL, from: data.from, to: data.to, scenes: data.scenes, log: (line) => self.postMessage({ log: line }) });
    const { film, transfer } = packFilm(built);
    self.postMessage({ film }, transfer);
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
