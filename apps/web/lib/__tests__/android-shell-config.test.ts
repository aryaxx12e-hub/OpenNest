import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const androidMain = resolve(process.cwd(), "apps/mobile/android/app/src/main");

function readAndroidFile(path: string): string {
  return readFileSync(resolve(androidMain, path), "utf8");
}

describe("Android shell launch theme", () => {
  it("dismisses the splash screen and switches to the app theme", () => {
    const styles = readAndroidFile("res/values/styles.xml");
    const activity = readAndroidFile("java/app/opennest/MainActivity.java");

    expect(styles).toContain(
      '<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>'
    );
    expect(styles).toContain(
      '<item name="windowSplashScreenBackground">@color/splashBackground</item>'
    );
    expect(styles).toContain(
      '<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>'
    );
    expect(activity).toContain("SplashScreen.installSplashScreen(this);");
  });
});
