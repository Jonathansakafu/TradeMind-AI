import { Capacitor, registerPlugin } from "@capacitor/core";
import { domToBlob } from "modern-screenshot";
import { downloadBinaryFile } from "./nativeDownload";

// Copy a chart or screenshot as an image (added 2026-10-15).
//   browsers: Clipboard API (PNG) -- paste into WhatsApp Web, Gmail, Word...
//   Android app: native ImageClipboard plugin (real image on the clipboard)
// If copying isn't possible, the picture is shared instead (share sheet on
// the phone, download in a browser). Returns "copied" | "shared".
const isAndroid = Capacitor.getPlatform() === "android";
const ImageClipboard = isAndroid ? registerPlugin("ImageClipboard") : null;

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Clipboards take PNG only: convert JPG / WEBP screenshots first.
async function asPng(blob) {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function blobFromUrl(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("couldn't load the picture");
  return res.blob();
}

export const blobFromElement = (el, background) =>
  domToBlob(el, { backgroundColor: background, scale: 2, type: "image/png" });

// getBlob: () => Promise<Blob>. Called inside the click, so Safari keeps
// the permission (ClipboardItem takes the promise directly).
export async function copyImage(getBlob, name = "TradeMind-chart") {
  if (isAndroid) {
    const png = await asPng(await getBlob());
    const b64 = await toBase64(png);
    try {
      await ImageClipboard.copyImage({ base64: b64 });
      return "copied";
    } catch {
      await downloadBinaryFile(`${name}.png`, b64, "image/png"); // share sheet
      return "shared";
    }
  }
  if (navigator.clipboard?.write && typeof window.ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": getBlob().then(asPng) })]);
      return "copied";
    } catch { /* fall through to download */ }
  }
  const png = await asPng(await getBlob());
  await downloadBinaryFile(`${name}.png`, await toBase64(png), "image/png");
  return "shared";
}
