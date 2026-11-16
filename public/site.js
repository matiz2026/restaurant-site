document.querySelectorAll("img[data-photo]").forEach((img) => {
  img.addEventListener("error", () => {
    const note = document.createElement("p");
    note.className = "photo-missing";
    note.textContent = "This photo could not be loaded.";
    img.replaceWith(note);
  });
});
