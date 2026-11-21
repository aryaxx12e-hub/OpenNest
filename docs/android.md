# Android personal build

OpenNest's Android package is an owner-maintained Capacitor wrapper around the
same web application. It is a personal, unsupported build, not the supported
OpenNest product surface and not an app-store release. The supported platforms
remain the web application and PWA.

The decision and trade-offs are recorded in
[ADR 0021](./adr/0021-capacitor-android-personal-build.md).

## What the APK contains

- A static export of `apps/web` bundled into the APK. The first launch does not
  need a network connection.
- Capacitor's local server at `https://localhost`, so secure-context browser
  APIs keep working.
- No service worker. Assets are already local; the app disables registration and
  unregisters any pre-existing worker.
- Native export through the Android share sheet. Exports are written to the app
  cache before sharing.
- Edge-to-edge layout with safe-area handling, SystemBars theme synchronization,
  and Android back handling.

The package id is `app.opennest`. Debug builds use `app.opennest.debug` and can be
installed beside a release build.

## Requirements

Building the Android project needs:

- Node.js 24 and npm.
- JDK 21.
- Android SDK platform 36 and build-tools 36.0.0.
- Gradle through the committed wrapper. Do not install a separate Gradle.

The reference Termux environment has JDK 21 but no Android SDK, so it cannot
build the APK locally. Use the GitHub Actions `Android` workflow, or a desktop
machine with the SDK installed. Running the web application itself from Termux is
covered in `docs/run-locally.md`.

## Build from source

```bash
npm ci
npm run sync:android
cd apps/mobile/android
./gradlew assembleDebug
```

The debug APK is written to:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run sync:android` runs the static export and then Capacitor sync. Do not
run `cap sync` without a fresh static build if the web source changed.

## Release signing

The release keystore is generated outside the repository. The reference owner
keystore is at:

```text
~/.opennest-signing/opennest-release.jks
```

Its password is stored beside it in `~/.opennest-signing/password.txt`, with
directory and file permissions restricted to the owner. Back up both files
somewhere safe. Losing the keystore means future APKs cannot update an installed
release in place.

CI receives the keystore and passwords as repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The workflow writes the decoded keystore to
`apps/mobile/android/app/opennest-release.jks` and a gitignored
`apps/mobile/android/keystore.properties`. It then builds and verifies the
release APK with `apksigner`. Neither file is committed.

`versionCode` comes from `OPENNEST_VERSION_CODE` (GitHub run number in CI).
`versionName` comes from `OPENNEST_VERSION_NAME`; the workflow strips the leading
`v` from a tag and otherwise uses the current personal-build version.

## Install and update

Install a release APK on the phone by opening it from the Downloads folder, or
with ADB:

```bash
adb install -r OpenNest-0.1.0-beta.4.apk
```

Android may ask you to allow installs from the app that opens the APK. That
permission applies to the file manager or browser, not to OpenNest.

Updates require the same signing key and a higher `versionCode`. Install the new
APK over the old one; uninstalling first deletes the app's IndexedDB workspace.
Export a backup before changing builds, clearing app data, or uninstalling.

## Network behavior

- Cleartext HTTP is disabled for the WebView and in the manifest.
- HTTP AI providers, including local Ollama endpoints, are unsupported in this
  build. Use an HTTPS provider with CORS support.
- The app requests only the `INTERNET` permission. It does not request storage
  permissions; imports and exports use the system document picker and share
  sheet.

## Known limitations

- There is no in-app update mechanism. Updates are manual sideloads.
- PDF preview is replaced by export and share inside the APK.
- The browser service worker update flow is intentionally disabled.
- Android-specific behavior still needs device smoke tests. Browser E2E tests do
  not replace testing back navigation, keyboard resizing, share targets, or
  process death.
- The release is unreviewed software. The Stage D security review, external
  cryptographic review, and E2EE claim gate remain open. No security or
  confidentiality claim is added by packaging the web app for Android.
