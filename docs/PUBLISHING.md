# Publishing Statusline

Statusline uses one Manifest V3 package for Microsoft Edge and Google Chrome.
The runtime source does not need separate browser forks. Store listings and
submission accounts are managed independently by each store.

## Release package

The store ZIP should contain only the extension runtime files at its root:

- `manifest.json`
- `background.js`
- `content/`
- `shared/`
- `popup/`
- `options/`
- `icons/`

Do not wrap those files in an extra top-level directory inside the ZIP.

## Microsoft Edge Add-ons

Use Partner Center's Edge program. Upload the ZIP, complete availability,
properties, privacy declarations, store listing details, certification notes,
and submit for review.

Recommended public URLs:

- Homepage: https://github.com/pydemia/statusline
- Support: https://github.com/pydemia/statusline/issues
- Privacy: https://github.com/pydemia/statusline/blob/main/PRIVACY.md

## Chrome Web Store

Use the Chrome Web Store Developer Dashboard. Complete Store listing, Privacy,
and Distribution before submitting for review.

Recommended public URLs:

- Homepage: https://github.com/pydemia/statusline
- Support: https://github.com/pydemia/statusline/issues
- Privacy: https://github.com/pydemia/statusline/blob/main/PRIVACY.md

Chrome requires at least one store screenshot and a store icon. Keep listing
claims consistent with the actual packaged version and privacy declarations.

## Privacy declarations

Statusline has no analytics, advertising, account system, or Statusline-operated
backend. It processes page-local state for enabled status widgets and explicit
capture actions, and stores user preferences and shortcut metadata in extension
storage. Shortcut windows navigate directly to user-selected websites.

## Versioning

Increase `manifest.json` and `package.json` versions together before uploading an
update. A store update must use a version greater than the currently published
version.
