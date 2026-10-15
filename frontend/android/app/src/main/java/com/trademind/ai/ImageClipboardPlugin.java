package com.trademind.ai;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * Copies a picture (chart, screenshot) to the Android clipboard as a real
 * image (added 2026-10-15) -- @capacitor/clipboard only copies text, so a
 * pasted chart arrived as a long "data:image..." string. The PNG is saved in
 * the app's cache and shared through the existing FileProvider; apps that
 * read the clipboard (WhatsApp, Gmail, Notes, Gboard's clipboard) get the
 * image.
 */
@CapacitorPlugin(name = "ImageClipboard")
public class ImageClipboardPlugin extends Plugin {

  @PluginMethod
  public void copyImage(PluginCall call) {
    String base64 = call.getString("base64");
    if (base64 == null || base64.isEmpty()) {
      call.reject("No image");
      return;
    }
    try {
      int comma = base64.indexOf(',');
      if (base64.startsWith("data:") && comma > 0) base64 = base64.substring(comma + 1);
      byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
      Context ctx = getContext();
      File dir = new File(ctx.getCacheDir(), "clipboard");
      if (!dir.exists()) dir.mkdirs();
      // One file per copy, so a paste still works after the next copy.
      File[] old = dir.listFiles();
      if (old != null && old.length > 10) for (File f : old) f.delete();
      File file = new File(dir, "trademind-" + System.currentTimeMillis() + ".png");
      try (FileOutputStream out = new FileOutputStream(file)) {
        out.write(bytes);
      }
      Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
      ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
      ClipData clip = ClipData.newUri(ctx.getContentResolver(), "TradeMind chart", uri);
      cm.setPrimaryClip(clip);
      call.resolve();
    } catch (Exception e) {
      call.reject("Couldn't copy the image: " + e.getMessage());
    }
  }
}
