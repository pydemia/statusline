# Changelog

## 0.10.2

- Added generic full-height edge-rail docking for left/right side navigation,
  drawers, and secondary columns that are not mounted as fixed portal roots.
  Tall edge columns now share the Statusline boundary even when they are
  absolute or viewport-sized children of an application shell.
- Fixed document-scroll over-reservation. Existing top/bottom page padding is
  now reused instead of always adding another full Statusline height, which
  removes the artificial extra scroll tail seen on otherwise simple pages.
- Added runtime regressions for a nested full-height side navigation rail and
  for document layouts that already contain bottom spacing.

## 0.10.1

- Fixed multi-surface docking where a primary conversation frame and an
  independently portal-mounted side panel used different viewport ownership.
- Edge controls are now adjusted only when their current geometry actually
  intersects the Statusline dock, avoiding a second offset after an ancestor
  shell has already reflowed.
- Full-height and tall fixed portal surfaces are docked by shrinking their
  fixed viewport (`top`/`bottom`/height) instead of adding internal padding,
  so absolutely positioned side panels and footers also stop above Statusline.
- Large portal roots are processed before descendants and descendant geometry
  is re-read before any additional correction.
- Added a split-viewport regression fixture with a main composer and a
  separately mounted side-panel portal.

## 0.10.0

- Replaced site-specific dock classification with a generic runtime layout-pattern engine.
- Removed hostname and application-generator checks from dock behavior.
- Detects viewport application shells recursively from sampled layout ancestry instead of only direct `body` children.
- Distinguishes document scrolling from large nested scroll ownership using geometry and overflow state.
- Samples a bottom/top edge band at multiple depths so inset controls do not need to touch the exact viewport edge.
- Large fixed portal roots receive internal edge padding; smaller fixed/sticky controls are inset above the Statusline.
- Re-evaluates dock targets after nested SPA DOM mutations with a debounced refresh.
- Added generic document-scroll, viewport-app, and deeply nested viewport-app regression fixtures.

## 0.9.0

- Replaced the structural `html`/`body` viewport rewrite with a compatibility-safe dock strategy.
- Conventional document pages, including LearnUs/Moodle, now reserve content space only with additive body padding and scroll padding; Statusline no longer forces `html`/`body` height, overflow, or transforms.
- Viewport-style web apps such as ChatGPT keep ownership of `html` and `body`; Statusline constrains only the detected full-height app shell and insets small bottom-fixed controls that would otherwise overlap the bar.
- Added Moodle detection (`meta[name=generator]`) plus a LearnUs host safeguard.
- Style restoration now avoids overwriting site-side inline-style changes made while Statusline is active.
- Added rendered regression fixtures for both a LearnUs/Moodle document layout and a ChatGPT-style full-height SPA.

## 0.8.0

- Replaced iframe-based Shortcut panels with top-level browser popup windows.
- Shortcut windows now use the current browser profile/session, so authentication redirects and first-party storage behave like normal browsing.
- Reuses and focuses an existing Shortcut window within the browser session instead of opening duplicate windows.
- Removed iframe-specific Shortcut rendering and messaging.

## 0.7.6

- Replace the heuristic docked inset with a structural docked page viewport.
- Mount the Statusline host under `<html>` instead of inside `<body>`, then
  bound `<body>` to the viewport area above Statusline.
- Make `<body>` a containing block for page-owned `position: fixed` controls,
  so SPA composers and body-level portals stop above Statusline.
- Reapply the structural dock when an SPA replaces `<body>`.
- Add regression coverage that verifies body, `100vh` app shell, fixed composer,
  and fixed portal controls all end before the Statusline row.

## 0.7.5

- Fix the remaining docked-layout overlap on SPA pages whose bottom controls
  use `position: fixed`.
- Make the detected viewport application shell a containing block for fixed
  descendants while docked, so controls such as ChatGPT's composer end above
  Statusline instead of staying pinned to the browser viewport.
- Recompute the docked inset on viewport resize.
- Add a regression fixture with a fixed bottom composer inside a `100vh` app
  shell; the fixture reproduces the v0.7.4 failure and passes in v0.7.5.

## 0.7.4

- Fix docked layout detection on full-height SPA pages such as ChatGPT.
- Detect the primary viewport shell before applying body padding.
- Constrain `100vh` / large `min-height` application roots to the viewport area
  above Statusline so the bar no longer covers bottom application controls.
- Add a regression fixture using a `100vh; min-height: 100vh` SPA shell.

## 0.7.3

- Changed the default page layout from overlay to docked/reserved mode.
- Added migration so existing installations adopt docked mode automatically.
- Improved full-height SPA handling by shrinking the primary viewport shell when needed.
- Reapplies reserved layout after SPA body replacement/remount events.

## 0.7.2

- Fixed intermittent disappearance on SPA-style sites by mounting the Statusline
  host under `document.body` instead of as a direct child of `<html>`.
