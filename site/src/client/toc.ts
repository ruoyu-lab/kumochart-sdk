/** Marks the heading being read in the page's table of contents. */
export function initToc(): void {
  const items = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')]
    .map((link) => ({
      link,
      heading: document.getElementById(decodeURIComponent(link.hash.slice(1)))
    }))
    .filter(
      (item): item is { link: HTMLAnchorElement; heading: HTMLElement } => item.heading !== null
    );

  if (items.length === 0) {
    return;
  }

  const toc = document.querySelector<HTMLElement>('.toc');
  let frame = 0;
  let current: (typeof items)[number] | undefined;

  /** Keeps the marked heading in view in a long table of contents, such as the API's. */
  const reveal = (link: HTMLElement) => {
    if (!toc) {
      return;
    }

    const top = link.offsetTop;

    if (top < toc.scrollTop || top > toc.scrollTop + toc.clientHeight - link.offsetHeight) {
      toc.scrollTop = top - toc.clientHeight / 3;
    }
  };

  const update = () => {
    frame = 0;
    const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + 8;
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const passed = items.filter((item) => item.heading.getBoundingClientRect().top <= offset);
    const active = atEnd ? items[items.length - 1] : passed[passed.length - 1];

    for (const item of items) {
      if (item === active) {
        item.link.setAttribute('aria-current', 'true');
      } else {
        item.link.removeAttribute('aria-current');
      }
    }

    if (active && active !== current) {
      reveal(active.link);
    }

    current = active;
  };

  window.addEventListener(
    'scroll',
    () => {
      frame ||= window.requestAnimationFrame(update);
    },
    { passive: true }
  );
  update();
}
