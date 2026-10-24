import { LruCache } from '../utils/lru-cache';

/** Path2D objects of button icons, owned by one painter. */
export class IconCache {
  private readonly paths = new LruCache<string, Path2D>(64);

  get(data: string): Path2D {
    return this.paths.getOrCreate(data, () => new Path2D(data));
  }
}
