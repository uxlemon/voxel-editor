# Voxel Play — WordPress theme

Wraps the Voxel Play SPA as a WordPress theme you can upload to Hostinger.
The app is 100% client-side (Three.js + IndexedDB), so **no database, plugins,
or PHP backend are needed** — the theme just serves the built bundle.

## Build the theme

From the project root:

```bash
npm install
npm run build:wp
```

This builds the app (stable `assets/app.js` + `assets/app.css`), copies `dist/`
into `wordpress-theme/voxel-play/dist/`, and produces **`wordpress-theme/voxel-play.zip`**.

## Install on Hostinger

1. Log in to your WordPress admin (hPanel → *Edit Website* / `your-site.com/wp-admin`).
2. **Appearance → Themes → Add New → Upload Theme**.
3. Choose `voxel-play.zip`, click **Install**, then **Activate**.
4. Visit the site — the front page renders the full-screen app.

> Tip: keep the front page as a simple/empty page; the theme's `index.php`
> renders the app regardless of page content.

## How it works

- `functions.php` enqueues `dist/assets/app.js` (as an ES module) and
  `dist/assets/app.css`, and sets `window.VOXEL_BASE` to the theme's `dist/`
  URL so the app fetches `samples/` and `templates/` `.vox` files from there.
- `index.php` outputs the app's mount points (`#app > #stage > #viewport + #ui`,
  then `#gallery-mount`).
- Saved creations live in the visitor's browser (IndexedDB). To make creations
  shareable across visitors you'd add a real REST backend later; the client
  already talks to a single `galleryStore` module that can be swapped for HTTP.

## Re-deploying after changes

Re-run `npm run build:wp` and re-upload the new `voxel-play.zip` (WordPress will
ask to replace the existing theme).
