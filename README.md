# Statusline

Statusline is a Manifest V3 browser extension that adds a configurable,
Vivaldi-style status bar to Microsoft Edge and Google Chrome.

It keeps shortcuts at the left, an editable address field in the center, and
status/actions at the right. The extension uses one Chromium codebase for Edge
and Chrome; browser-specific APIs are detected at runtime.

## Features

- Persistent top or bottom status bar with adjustable height, opacity, and
  light/dark/system themes.
- Editable current-address field. Press Enter to navigate.
- Link target display on hover.
- Viewport dimensions and optional selected-text length.
- Scroll position shown as a scrollbar-style indicator rather than a second
  percentage value.
- Editable page zoom percentage plus `-` / `+` controls.
- Capture menu with visible-area, box-selection, scrolling-selection, and
  full-page stitched capture.
- Tile and Stack actions with an in-page tab picker. Stack uses Chromium tab
  groups; Tile uses the native Split View API when the browser exposes it.
- User-created shortcuts that open compact, top-level browser windows. Shortcut
  windows use the normal browser profile and first-party authentication flow,
  so sites that reject iframe embedding can sign in normally.
- Configurable primary clock with IANA time zone and format pattern.
- World-clock panel with up to 12 time zones and analog clock indicators.
- Global show/hide shortcut (`Alt+Shift+S`) and per-site visibility control.
- Safe dock engine that classifies page layout patterns from runtime geometry
  rather than hard-coding site names.
- No remote executable code, analytics, advertising, accounts, or external
  runtime dependencies.

## Install locally

### Microsoft Edge

1. Download or clone the repository.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository root containing `manifest.json`.

### Google Chrome

1. Download or clone the repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository root containing `manifest.json`.

Browser-owned pages such as `edge://settings` and `chrome://extensions` do not
allow ordinary content scripts, so Statusline does not appear there. For local
`file://` pages, enable file URL access for the extension if needed.

## Layout

Statusline has three stable regions:

```text
[ shortcuts + ]        [ current address ]        [ status / actions / clock ]
```

The shortcut dock stays at the far left. Saved shortcuts can be reordered by
click-and-drag; the `+` manager remains last. The address field stays centered
when space allows and narrows instead of overlapping either side.

## Shortcuts

Click `+` to add a name and an HTTP/HTTPS URL, or use the current page. Clicking
a saved shortcut opens a compact top-level browser popup window. Reopening the
same shortcut focuses the existing window during the browser session.

Shortcut windows share the current browser profile. Statusline does not create a
separate persistent cookie jar per shortcut. Use a separate browser profile if
you need an independently signed-in persistent session.

## Capture

The Capture action offers:

- **Visible area** — captures the current viewport.
- **Select area** — drag a rectangle and capture only that region.
- **Scroll down** — select a region and stitch captures from the current scroll
  position to the end of its scroll container.
- **Full page** — stitch the main document from top to bottom.

Statusline hides its own UI during capture and restores the original scroll
position afterwards. Very large stitched images are rejected before exceeding a
safe single-canvas size.

## Clock and world clocks

Click the date/time widget to edit the primary format and IANA time zone and to
manage world clocks.

Supported format tokens include:

`YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `M`, `DD`, `D`, `dddd`, `ddd`, `HH`, `H`,
`hh`, `h`, `mm`, `m`, `ss`, `s`, `A`, and `a`.

Literal text can be enclosed in square brackets, for example:

```text
YYYY-MM-DD [at] HH:mm
```

## Safe dock engine

Chromium extensions cannot add native bottom browser chrome. Statusline therefore
uses a page-injected Shadow DOM surface and a conservative runtime dock engine.

The engine classifies layout behavior instead of branching on hostnames:

- document-scroll pages preserve the page's `html`/`body` height, overflow,
  transforms, sticky headers, drawers, and document scrollport;
- viewport applications are identified from geometry, overflow ownership, and
  nested scroll containers, including app shells several DOM levels below
  `body`;
- full-height edge rails such as side navigation are detected geometrically;
- fixed/sticky bottom controls and fixed portal surfaces are adjusted only when
  their current bounds intersect the Statusline dock;
- SPA subtree changes trigger a debounced re-evaluation;
- ambiguous layouts fall back to the less invasive document strategy.

Turn off **Dock below page content** in Settings to use overlay mode instead.

## Architecture

- `content/statusline.js` renders the status bar and in-page UI inside a Shadow
  DOM and implements page-layout detection.
- `background.js` owns privileged browser operations such as popup shortcut
  windows, zoom, visible-tab capture, tab enumeration/grouping, Split View
  feature detection, and the global command.
- `shared/settings.js` owns defaults and settings normalization.
- `popup/` provides quick controls.
- `options/` provides full settings.
- `chrome.storage.sync` stores preferences and shortcuts;
  `chrome.storage.session` is used only for transient shortcut-window IDs when
  available.

There is no framework or build step. The repository root is directly loadable as
an unpacked extension.

## Development and validation

Requirements for the Node validation tests: Node.js 22 or compatible.

```bash
npm test
```

For the browser-runtime regression suite, install Python Playwright and a
Chromium browser, then run:

```bash
python tests/render_runtime.py
```

The runtime suite exercises the real content script against mocked extension
APIs and covers document scrolling, viewport applications, side rails, portal
surfaces, shortcuts, capture menus, tab pickers, clocks, and dock boundaries.

## Publishing

See [docs/PUBLISHING.md](docs/PUBLISHING.md) and
[docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md).

Public links:

- Privacy policy: [PRIVACY.md](PRIVACY.md)
- Support: [SUPPORT.md](SUPPORT.md)

## License

Apache License 2.0.
