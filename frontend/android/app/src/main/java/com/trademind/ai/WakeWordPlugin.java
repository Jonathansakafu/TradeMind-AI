package com.trademind.ai;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** JS bridge for the "Hey TradeMind" wake word (see WakeWordService). */
@CapacitorPlugin(
    name = "WakeWord",
    permissions = {
      @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
      @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
    })
public class WakeWordPlugin extends Plugin {

  @Override
  public void load() {
    handleWakeIntent(getActivity().getIntent());
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    handleWakeIntent(intent);
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    WakeWordService.appVisible = true;
  }

  @Override
  protected void handleOnPause() {
    super.handleOnPause();
    WakeWordService.appVisible = false;
  }

  // Opened by the wake word: tell the web app (kept until a listener takes it,
  // so a cold start still gets it).
  private void handleWakeIntent(Intent intent) {
    if (intent == null) return;
    // Tapped the floating answer card: continue that conversation in Ask AI.
    if (intent.hasExtra(WakeWordService.EXTRA_OPEN_CONVERSATION)) {
      String id = intent.getStringExtra(WakeWordService.EXTRA_OPEN_CONVERSATION);
      intent.removeExtra(WakeWordService.EXTRA_OPEN_CONVERSATION);
      JSObject data = new JSObject();
      data.put("id", id != null ? id : "");
      notifyListeners("openConversation", data, true);
      return;
    }
    if (!intent.getBooleanExtra(WakeWordService.EXTRA_WAKE, false)) return;
    intent.removeExtra(WakeWordService.EXTRA_WAKE);
    NotificationManagerCompat.from(getContext()).cancel(WakeWordService.HIT_ID);
    notifyListeners("wake", new JSObject(), true);
  }

  private JSObject status() {
    Context c = getContext();
    JSObject o = new JSObject();
    o.put("enabled", WakeWordService.isEnabled(c));
    o.put("running", WakeWordService.running);
    o.put("state", WakeWordService.state);
    o.put("error", WakeWordService.lastError);
    o.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
    o.put("canOpenOverApps", Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(c));
    PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
    o.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
    return o;
  }

  @PluginMethod
  public void status(PluginCall call) {
    call.resolve(status());
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      requestPermissionForAliases(new String[] {"microphone", "notifications"}, call, "permissionsDone");
      return;
    }
    startService(call);
  }

  @PermissionCallback
  private void permissionsDone(PluginCall call) {
    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      call.reject("Microphone permission is needed for \"Hey TradeMind\".", "NO_MIC");
      return;
    }
    startService(call);
  }

  private void startService(PluginCall call) {
    Context c = getContext();
    WakeWordService.setEnabled(c, true);
    try {
      ContextCompat.startForegroundService(c, new Intent(c, WakeWordService.class));
      call.resolve(status());
    } catch (Exception e) {
      call.reject("Couldn't start listening: " + e.getMessage());
    }
  }

  // Login token, server address and voice settings for the floating
  // assistant, which talks to the server without the app open. Kept in the
  // app's private storage; a null token (logged out) removes it.
  @PluginMethod
  public void setConfig(PluginCall call) {
    android.content.SharedPreferences.Editor e = getContext().getSharedPreferences(WakeWordService.PREFS, Context.MODE_PRIVATE).edit();
    if (call.getData().has("token")) {
      String token = call.getString("token");
      if (token == null || token.isEmpty()) e.remove("token"); else e.putString("token", token);
    }
    android.content.SharedPreferences sp = getContext().getSharedPreferences(WakeWordService.PREFS, Context.MODE_PRIVATE);
    String oldGain = sp.getString("micGain", "high");
    for (String key : new String[] {"apiUrl", "response", "position", "micLocale", "speed", "userName", "appLang", "micGain", "boostVolume"}) {
      String v = call.getString(key);
      if (v != null) e.putString(key, v);
    }
    e.apply();
    String newGain = call.getString("micGain");
    if (newGain != null && !newGain.equals(oldGain)) send(WakeWordService.ACTION_RELOAD);
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    Context c = getContext();
    WakeWordService.setEnabled(c, false);
    c.stopService(new Intent(c, WakeWordService.class));
    call.resolve(status());
  }

  // Free / take back the microphone around the app's own voice typing.
  @PluginMethod
  public void pause(PluginCall call) {
    send(WakeWordService.ACTION_PAUSE);
    call.resolve();
  }

  @PluginMethod
  public void resume(PluginCall call) {
    send(WakeWordService.ACTION_RESUME);
    call.resolve();
  }

  private void send(String action) {
    if (!WakeWordService.running) return;
    Context c = getContext();
    try {
      c.startService(new Intent(c, WakeWordService.class).setAction(action));
    } catch (Exception ignored) {
    }
  }

  @PluginMethod
  public void openOverlaySettings(PluginCall call) {
    Context c = getContext();
    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName()))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    try {
      c.startActivity(i);
    } catch (Exception e) {
      c.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    call.resolve();
  }

  @PluginMethod
  public void openBatterySettings(PluginCall call) {
    Context c = getContext();
    try {
      c.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    } catch (Exception e) {
      c.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    call.resolve();
  }
}
