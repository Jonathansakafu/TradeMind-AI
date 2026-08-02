import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Blob + <a download> silently fails inside a Capacitor WebView (no
// filesystem/download UI), so native platforms write to cache and hand
// off to the share sheet instead. Web keeps the normal browser download.
export async function downloadFile(filename, content, mimeType = "text/plain") {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  await Share.share({ url: uri });
}
