/** A scroll to a heading: from where the page was, over a time that grows with the distance. */
interface Jump {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  /** When its first frame came; `null` before it. */
  start: number | null;
}

/**
 * A link to a heading of the page, such as one of its contents, glides there, slow to start and
 * to stop. Off for those who ask for less motion; the wheel, touch, the keyboard and the
 * scrollbar scroll as the browser does, and stop a glide on the way.
 */
export function initScroll(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const root = document.documentElement;
  let jump: Jump | null = null;
  let position = 0;
  let frame = 0;

  const step = (time: number) => {
    if (!jump) {
      return;
    }

    jump.start ??= time;
    const progress = Math.min((time - jump.start) / jump.duration, 1);
    position = jump.from + (jump.to - jump.from) * easeInOut(progress);
    window.scrollTo(0, position);

    if (progress === 1) {
      jump = null;
      frame = 0;
    } else {
      frame = window.requestAnimationFrame(step);
    }
  };

  window.addEventListener(
    'scroll',
    () => {
      // Moved by something else on the way, such as the wheel: that takes over.
      if (jump && Math.abs(window.scrollY - position) > 2) {
        window.cancelAnimationFrame(frame);
        jump = null;
        frame = 0;
      }
    },
    { passive: true }
  );

  document.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href*="#"]');

    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.classList.contains('skip-link') ||
      link.origin !== location.origin ||
      link.pathname !== location.pathname
    ) {
      return;
    }

    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));

    if (!heading) {
      return;
    }

    event.preventDefault();
    const offset = parseFloat(getComputedStyle(root).scrollPaddingTop);
    const top = heading.getBoundingClientRect().top + window.scrollY - offset;
    const to = Math.min(Math.max(top, 0), root.scrollHeight - window.innerHeight);
    window.cancelAnimationFrame(frame);
    position = window.scrollY;
    jump = {
      from: window.scrollY,
      to,
      duration: Math.min(350 + Math.sqrt(Math.abs(to - window.scrollY)) * 6, 900),
      start: null
    };
    frame = window.requestAnimationFrame(step);

    if (location.hash !== link.hash) {
      history.pushState(null, '', link.hash);
    }
  });
}

function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2;
}
