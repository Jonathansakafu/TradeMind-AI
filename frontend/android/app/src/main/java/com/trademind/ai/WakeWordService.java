package com.trademind.ai;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

/**
 * "Hey TradeMind" wake word (added 2026-10): a foreground service that keeps
 * listening -- also with the app closed or the screen off -- using Vosk, an
 * offline open-source recogniser limited to the phrase, so no audio leaves
 * the phone. On a hit it beeps, releases the microphone and opens Ask AI
 * with voice typing on (directly when allowed to open over other apps,
 * otherwise via a tap-to-open notification). The user asked for this
 * accepting the battery cost; switched on/off in Settings.
 */
public class WakeWordService extends Service implements RecognitionListener {
  static final String TAG = "WakeWord";
  static final String ACTION_STOP = "com.trademind.ai.wake.STOP";
  static final String ACTION_PAUSE = "com.trademind.ai.wake.PAUSE";
  static final String ACTION_RESUME = "com.trademind.ai.wake.RESUME";
  static final String EXTRA_WAKE = "tm_wake";
  static final int HIT_ID = 4712;
  private static final String PREFS = "tm_wakeword";
  private static final String CH_LISTEN = "wakeword";
  private static final String CH_HIT = "wakeword_hit";
  private static final int NOTIF_ID = 4711;
  private static final float RATE = 16000f;
  // Only these phrases can be recognised; everything else becomes [unk].
  private static final String GRAMMAR = "[\"hey trade mind\", \"trade mind\", \"[unk]\"]";
  private static final long PAUSE_AFTER_HIT_MS = 45_000;
  private static final long RETRY_MS = 30_000;

  static volatile boolean running = false;
  static volatile boolean appVisible = false;
  static volatile String state = "off"; // off | loading | listening | paused | error
  static volatile String lastError = null;

  private Model model;
  private Recognizer recognizer;
  private SpeechService speech;
  private boolean loading = false;
  private long lastHit = 0;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable autoResume = this::resumeListening;

  static boolean isEnabled(Context c) {
    return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("enabled", false);
  }

  static void setEnabled(Context c, boolean on) {
    c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", on).apply();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    createChannels();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;
    if (ACTION_STOP.equals(action)) {
      setEnabled(this, false);
      stopSelf();
      return START_NOT_STICKY;
    }
    if (!isEnabled(this) || !goForeground()) {
      stopSelf();
      return START_NOT_STICKY;
    }
    running = true;
    if (ACTION_PAUSE.equals(action)) {
      pauseListening(RETRY_MS);
    } else if (model == null) {
      loadModel();
    } else {
      resumeListening();
    }
    return START_STICKY;
  }

  // Android 14 only lets a microphone service start while the app is in
  // use; a restart from the background (e.g. after the system killed it)
  // throws -- the app re-arms it the next time it is opened.
  private boolean goForeground() {
    try {
      int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
      ServiceCompat.startForeground(this, NOTIF_ID, listeningNotification(), type);
      return true;
    } catch (Exception e) {
      Log.w(TAG, "startForeground failed", e);
      state = "error";
      lastError = "Android stopped background listening. Open TradeMind to turn it back on.";
      return false;
    }
  }

  private void loadModel() {
    if (loading) return;
    loading = true;
    state = "loading";
    updateNotification();
    LibVosk.setLogLevel(LogLevel.WARNINGS);
    StorageService.unpack(this, "model-en-us", "model",
        (m) -> {
          loading = false;
          model = m;
          resumeListening();
        },
        (e) -> {
          loading = false;
          fail("Couldn't load the voice model: " + e.getMessage(), false);
        });
  }

  private void resumeListening() {
    main.removeCallbacks(autoResume);
    if (!running || model == null || speech != null) return;
    try {
      recognizer = new Recognizer(model, RATE, GRAMMAR);
      speech = new SpeechService(recognizer, RATE);
      speech.startListening(this);
      state = "listening";
      lastError = null;
      updateNotification();
    } catch (Exception e) {
      releaseMic();
      fail("Microphone busy or blocked: " + e.getMessage(), true);
    }
  }

  // Frees the microphone (for the app's own voice typing, a call...) and
  // listens again after `ms` unless resumed sooner.
  private void pauseListening(long ms) {
    releaseMic();
    if (model != null) state = "paused";
    main.removeCallbacks(autoResume);
    main.postDelayed(autoResume, ms);
    updateNotification();
  }

  private void releaseMic() {
    if (speech != null) {
      try {
        speech.stop();
        speech.shutdown();
      } catch (Exception ignored) {
      }
      speech = null;
    }
    if (recognizer != null) {
      try {
        recognizer.close();
      } catch (Exception ignored) {
      }
      recognizer = null;
    }
  }

