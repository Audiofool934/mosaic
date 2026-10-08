// The gallery: every work hung at once, each in its frame with a plaque under it. A film plays
// by itself while it is in view, unless motion is reduced, and any work opens whole, as large as
// the screen allows, with its caption.
export function createGallery(room, { reduceMotion }) {
  const viewer = room.querySelector("#viewer");
  const shown = viewer.querySelector(".viewer-work");
  const videos = [], inView = new Set();

  // A film plays only if it is in view, motion is not reduced, and the viewer is closed.
  const sync = () => {
    for (const video of videos) {
      // A play cut short by a pause is no error.
      if (inView.has(video) && !reduceMotion.matches && !viewer.open) video.play().catch(() => {});
      else video.pause();
    }
  };
  // A film is in view when at least 40% of its frame is visible.
  const observer = new IntersectionObserver((entries) => {
    for (const { target, intersectionRatio } of entries) {
      const video = target.querySelector("video");
      if (intersectionRatio >= 0.4) inView.add(video);
      else inView.delete(video);
    }
    sync();
  }, { threshold: 0.4 });

  for (const work of room.querySelectorAll(".work")) {
    const frame = work.querySelector(".frame"), video = frame.querySelector("video");
    if (video) {
      videos.push(video);
      observer.observe(frame);
    }
    frame.addEventListener("click", () => open(work));
  }

  function open(work) {
    const media = work.querySelector(".frame video, .frame img"), plaque = work.querySelector(".plaque");
    let copy;
    if (media.tagName === "VIDEO") {
      copy = document.createElement("video");
      Object.assign(copy, { src: media.currentSrc || media.src, poster: media.poster, muted: true, loop: true, playsInline: true, controls: true });
      copy.setAttribute("aria-label", media.getAttribute("aria-label"));
      media.pause();
    } else {
      copy = media.cloneNode();
      copy.loading = "eager";
    }
    shown.replaceChildren(copy);
    viewer.querySelector("#viewer-title").textContent = plaque.querySelector("h3").textContent;
    viewer.querySelector(".viewer-meta").textContent = plaque.querySelector("p").textContent;
    viewer.querySelector(".viewer-text").replaceChildren(work.querySelector("template").content.cloneNode(true));
    viewer.showModal();
    sync();
    if (copy.tagName === "VIDEO" && !reduceMotion.matches) copy.play().catch(() => {});
  }
  viewer.querySelector(".viewer-close").addEventListener("click", () => viewer.close());
  // A click on the dark ground round the work closes it too.
  viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener("close", () => { shown.replaceChildren(); sync(); });
  // Motion reduced or welcomed again stops or starts the films.
  reduceMotion.addEventListener("change", sync);
}
