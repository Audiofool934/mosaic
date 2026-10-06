// The gallery: one work shown at a time, chosen from the reel under it. A film plays while it
// is on screen, unless motion is reduced or it was paused; a still is shown as it is.
export function createGallery(room, { reduceMotion }) {
  const film = room.querySelector("#film");
  const still = room.querySelector("#feature-still");
  const caption = room.querySelector("#feature-caption");
  const toggle = room.querySelector("#film-toggle");
  const plates = [...room.querySelectorAll(".plate")];
  let paused = false, onScreen = false;

  const sync = () => { toggle.textContent = film.paused ? "Play the film" : "Pause the film"; };
  // Scrolling away interrupts a pending play(); only a blocked autoplay needs the native controls.
  const play = () => film.play().catch((error) => { if (error.name === "NotAllowedError") film.controls = true; });
  const playing = () => onScreen && !paused && !film.hidden && !reduceMotion.matches;

  function choose(plate) {
    for (const other of plates) other.setAttribute("aria-pressed", String(other === plate));
    caption.replaceChildren(plate.parentElement.querySelector("template").content.cloneNode(true), toggle);
    if (plate.dataset.film) {
      if (film.getAttribute("src") !== plate.dataset.film) {
        film.poster = plate.dataset.poster;
        film.src = plate.dataset.film;
      }
      film.setAttribute("aria-label", plate.dataset.alt);
      film.hidden = false;
      still.hidden = true;
      toggle.hidden = reduceMotion.matches;
      if (playing()) play();
    } else {
      film.pause();
      film.hidden = true;
      still.src = plate.dataset.still;
      still.alt = plate.dataset.alt;
      still.hidden = false;
      toggle.hidden = true;
    }
  }
  for (const plate of plates) plate.addEventListener("click", () => choose(plate));

  if (reduceMotion.matches) film.controls = true;
  else {
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      paused = !film.paused;
      if (paused) film.pause();
      else play();
    });
    film.addEventListener("play", sync);
    film.addEventListener("pause", sync);
    sync();
  }

  return {
    // Whether the gallery is on screen: a film plays only while it is.
    setOnScreen(visible) {
      onScreen = visible;
      if (playing()) play();
      else if (!visible) film.pause();
    }
  };
}
