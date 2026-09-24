// The Android app is sideloaded (not Play Store), so it has zero built-in
// auto-update mechanism -- every fix pushed to main sits on GitHub as a
// freshly-built APK that nobody actually gets until they manually
// re-download and reinstall it. This compares the APK's own baked-in build
// commit (VITE_APP_BUILD_SHA, set only in .github/workflows/android-release.yml)
// against main's actual latest commit via GitHub's public API, so the app
// can tell the user an update exists instead of them silently running
// stale code indefinitely.
export async function checkForUpdate() {
  const builtSha = import.meta.env.VITE_APP_BUILD_SHA;
  if (!builtSha) return null; // web build, or a local/dev build -- nothing to compare

  try {
    const res = await fetch(
      "https://api.github.com/repos/jonathansakafu/TradeMind-AI/commits/main",
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const latestSha = data.sha;
    if (latestSha && latestSha !== builtSha) {
      return { latestSha, builtSha };
    }
    return null;
  } catch {
    // Offline, GitHub API rate-limited, etc. -- fail quiet, never block the
    // app over an update check.
    return null;
  }
}

export const ANDROID_APK_URL =
  "https://github.com/jonathansakafu/TradeMind-AI/releases/download/android-latest/trademind-ai.apk";
