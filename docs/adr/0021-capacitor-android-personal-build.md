# ADR 0021: Capacitor Android personal build

- Status: Accepted for personal distribution; not a supported product platform
- Date: 2026-11-21
- Context: owner request for an installable Android build
- Related: ADR 0022, `PRD.md` platforms, `ROADMAP.md`
- Product conflict: the PRD lists Web and PWA only; this ADR records a
  personal, unsupported Android build without changing the product platform

## Context and problem

OpenNest is a local-first web application. The approved PRD defines Web and
Progressive Web App as the platforms. The owner asked for an Android APK for
personal daily use because the PWA is not a sufficient installation surface on
their device.

A native Kotlin rewrite would duplicate the product and its data layer. A Trusted
Web Activity would still depend on a hosted PWA, Chrome, and a network, which
conflicts with the offline-first requirement. The project needs a bundled,
installable wrapper that runs the existing web application and can be distributed
as a sideloaded APK without changing the web product's supported surface.

## Goals

- Produce a release-signed APK that installs on Android and works offline.
- Reuse the existing web application, domain services, storage, and tests.
- Keep the web and PWA build as the primary supported product.
- Keep the Android build reproducible from this repository and CI.
- Share notes and files through the Android share sheet.
- Respect Android safe areas, system bars, keyboard resizing, and back behavior.
- Avoid network cleartext and avoid enabling Android backup of workspace data.
- Keep signing keys and passwords out of the repository and logs.

## Non-goals

- Google Play distribution.
- iOS, desktop, or a native Android UI.
- Auto-update, background sync, push notifications, widgets, or deep links.
- A separate Android data model or a server dependency.
- Moving the web application's browser data into the APK automatically.
- Claiming Stage E completion, E2EE, AI confidentiality, extension sandbox
  guarantees, or MCP security for the Android build.
- A hosted APK distribution service.

## Decision

### Wrapper

Use Capacitor 8 with a committed Android project in `apps/mobile`. The WebView
loads a bundled, statically exported copy of `apps/web` from `https://localhost`.
The Android scheme is HTTPS so browser APIs that require a secure context keep
working. The service worker is disabled inside the APK because the bundle is
already local and a service worker adds an unnecessary update layer.

The package id is `app.opennest`. Debug builds add the `.debug` suffix so a debug
APK can coexist with a release APK. The minimum SDK is 24; the target SDK follows
the current Android requirement at build time (36 for the first build).

### Routing and static export

Capacitor serves static files. Entity detail views therefore use query
parameters on static pages, as recorded in ADR 0022. The static export sets
`output: "export"`, disables image optimization, and writes to `apps/web/out`.
The web build keeps server headers, including the Content Security Policy; the
static build carries an equivalent CSP meta tag in the document.

### Native behavior

- System bar icon color follows the app theme through Capacitor SystemBars.
- Safe-area insets are applied to the shell, header, main content, and bottom
  navigation.
- Android back closes an open dialog, then navigates history, then exits.
- Export actions write a temporary file to the app cache and open the Android
  share sheet. The existing FileProvider paths cover the cache directory.
- PDF preview is disabled inside the APK; the file is exported and shared.
- The offline full-page-navigation fallback is disabled inside the APK because
  client navigation already works from the local bundle.

### Security and privacy

- `android.allowMixedContent` is false.
- Cleartext traffic is disabled in the manifest.
- Android backup is disabled.
- The manifest requests only the INTERNET permission.
- AI providers must use HTTPS. Local HTTP AI endpoints are unsupported in this
  build because enabling mixed content would weaken the whole WebView.
- The release keystore is generated outside the repository. Passwords are stored
  outside the repository and supplied to CI through repository secrets. Losing
  the keystore prevents in-place updates.

### Distribution

The APK is attached to a GitHub pre-release for personal sideloading. It is not
the supported product surface and is not an app-store release. Updates are
manual. Any public release notes must identify the build as a personal,
unsupported Android package and link to the source commit.

### Implementation status

Implemented on 2026-11-21:

- `apps/mobile` contains the Capacitor configuration, the committed Android
  project, and generated launcher and splash resources.
- `npm run build:static` and `npm run sync:android` produce the assets consumed
  by Gradle.
- `.github/workflows/android.yml` builds a debug APK and, when signing secrets
  are present, a signed release APK. It verifies the release signature with
  `apksigner`.
- The release keystore lives outside the repository at
  `~/.opennest-signing/opennest-release.jks`; CI receives it as a secret.
- Android smoke testing on a physical device, including share targets, process
  death, keyboard resizing, and update-over-install behavior, is still required.

## Alternatives considered

1. Native Kotlin or Compose rewrite. Rejected because it duplicates the UI,
   storage, domain services, and tests.
2. Trusted Web Activity. Rejected because it requires a hosted PWA, Chrome, and
   network access for first install and updates.
3. Capacitor with a remote `server.url`. Rejected because it loses offline-first
   behavior and adds a hosted dependency.
4. Capacitor with cleartext mixed content enabled. Rejected for the first build
   because it weakens every page in the WebView; a future opt-in would need a
   separate security decision.
5. A separate Android repository. Rejected because the app and wrapper must stay
   versioned together.

## Consequences

- Four detail routes become query-parameter views, and old dynamic URLs redirect.
- Per-detail metadata is reduced; page-level metadata remains.
- The Android project adds Gradle, SDK, and signing maintenance.
- CI must build the static export, sync Capacitor, and verify the APK signature.
- Native behavior needs device smoke tests that browser tests cannot replace.
- The Android build can break independently of the web build when Capacitor,
  Android SDK, or WebView behavior changes.
- The PRD's supported platforms remain Web and PWA. The README must describe this
  build as an unsupported personal package.
- The Stage D security review, external cryptographic review, and E2EE claim gate
  remain open and are not satisfied by this wrapper.
