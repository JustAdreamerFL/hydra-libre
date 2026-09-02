# Hydra Libre website

This is the static product site for Hydra Libre. It has no build step or runtime dependencies: `index.html`, `styles.css`, and `script.js` can be served by GitHub Pages or any static host.

For local preview:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

The navigation contains the complete product surface: Overview, Features, Achievements, Social, Cloud saves, Download, and FAQ. The sections remain on one page so links, search engines, and keyboard navigation can discover all content.