  private void fail(String message, boolean retry) {
    Log.w(TAG, message);
    state = "error";
    lastError = message;
    updateNotification();
    if (retry) {
      main.removeCallbacks(autoResume);
      main.postDelayed(autoResume, RETRY_MS);
    }
  }

  // ---- recogniser callbacks (main thread) ----

  @Override
  public void onPartialResult(String hypothesis) {}

  @Override
  public void onResult(String hypothesis) {
    check(hypothesis);
  }

  @Override
  public void onFinalResult(String hypothesis) {
    check(hypothesis);
  }

  @Override
  public void onError(Exception e) {
    releaseMic();
    fail("Listening stopped: " + e.getMessage(), true);
  }

  @Override
  public void onTimeout() {}

  private void check(String hypothesis) {
    String text = "";
    try {
      text = new JSONObject(hypothesis).optString("text", "");
    } catch (Exception ignored) {
    }
    if (!text.contains("trade mind")) return;
    long now = SystemClock.elapsedRealtime();
    if (now - lastHit < 4000) return;
    lastHit = now;
    onWake();
  }

  private void onWake() {
    pauseListening(PAUSE_AFTER_HIT_MS);
    beep();
    Intent open = new Intent(this, MainActivity.class)
        .putExtra(EXTRA_WAKE, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
    boolean locked = km != null && km.isKeyguardLocked();
    boolean canOpen = appVisible || Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this);
    if (!locked && canOpen) {
      try {
        startActivity(open);
        return;
      } catch (Exception e) {
        Log.w(TAG, "Couldn't open the app", e);
      }
    }
    showHitNotification(open);
  }

  private void beep() {
    try {
      ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
      tone.startTone(ToneGenerator.TONE_PROP_ACK, 200);
      main.postDelayed(tone::release, 400);
    } catch (Exception ignored) {
    }
  }

  // ---- notifications ----

  private void createChannels() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = getSystemService(NotificationManager.class);
    NotificationChannel listen = new NotificationChannel(CH_LISTEN, "Hey TradeMind (listening)", NotificationManager.IMPORTANCE_MIN);
    listen.setDescription("Shown while TradeMind listens for \"Hey TradeMind\".");
    listen.setShowBadge(false);
    nm.createNotificationChannel(listen);
    NotificationChannel hit = new NotificationChannel(CH_HIT, "Hey TradeMind (heard you)", NotificationManager.IMPORTANCE_HIGH);
    hit.setDescription("Tap to ask TradeMind AI when the app can't open by itself.");
    nm.createNotificationChannel(hit);
  }

  private Notification listeningNotification() {
    String text;
    switch (state) {
      case "loading": text = "Getting ready…"; break;
      case "paused": text = "Paused while you talk to TradeMind AI"; break;
      case "error": text = lastError != null ? lastError : "Not listening right now"; break;
      default: text = "Say \"Hey TradeMind\" to ask TradeMind AI";
    }
    PendingIntent openApp = PendingIntent.getActivity(this, 0,
        new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent stop = PendingIntent.getService(this, 1,
        new Intent(this, WakeWordService.class).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    return new NotificationCompat.Builder(this, CH_LISTEN)
        .setSmallIcon(R.drawable.ic_stat_tm)
        .setContentTitle("Hey TradeMind")
        .setContentText(text)
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(openApp)
        .addAction(0, "Stop listening", stop)
        .build();
  }

  private void updateNotification() {
    if (!running) return;
    try {
      getSystemService(NotificationManager.class).notify(NOTIF_ID, listeningNotification());
    } catch (Exception ignored) {
    }
  }

  private void showHitNotification(Intent open) {
    PendingIntent tap = PendingIntent.getActivity(this, 2, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification n = new NotificationCompat.Builder(this, CH_HIT)
        .setSmallIcon(R.drawable.ic_stat_tm)
        .setContentTitle("Hey TradeMind 👋")
        .setContentText("I'm listening — tap to ask your question")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setAutoCancel(true)
        .setTimeoutAfter(PAUSE_AFTER_HIT_MS)
        .setContentIntent(tap)
        .build();
    try {
      getSystemService(NotificationManager.class).notify(HIT_ID, n);
    } catch (Exception ignored) {
    }
  }

  @Override
  public void onDestroy() {
    running = false;
    state = "off";
    main.removeCallbacks(autoResume);
    releaseMic();
    if (model != null) {
      try {
        model.close();
      } catch (Exception ignored) {
      }
      model = null;
    }
    super.onDestroy();
  }
}
