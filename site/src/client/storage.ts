/**
 * Reads a choice of the reader. Storage throws where the browser blocks the site's data; the
 * choice is then simply not remembered.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remembers a choice of the reader, where the browser allows it. */
export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until the page is left.
  }
}