- Added a lightweight mount guard that reattaches the existing Statusline host
  when an application shell removes it or replaces `<body>`.
- Re-checks the mount after BFCache restores, tab visibility changes,
  prerender activation, and Navigation API transitions when available.
- Keeps the center address field synchronized when SPA navigation changes the
  URL without a traditional page load.
- Added rendered regression tests for direct host removal and complete body
  replacement.

## 0.7.1

- Added a distinct address-field surface: white in light mode and a separate dark input surface in dark mode.
- Added 14px horizontal inset to both outer edges of the entire status bar.
- Kept the address field borderless and preserved the existing center/right/left layout behavior.

## 0.7.0

- Renamed the user-facing floating-panel feature to **Shortcuts** while
  preserving the existing `panels` storage key for backward compatibility.
- Fixed shortcut-manager text entry stability by isolating extension UI events
  from host-page handlers and preserving form focus/caret across
  storage-driven rerenders.
- Added click-and-drag reordering for shortcut icons. Order is persisted to
  synced extension storage and the add button remains last.
- Removed center address-field divider lines and focus border so the address
  field reads as a clean inline browser surface.
- Removed the page-load-time widget from the status bar and settings because
  it was ambiguous and did not serve the primary workflow.

## 0.6.0 - 2026-09-21

- Removed the Page title widget so the centered address field is no longer
  followed by a duplicate page-title label in the right-side function area.
- Made the date/time widget clickable and anchored its Clock panel directly to
  the widget.
- Added in-panel Format and IANA Time zone inputs for the primary clock.
- Added persistent world clocks with add/remove controls and up to 12 zones.
- Added analog clocks as the leftmost element of the primary clock section and
  every world-clock row.
- Made token-based date/time formatting time-zone aware instead of depending on
  the operating-system local zone.
- Added clock/time-zone migration, validation, Settings support, and rendered
  regression coverage for the clock panel and world-clock list.

## 0.5.0 - 2026-09-21

- Split the status bar into three fixed semantic zones: floating-panel shortcuts
  at the far left, a viewport-centered editable address field, and all remaining
  information/actions aligned at the far right.
- The center address field now shrinks before overlapping the left or right
  zones, so long URLs are intentionally clipped instead of pushing the bar to
  one side.
- Added visible dividers between the left, center, and right zones.
- Floating action surfaces now open directly above their triggering icon (or
  below it when the status bar is placed at the top), with viewport-edge
  clamping. Capture, Tile, Stack, floating-panel shortcuts, and the panel
  manager use the same anchored behavior.
- Developer Tools feedback is also anchored to its action icon.
- Locked widget placement semantics in Settings while preserving right-side
  widget ordering.
- Added browser-rendered regression checks for three-zone placement and anchored
  Capture/Tile popups.

## 0.4.0

- Moved the floating-panel dock to the far-left edge and kept the **+** manager
  button after all saved panel shortcuts.
- Replaced the compact host label with a wider editable current-address field.
- Added Capture modes for visible area, box selection, scrolling selection, and
  full-page stitched PNG capture.
- Made the scroll indicator follow nested scroll containers as well as the main
  document, with a thumb whose position and size change with scroll state.
- Made the zoom percentage editable for direct 25–500% entry.
- Added a token-based date/time format setting and legacy clock migration.
- Added browser-rendered regression coverage for panel placement, address UI,
  nested scroll tracking, editable zoom, capture menu, visible/selection/scroll
  and full-page capture flows.

## 0.3.0 - 2026-09-21

- Replaced the scroll percentage with a dedicated `SCROLL` indicator and a
  vertically moving scrollbar thumb, removing the duplicate percentage beside
  page zoom.
- Changed Tile and Stack from browser-tab-strip selection to an in-page tab
  picker. The current tab is preselected and additional tabs can be chosen
  without making Statusline disappear.
- Added floating panel shortcuts to the status bar.
- Added a floating panel manager with add, remove, and **Use current page**
  actions.
- Saved panel shortcuts open resizable overlay panels over the current page and
  provide **Open in tab**, **Remove**, and **Close** controls.
- Panel URLs are limited to HTTP/HTTPS and are normalized before persistence.
- Preserved website framing protections; sites that reject iframe embedding
  are not bypassed.

## 0.2.0 - 2026-09-21

- Increased the default status bar height from 26 px to 36 px and expanded the
  configurable range to 28-52 px.
- Added clickable Capture, Developer Tools, Tile, and Stack action widgets.
- Capture saves the visible active-tab viewport as a PNG without remote
  services.
- Stack groups two or more selected browser tabs.
- Tile feature-detects the native Split View extension API and explains when
  the current browser build does not expose it.
- Added in-bar action feedback and visible initialization errors in DevTools.

## 0.1.0 - 2026-09-21

- Initial local release.
- Configurable top/bottom status bar.
- Link status, title, host, load time, selection, viewport, scroll, zoom and
  clock widgets.
- Widget reorder and side assignment.
- Global and per-site visibility controls.
