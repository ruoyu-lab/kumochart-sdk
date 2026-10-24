/**
 * Heading anchors as GitHub makes them, so that `page.md#anchor` works on GitHub and on the site:
 * lower case, everything but letters, marks, digits, `_`, spaces and hyphens removed, spaces
 * turned into hyphens. Chinese text stays as it is.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Unique anchors within a page: a repeated heading gets `-1`, `-2`, … as on GitHub. */
export class Slugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text);
    let slug = base;

    while (this.seen.has(slug)) {
      const count = (this.seen.get(base) ?? 0) + 1;
      this.seen.set(base, count);
      slug = `${base}-${count}`;
    }

    this.seen.set(slug, 0);
    return slug;
  }
}
