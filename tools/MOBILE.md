# Mobile verification

Run `npm ci`, `npx playwright install chromium`, start a static server on port
8765 from the repository root, then run `npm run test:mobile`. Set TEST_URL to
test a deployed build. EDGE_PATH optionally selects an installed Edge executable.

The smoke test covers 360/390 px portrait, landscape and desktop, search,
tabs, filter controls, installation help, overflow, service-worker activation
and icon availability. A screenshot is saved in the parent directory.
Actual OS installation and keyboard behavior still require a physical phone.

`npm run test:route-mobile` tests an actual map popup: add a stop, open the
fullscreen route automatically, add a second stop, check navigation, preview
all stops on the map and return without losing the route. It also checks that
the preview extent contains the complete route's bounding box.

Brand: original VESNA `g#logo` vector extracted from https://www.vesna.legal/
on 2026-10-19. Geometry is unchanged; background cutouts match the application
tile. Run `node tools/brand-icons.cjs` to regenerate the PNG installation icons.
The install banner identifies a web application, not a Google Play listing.

Route-flow checks now cover navigation locked until optimization, invalidation
after mode changes, discarded stale calculations, a drag-to-map gesture,
popup retention during map panning, platform installation instructions and a
mocked native install prompt. OS installation itself requires device testing.
Apple's iPhone installation requires the Share → Add to Home Screen flow;
the page cannot add an icon without system/user confirmation.

PWA installation requires HTTPS (localhost is allowed for tests). Offline routing
and map tiles are not provided. The service worker only caches same-origin assets
and tries the network first. Bump its cache name when changing the cached shell.

The existing `npm test` currently fails in the office-link fixtures; the identical
failure was reproduced on base commit 7c2c4d7 before mobile changes.

Rollback: revert the mobile commit and redeploy GitHub Pages; preserve or replace
sw.js with a cleanup worker if retiring the PWA, so existing installations update.
