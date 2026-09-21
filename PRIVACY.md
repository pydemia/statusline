# Statusline Privacy Policy

Last updated: 2026-09-21

Statusline is a browser extension that adds a configurable status bar, browser
actions, shortcuts, capture tools, and clocks to Chromium-based browsers.

## Data processed locally

Statusline may read limited information from the page that is currently open in
order to provide enabled features. Depending on the widgets and actions you use,
this can include:

- the current page URL, hostname, and title;
- the target URL of a link while you hover it;
- scroll position and viewport dimensions;
- the length of selected text, when that widget is enabled;
- visible page pixels when you explicitly use a capture command;
- shortcut names and URLs that you explicitly save;
- extension preferences such as theme, clock format, time zones, widget order,
  and per-site visibility settings.

## Storage

Extension preferences and saved shortcuts are stored with Chromium extension
storage (`chrome.storage.sync`). Browser session state used to focus an already
open shortcut window can be stored temporarily with `chrome.storage.session`.

Statusline does not operate a server and does not upload these settings to a
Statusline service. Browser vendors may synchronize extension settings according
to the synchronization features and account settings of the browser itself.

## Network activity

Statusline does not send page contents, browsing history, captures, analytics,
or telemetry to a Statusline-operated service.

When you open a saved shortcut, the browser connects directly to the URL you
selected. That website is governed by its own privacy policy and browser
security rules.

## Capture

Capture commands run only after explicit user interaction. Captured images are
created locally in the browser and downloaded to the user's device. Statusline
does not upload captured images.

## Permissions

Statusline requests broad ordinary-web-page access because its persistent status
bar is designed to work across sites and because visible-tab capture requires
page access. Statusline uses that access only for extension features described
above.

## Remote code, analytics, and advertising

Statusline does not execute remotely hosted extension code. It contains no
analytics, advertising SDK, tracking SDK, or Statusline account system.

## Changes

If Statusline's data practices change, this policy will be updated before a
release that introduces the changed behavior.

## Contact

For privacy questions or bug reports, use the Statusline GitHub repository:
https://github.com/pydemia/statusline
