(() => {
  const links = [...document.querySelectorAll(".tab-link")];
  const panels = [...document.querySelectorAll(".tab-panel[data-panel]")];
  const menu = document.querySelector(".mobile-menu");
  const nav = document.querySelector(".site-nav");

  const setTab = (tab) => {
    const target = document.getElementById(tab);
    if (!target) return;

    links.forEach((link) =>
      link.classList.toggle("is-active", link.dataset.tab === tab)
    );
    // The landing page keeps all content discoverable while the navigation
    // behaves like tabs: selecting a primary tab scrolls to its full section.
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    nav?.classList.remove("is-open");
    menu?.setAttribute("aria-expanded", "false");
  };

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const tab = link.dataset.tab;
      if (!tab) return;
      event.preventDefault();
      history.pushState(null, "", `#${tab}`);
      setTab(tab);
    });
  });

  menu?.addEventListener("click", () => {
    const isOpen = nav?.classList.toggle("is-open") ?? false;
    menu.setAttribute("aria-expanded", String(isOpen));
  });

  const sections = links
    .map((link) => document.getElementById(link.dataset.tab || ""))
    .filter(Boolean);
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible?.target.id) return;
      links.forEach((link) =>
        link.classList.toggle(
          "is-active",
          link.dataset.tab === visible.target.id
        )
      );
    },
    { rootMargin: "-28% 0px -60% 0px", threshold: [0, 0.15, 0.5] }
  );
  sections.forEach((section) => observer.observe(section));

  const initialTab = window.location.hash.slice(1);
  if (initialTab && document.getElementById(initialTab)) {
    setTimeout(() => document.getElementById(initialTab)?.scrollIntoView(), 0);
  }
})();
