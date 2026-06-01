import "./styles.css";

const nav = document.querySelector("[data-site-nav]");
const menuButton = document.querySelector("[data-menu-button]");
const navMenu = document.querySelector("[data-nav-menu]");

const syncStickyState = () => {
  nav?.classList.toggle("is-scrolled", window.scrollY > 8);
};

syncStickyState();
window.addEventListener("scroll", syncStickyState, { passive: true });

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navMenu?.classList.toggle("is-open", !isOpen);
});

navMenu?.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLAnchorElement)) {
    return;
  }

  menuButton?.setAttribute("aria-expanded", "false");
  navMenu.classList.remove("is-open");
});
