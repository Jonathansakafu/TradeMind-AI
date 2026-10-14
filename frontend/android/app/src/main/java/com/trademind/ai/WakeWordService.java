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
import android.speech.tts.TextToSpeech;
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
  static final String ACTION_RELOAD = "com.trademind.ai.wake.RELOAD"; // new mic sensitivity
  static final String EXTRA_WAKE = "tm_wake";
  static final String EXTRA_OPEN_CONVERSATION = "tm_open_conversation";
  static final int HIT_ID = 4712;
  static final String PREFS = "tm_wakeword";
  private static final String CH_LISTEN = "wakeword";
  private static final String CH_HIT = "wakeword_hit";
  private static final int NOTIF_ID = 4711;
  private static final float RATE = 16000f;
  // Only these phrases can be recognised; everything else becomes [unk].
  private static final String GRAMMAR = "[\"hey trade mind\", \"trade mind\", \"[unk]\"]";
  private static final long PAUSE_AFTER_HIT_MS = 45_000;
  private static final long ASSISTANT_MAX_MS = 5 * 60_000;
  private static final long RETRY_MS = 30_000;

  static volatile boolean running = false;
  static volatile boolean appVisible = false;
  static volatile String state = "off"; // off | loading | listening | paused | error
  static volatile String lastError = null;

  private Model model;
  private Recognizer recognizer;
  private Thread micThread; // reads the boosted microphone into Vosk
  private volatile boolean micOn = false;
  private boolean loading = false;
  private long lastHit = 0;
  private VoiceAssistant assistant; // floating answer card, while open
  // Kept warm so the greeting starts at once (a new engine takes 1-2 s).
  private TextToSpeech tts;
  private volatile boolean ttsReady = false;
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
    try {
      tts = new TextToSpeech(this, (st) -> ttsReady = st == TextToSpeech.SUCCESS);
    } catch (Exception e) {
      tts = null;
    }
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
    if (ACTION_RELOAD.equals(action)) {
      if (micThread != null) {
        releaseMic();
        resumeListening();
      }
    } else if (ACTION_PAUSE.equals(action)) {
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
    if (!running || model == null || micThread != null || assistant != null) return;
    try {
      final Recognizer rec = new Recognizer(model, RATE, GRAMMAR);
      final MicInput mic = new MicInput(getSharedPreferences(PREFS, MODE_PRIVATE));
      recognizer = rec;
      micOn = true;
      micThread = new Thread(() -> {
        short[] buf = new short[1600]; // 100 ms
        try {
          while (micOn) {
            int n = mic.read(buf);
            if (n <= 0) {
              main.post(() -> onError(new Exception("microphone stopped")));
              break;
            }
            final boolean done = rec.acceptWaveForm(buf, n);
            final String hyp = done ? rec.getResult() : rec.getPartialResult();
            main.post(() -> {
              if (!micOn) return;
              if (done) onResult(hyp); else onPartialResult(hyp);
            });
          }
        } finally {
          mic.close();
        }
      }, "wake-mic");
      micThread.start();
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
    micOn = false;
    if (micThread != null) {
      try {
        micThread.join(600);
      } catch (InterruptedException ignored) {
      }
      micThread = null;
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

  // React as soon as the whole phrase is heard, so a question said right
  // after it isn't lost waiting for a pause.
  @Override
  public void onPartialResult(String hypothesis) {
    try {
      if (new JSONObject(hypothesis).optString("partial", "").contains("hey trade mind")) check("{\"text\":\"trade mind\"}");
    } catch (Exception ignored) {
    }
  }

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
    if (!text.contains("trade mind") || assistant != null) return;
    long now = SystemClock.elapsedRealtime();
    if (now - lastHit < 4000) return;
    lastHit = now;
    onWake();
  }

  private void onWake() {
    // Settings > Hey TradeMind > "When I call": answer hands-free (spoken
    // or text only) or open Ask AI. The floating card needs "display over
    // other apps"; without it the answer is spoken and shown as a
    // notification -- the app is only opened when the trader chose that.
    String mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString("response", "voice");
    if (!"voice".equals(mode)) beep(); // the spoken mode greets instead ("Yes, Jonathan?")
    boolean canOverlay = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
    if (!"app".equals(mode)) {
      pauseListening(ASSISTANT_MAX_MS); // keep the mic free (and don't hear ourselves) until the card closes
      try {
        assistant = new VoiceAssistant(this, getSharedPreferences(PREFS, MODE_PRIVATE), canOverlay, ttsReady ? tts : null, new VoiceAssistant.Host() {
          @Override
          public void onAssistantFinished() {
            assistant = null;
            main.postDelayed(autoResume, 800);
          }

          @Override
          public void openApp(Intent intent) {
            openAppOrNotify(intent);
          }

          @Override
          public void showAnswerNotification(String question, String answer) {
            showAnswer(question, answer);
          }
        });
        assistant.start();
        return;
      } catch (Exception e) {
        Log.w(TAG, "Floating assistant failed", e);
        assistant = null;
      }
    }
    pauseListening(PAUSE_AFTER_HIT_MS);
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

  private void openAppOrNotify(Intent open) {
    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
    boolean locked = km != null && km.isKeyguardLocked();
    if (!locked) {
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

  // The answer when there's no floating card (no "display over other apps").
  private void showAnswer(String question, String answer) {
    Intent open = new Intent(this, MainActivity.class)
        .putExtra(EXTRA_OPEN_CONVERSATION, "")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this, 3, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    String title = question != null && !question.isEmpty() ? "“" + question + "”" : "TradeMind AI";
    Notification n = new NotificationCompat.Builder(this, CH_HIT)
        .setSmallIcon(R.drawable.ic_stat_tm)
        .setContentTitle(title)
        .setContentText(answer)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(answer))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setAutoCancel(true)
        .setContentIntent(tap)
        .build();
    try {
      getSystemService(NotificationManager.class).notify(HIT_ID, n);
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
    if (assistant != null) assistant.finish();
    if (tts != null) {
      try {
        tts.shutdown();
      } catch (Exception ignored) {
      }
      tts = null;
    }
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
