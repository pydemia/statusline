# Store submission copy

This file contains reviewer-facing copy for Statusline v1.0.0. Keep these
statements aligned with the packaged code and the public privacy policy.

## Product

**Name:** Statusline

**Short description:**
A configurable Chromium status bar with shortcuts, capture tools, tab actions,
zoom, scroll position, and world clocks.

## Full description

Statusline adds a configurable status bar to ordinary web pages in Microsoft
Edge and Google Chrome. It is intended for users who prefer persistent browser
status information and quick actions similar to the status bar workflow found
in Vivaldi and traditional desktop browsers.

The bar can be placed at the top or bottom and uses a compact two-zone layout:
user-created shortcuts at the left and status/actions at the right. The center
is intentionally left flexible so action controls remain available in narrow windows. Built-in features include hovered-link
targets, viewport size, a scrollbar-style reading-position indicator, editable
page zoom, visible/selected/scrolling/full-page capture, tab Stack and Tile
actions, a configurable date/time display, and a world-clock panel.

Saved shortcuts open compact top-level browser windows. They use the current
browser profile and normal first-party authentication behavior rather than
embedding destination sites in iframes.

Statusline includes a conservative dock engine that detects document-scroll,
viewport-application, side-rail, fixed-control, and portal layout patterns from
runtime geometry. It does not rely on site-specific hostname rules.

Statusline has no remote executable code, analytics, advertising, account
system, or Statusline-operated backend. Page-derived status information and
capture processing remain local to the browser. Preferences and shortcut
metadata are stored with Chromium extension storage.

## Single purpose

Provide a persistent, configurable browser status bar with local page status,
quick browser actions, user-configured shortcut windows, and clocks.

## Permission and access justification

### `storage`

Stores Statusline preferences, per-site visibility, shortcut names and URLs,
clock settings, and widget order. `chrome.storage.session` may temporarily store
an open shortcut window ID so a second click can focus it. Statusline does not
send these values to a Statusline server.

### Ordinary web-page access / `<all_urls>`

Statusline is designed to appear across ordinary HTTP/HTTPS pages. The content
script needs page access to render the persistent status bar and derive local
values used by enabled widgets, including the current URL/hostname, hovered-link
target, scroll geometry, viewport size, and optional selected-text length.

Broad host access is also used for user-initiated visible-tab capture. Captured
pixels are processed locally and downloaded to the user's device; Statusline
does not upload captures.

### `file://`

The manifest includes file URLs so users can optionally enable Statusline on
local files. Chromium requires the user to explicitly allow file URL access in
the extension's settings. This is not required for normal HTTP/HTTPS use.

## Remote code

No. Statusline does not download or execute remotely hosted extension code.
User-created shortcuts navigate to ordinary web pages in top-level browser
windows; destination web content is not extension code.

## Data practices

Statusline does not collect or transmit analytics, advertising identifiers,
browsing history, page contents, screenshots, credentials, or user profiles to
a Statusline-operated service.

The extension processes limited page-local information required by enabled
widgets and explicit actions. Preferences and shortcut metadata are stored using
browser extension storage. Saved shortcut destinations connect directly to the
user-selected site and are governed by that site's own privacy policy.

Privacy policy:
https://github.com/pydemia/statusline/blob/main/PRIVACY.md

Support:
https://github.com/pydemia/statusline/issues

Homepage:
https://github.com/pydemia/statusline

## Certification / review notes

1. Install the extension and open an ordinary HTTP or HTTPS page.
2. Statusline appears at the bottom by default.
3. Hover a link to display its target.
4. Observe the `SCROLL` indicator; its thumb follows the active document or
   nested scroll container without showing a second percentage.
5. Type an exact zoom percentage or use `-` / `+`.
6. Open Capture and test Visible area or Select area.
7. Open Tile or Stack and select tabs in the in-page picker. Stack works where
   Chromium tab grouping is available. Tile reports an unsupported state if the
   browser does not expose the native Split View extension API.
8. Click `+`, add an HTTP/HTTPS shortcut, then open it. It appears in a compact
   top-level browser window and follows normal authentication redirects.
9. Click the date/time widget to edit the primary clock and add world clocks.
10. Open Settings to adjust theme, height, dock mode, widget visibility, and
    order.
11. Browser-owned pages such as `edge://*` and `chrome://*` do not allow
    ordinary content scripts; Statusline intentionally does not appear there.
