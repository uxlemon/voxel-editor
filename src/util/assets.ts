/**
 * Resolve a bundled asset path (e.g. samples/). On a plain static host
 * this is site-root ("/foo.vox"); inside a WordPress theme the theme sets
 * `window.VOXEL_BASE` to the theme's dist URL so assets resolve there.
 */
export function assetUrl(path: string): string {
  const base = (window as unknown as { VOXEL_BASE?: string }).VOXEL_BASE ?? "/";
  return base.replace(/\/?$/, "/") + path.replace(/^\//, "");
}
