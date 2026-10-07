// The gallery: every work hung at once, each in its frame with a plaque under it. A film plays
// while the pointer or a keyboard's focus is on it, unless motion is reduced, and any work
// opens whole, as large as the screen allows, with its caption.
export function createGallery(room, { reduceMotion }) {
  const viewer = room.querySelector("#viewer");
  const shown = viewer.querySelector(".viewer-work");

  for (const work of room.querySelectorAll(".work")) {
    const frame = work.querySelector(".frame"), video = frame.querySelector("video");
    if (video) {
      // A play cut short by the pointer leaving again is no error.
      const start = () => { if (!reduceMotion.matches) video.play().catch(() => {}); };
      const stop = () => video.pause();
      frame.addEventListener("pointerenter", start);
      frame.addEventListener("pointerleave", stop);
      frame.addEventListener("focus", start);
      frame.addEventListener("blur", stop);
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
    if (copy.tagName === "VIDEO" && !reduceMotion.matches) copy.play().catch(() => {});
  }
  viewer.querySelector(".viewer-close").addEventListener("click", () => viewer.close());
  // A click on the dark ground round the work closes it too.
  viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener("close", () => shown.replaceChildren());
}
