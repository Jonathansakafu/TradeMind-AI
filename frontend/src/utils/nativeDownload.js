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

// Binary counterpart for non-text files (PDFs) -- downloadFile above always
// writes UTF8 text, which corrupts binary data. base64Data is the file's
// content with no "data:...;base64," prefix (strip it first if it came
// from a data URI, e.g. jsPDF's doc.output("datauristring")).
export async function downloadBinaryFile(filename, base64Data, mimeType = "application/octet-stream") {
  if (!Capacitor.isNativePlatform()) {
    const byteChars = atob(base64Data);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // No `encoding` option -- Capacitor Filesystem's default is base64, which
  // is exactly what we already have, unlike the UTF8 text path above.
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64Data,
    directory: Directory.Cache,
  });

  await Share.share({ url: uri });
}
