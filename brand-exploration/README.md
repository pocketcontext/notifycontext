# NotifyContext brand exploration

100 selection-stage vector identities, numbered 001–100. This standalone review
page follows PocketContext's green/cream palette, IBM Plex Sans typography, and
brand asset formats. It does not change the application reader or its adopted
identity. The concepts explore ten application-specific visual families.

Each direction has 9 SVGs, 9 PNGs and a ZIP kit: logo, favicon, outlined wordmark,
social card, LinkedIn logo/banner and Luma logo/banner/social. Favicon strokes
are increased 20%; solid geometry receives a small outline. Cards show 16, 32
and 48px previews. Refine the chosen design optically before application release.

## Rebuild

From this directory, use Python with `fonttools` and `brotli` installed, plus
Node.js. `render.mjs` uses the existing website checkout's installed `sharp`.

```sh
python generate.py
node render.mjs
python package.py
python -m http.server 8769 --bind 127.0.0.1 --directory dist
```

Generated `dist/` stays ignored. Serve only `dist/`, never the repository root.
To share temporarily, run `cloudflared tunnel --url http://127.0.0.1:8769`.
The public tunnel lasts only while that process and the HTTP server run.
Only generated design files are exposed; there is no application data access.

Favorites live in browser local storage and are not sent anywhere. Copy the
shortlist into the conversation to communicate choices. Each concept supports
an anchor such as `#concept-013`. Assets contain no externally loaded resources.
Wordmarks and social lettering are outlined from the bundled licensed font.

Validated in Chromium: 100 cards, family/search filters, favorites persistence,
clipboard, deep links, downloads, dark previews, 390px mobile layout, unavailable
local storage and browser errors. All 100 kits and 900 PNG dimensions passed;
SVG bodies are unique and parseable, and symbols stay inside the canvas. Public
gallery and ZIP download routes returned HTTP 200.
