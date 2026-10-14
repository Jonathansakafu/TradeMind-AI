package com.trademind.ai;

import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.app.KeyguardManager;
import android.os.PowerManager;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * "Hey TradeMind" hands-free assistant (added 2026-10-14): a small floating
 * card over whatever is on screen -- the orb, what you said, the answer --
 * instead of opening the app. Records the question itself (Android blocks
 * Google's recogniser for background apps; this service already holds the
 * microphone), has the server transcribe it (Groq Whisper) and answer in short spoken style in one request (POST /api/ai/voice,
 * saved in the chat history), shows the answer as it arrives and reads it
 * aloud. Says so when there's no internet. Tap the card to continue in the
 * app. Without "display over other apps" it runs without the card: spoken
 * answer plus a notification. It never opens the app by itself. Runs inside WakeWordService, which has paused the wake-word
 * listener until finish() is called.
 */
class VoiceAssistant {
  interface Host {
    void onAssistantFinished();

    void openApp(Intent intent);

    void showAnswerNotification(String question, String answer);

    /** {file path, text} of a greeting recorded in advance, or null. */
    String[] greetingClip();
  }

  private static final String TAG = "VoiceAssistant";
  private static final long CONVERSATION_REUSE_MS = 10 * 60 * 1000;

  private final Context ctx;
  private final Host host;
  private final SharedPreferences prefs;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final String lang; // en, sw, fr, ar, zh, ko, ja
  private final String locale;
  private final boolean speakAnswers;

  private WindowManager wm;
  private View card;
  private OrbView orb;
  private TextView status, question, answer, footer;
  private volatile boolean recording = false;
  private final boolean withCard;
  private String asked = null;
  private TextToSpeech tts;
  private boolean ttsReady = false;
  private boolean answerVoice = false;
  private boolean answered = false;
  private boolean secondTry = false; // after "Proceed, I'm still listening"
  // After each answer it keeps listening for a follow-up (like Google's
  // Continued Conversation, ~8 s); silence closes it, "thank you" ends it.
  private boolean followUp = false;
  private static final long FOLLOW_UP_MS = 8000;
  private BroadcastReceiver unlockReceiver;
  private PowerManager.WakeLock screenOn;
  private int spokenUpTo = 0;
  private int partNo = 0;
  private android.media.MediaPlayer player; // pre-recorded greeting
  private final TextToSpeech warmTts; // the service's engine, already started (or null)
  private AudioManager audio;
  private AudioFocusRequest focus;
  private int savedVolume = -1;
  private boolean greeting = false;
  private String pendingSpeech = null;
  private String conversationId = null;
  private boolean finished = false;
  private final StringBuilder answerText = new StringBuilder();
  private final Runnable closeLater = this::finish;

  VoiceAssistant(Context ctx, SharedPreferences prefs, boolean withCard, TextToSpeech warmTts, Host host) {
    this.ctx = ctx;
    this.warmTts = warmTts;
    this.withCard = withCard;
    this.prefs = prefs;
    this.host = host;
    this.locale = prefs.getString("micLocale", "en-US");
    this.lang = locale.substring(0, 2);
    this.speakAnswers = !"text".equals(prefs.getString("response", "voice"));
  }

  // ---------- lifecycle ----------

  void start() {
    wakeScreen();
    if (withCard) showCard();
    takeAudioFocus(); // other sound dips while we listen and talk
    if (speakAnswers) {
      if (warmTts != null) {
        tts = warmTts;
        main.post(() -> onTtsReady(TextToSpeech.SUCCESS));
      } else {
        tts = new TextToSpeech(ctx, (s) -> main.post(() -> onTtsReady(s)));
      }
    }
    if (!online()) {
      fail(msg("offlineTitle"), msg("offline"));
      return;
    }
    if (prefs.getString("token", null) == null) {
      fail(msg("loginTitle"), msg("login"));
      return;
    }
    if (speakAnswers && tts != null) {
      greeting = true;
      String[] clip = host.greetingClip(); // recorded in advance: plays at once
      if (clip == null || !playClip(clip)) main.postDelayed(greetTimeout, 3000); // else greet() when the voice is ready
    } else {
      setStatus(greetingText(prefs.getString("appLang", lang)));
      listen();
    }
  }

  void finish() {
    if (finished) return;
    finished = true;
    main.removeCallbacksAndMessages(null);
    recording = false;
    if (tts != null) {
      try {
        tts.stop();
        if (tts != warmTts) tts.shutdown(); // the service's engine stays warm
      } catch (Exception ignored) {
      }
      tts = null;
    }
    if (player != null) {
      try {
        player.release();
      } catch (Exception ignored) {
      }
      player = null;
    }
    releaseAudio();
    dropUnlockReceiver();
    if (screenOn != null) {
      try {
        if (screenOn.isHeld()) screenOn.release();
      } catch (Exception ignored) {
      }
      screenOn = null;
    }
    io.shutdownNow();
    if (card != null && wm != null) {
      try {
        wm.removeView(card);
      } catch (Exception ignored) {
      }
      card = null;
    }
    host.onAssistantFinished();
  }

  // ---------- floating card ----------

  private int dp(float v) {
    return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()));
  }

  private TextView text(float sp, int color, boolean bold) {
    TextView t = new TextView(ctx);
    t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG);
    return t;
  }

  private void showCard() {
    wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
    boolean top = "top".equals(prefs.getString("position", "bottom"));

    LinearLayout box = new LinearLayout(ctx);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(16), dp(14), dp(16), dp(12));
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(0xF20B1220);
    bg.setCornerRadius(dp(26));
    bg.setStroke(dp(1), 0x4022C55E);
    box.setBackground(bg);
    box.setElevation(dp(12));

    LinearLayout head = new LinearLayout(ctx);
    head.setOrientation(LinearLayout.HORIZONTAL);
    head.setGravity(Gravity.CENTER_VERTICAL);
    orb = new OrbView(ctx);
    head.addView(orb, new LinearLayout.LayoutParams(dp(56), dp(56)));
    LinearLayout titles = new LinearLayout(ctx);
    titles.setOrientation(LinearLayout.VERTICAL);
    titles.setPadding(dp(12), 0, dp(8), 0);
    TextView name = text(12, 0xFF4ADE80, true);
    name.setText("TradeMind AI");
    status = text(16, 0xFFFFFFFF, true);
    status.setText(msg("listening"));
    titles.addView(name);
    titles.addView(status);
    head.addView(titles, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
    TextView close = text(20, 0xFF94A3B8, false);
    close.setText("✕");
    close.setPadding(dp(10), dp(4), dp(4), dp(4));
    close.setContentDescription("Close");
    close.setOnClickListener((v) -> finish());
    head.addView(close);
    box.addView(head);

    question = text(14, 0xFF94A3B8, false);
    question.setTypeface(Typeface.defaultFromStyle(Typeface.ITALIC));
    question.setPadding(0, dp(10), 0, 0);
    question.setVisibility(View.GONE);
    box.addView(question);

    final int maxBody = (int) (ctx.getResources().getDisplayMetrics().heightPixels * 0.36f);
    ScrollView scroll = new ScrollView(ctx) {
      @Override
      protected void onMeasure(int w, int h) {
        super.onMeasure(w, MeasureSpec.makeMeasureSpec(maxBody, MeasureSpec.AT_MOST));
      }
    };
    answer = text(16, 0xFFF1F5F9, false);
    answer.setLineSpacing(0, 1.15f);
    answer.setPadding(0, dp(8), 0, 0);
    scroll.addView(answer);
    box.addView(scroll);

    footer = text(11, 0xFF64748B, false);
    footer.setText(msg("tapToOpen"));
    footer.setPadding(0, dp(8), 0, 0);
    box.addView(footer);

    box.setOnClickListener((v) -> openInApp());
    answer.setOnClickListener((v) -> openInApp());

    LinearLayout frame = new LinearLayout(ctx);
    frame.setPadding(dp(12), 0, dp(12), 0);
    frame.addView(box, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    card = frame;

    int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT);
    lp.gravity = (top ? Gravity.TOP : Gravity.BOTTOM) | Gravity.CENTER_HORIZONTAL;
    lp.y = top ? dp(36) : dp(64);
    lp.windowAnimations = android.R.style.Animation_Toast;
    wm.addView(card, lp);
  }

  private void setStatus(String s) {
    if (status != null) status.setText(s);
  }

  private void setAnswer(String s) {
    if (answer != null) answer.setText(s);
  }

  private void setFooter(String s) {
    if (footer != null) footer.setText(s);
  }

  private void level(float v) {
    if (orb != null) orb.setLevel(v);
  }

  private void openInApp() {
    Intent i = new Intent(ctx, MainActivity.class)
        .putExtra(WakeWordService.EXTRA_OPEN_CONVERSATION, conversationId != null ? conversationId : "")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    finish();
    host.openApp(i);
  }

  // ---------- listening ----------

  // Silence: 5 s -> "Proceed, I'm still listening", 3 s more -> close.
  private void listen() {
    recording = true;
    final long waitMs = followUp ? FOLLOW_UP_MS : secondTry ? 3000 : 5000;
    io.execute(() -> {
      byte[] wav = record(waitMs);
      recording = false;
      if (finished) return;
      main.post(() -> {
        if (finished) return;
        if (wav == null) {
          if (followUp) {
            if (speakAnswers) finish(); // conversation over: close quietly
            else closeIn(15000); // silent mode: leave the answer up to read
          } else if (secondTry) {
            finish(); // still silent: close straight away
          } else {
            stillListening();
          }
        } else if (isLocked()) {
          waitForUnlock(wav);
        } else {
          send(wav);
        }
      });
    });
  }

  private void send(byte[] wav) {
    if (tts != null && ttsReady) { // back from the app-language phrases
      answerVoice = useLanguage(locale);
      tts.setSpeechRate(answerRate());
    }
    main.removeCallbacks(closeLater);
    answerText.setLength(0);
    spokenUpTo = 0;
    answered = false;
    setAnswer("");
    setStatus(msg("thinking"));
    level(0.3f);
    main.postDelayed(() -> { if (answerText.length() == 0 && !finished) setStatus(msg("waking")); }, 6000);
    io.execute(() -> voiceAsk(wav));
  }

  private void stillListening() {
    secondTry = true;
    String text = sayInAppLanguage("still", "prompt"); // listen() again when spoken
    setStatus(text);
    if (text == null || !speaking) listen();
  }

  // ---------- locked phone ----------

  private boolean isLocked() {
    KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
    return km != null && km.isKeyguardLocked();
  }

  // Turns the screen on when called while the phone sleeps.
  private void wakeScreen() {
    try {
      PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
      if (pm == null || pm.isInteractive()) return;
      @SuppressWarnings("deprecation")
      int flags = PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE;
      screenOn = pm.newWakeLock(flags, "TradeMind:heyTradeMind");
      screenOn.acquire(60_000);
    } catch (Exception e) {
      Log.w(TAG, "couldn't wake the screen", e);
    }
  }

  // Asked while locked: "Jonathan, you have to unlock your Android device
  // first, then I will respond" -- keeps the question and answers as soon
  // as the phone is unlocked (30 s at most).
  private void waitForUnlock(final byte[] wav) {
    String text = sayInAppLanguage("unlock", "unlock");
    setStatus(text);
    setAnswer(text);
    unlockReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context c, Intent i) {
        dropUnlockReceiver();
        main.removeCallbacks(closeLater);
        if (!finished) send(wav);
      }
    };
    try {
      ctx.registerReceiver(unlockReceiver, new IntentFilter(Intent.ACTION_USER_PRESENT));
    } catch (Exception e) {
      unlockReceiver = null;
    }
    closeIn(30000);
  }

  private void dropUnlockReceiver() {
    if (unlockReceiver == null) return;
    try {
      ctx.unregisterReceiver(unlockReceiver);
    } catch (Exception ignored) {
    }
    unlockReceiver = null;
  }

  private boolean speaking = false;

  // Speaks one of PHRASES in the app language (English if the phone has no
  // voice for it) and returns the text; utterance `id` tells the listener
  // what to do next. Text only (returns it) in silent mode.
  private String sayInAppLanguage(String key, String id) {
    String appLang = prefs.getString("appLang", lang);
    speaking = false;
    if (speakAnswers && tts != null && ttsReady) {
      if (!useLanguage(appLocale(appLang))) {
        appLang = "en";
        useLanguage("en-US");
      }
      String text = phrase(appLang, key);
      tts.setSpeechRate(1.0f);
      louder();
      speaking = tts.speak(text, TextToSpeech.QUEUE_FLUSH, loud(), id) == TextToSpeech.SUCCESS;
      return text;
    }
    return phrase(appLang, key);
  }

  private static final Map<String, Map<String, String>> PHRASES = new HashMap<>();

  private static void phrases(String language, String still, String unlock) {
    Map<String, String> m = new HashMap<>();
    m.put("still", still);
    m.put("unlock", unlock);
    PHRASES.put(language, m);
  }

  static {
    phrases("en", "Proceed[, {name}], I'm still listening.", "[{name}, ]you have to unlock your Android device first, then I will respond.");
    phrases("sw", "Endelea[, {name}], bado nakusikiliza.", "[{name}, ]fungua kwanza simu yako ya Android, kisha nitakujibu.");
    phrases("fr", "Vas-y[, {name}], je t'écoute toujours.", "[{name}, ]déverrouille d'abord ton appareil Android, ensuite je te répondrai.");
    phrases("ar", "تفضل[ يا {name}]، ما زلت أستمع.", "[يا {name}، ]افتح قفل جهازك أندرويد أولاً، ثم سأجيبك.");
    phrases("zh", "请说[，{name}]，我还在听。", "[{name}，]请先解锁你的安卓设备，然后我再回答你。");
    phrases("ko", "말씀하세요[, {name}님], 아직 듣고 있어요.", "[{name}님, ]먼저 안드로이드 기기의 잠금을 해제해 주세요. 그러면 답해 드릴게요.");
    phrases("ja", "どうぞ[、{name}さん]、まだ聞いていますよ。", "[{name}さん、]まずAndroid端末のロックを解除してください。そうしたらお答えします。");
  }

  private String phrase(String language, String key) {
    Map<String, String> m = PHRASES.containsKey(language) ? PHRASES.get(language) : PHRASES.get("en");
    return withName(prefs, m.get(key));
  }

  static String withName(SharedPreferences prefs, String t) {
    String name = prefs.getString("userName", "").trim();
    if (name.contains(" ")) name = name.substring(0, name.indexOf(' '));
    if (name.isEmpty()) return t.replaceAll("\\[[^\\]]*\\]", "");
    return t.replace("{name}", name).replace("[", "").replace("]", "");
  }

  private void noHear() {
    if (finished) return;
    setStatus(msg("noHearTitle"));
    setAnswer(msg("noHear"));
    say(msg("noHear"));
  }

  // Records the question and stops ~0.7 s after the voice ends. The noise
  // level is learnt before and between words (the old fixed threshold took
  // boosted background noise for speech and never stopped). Sensitivity
  // (Settings) lowers the level that counts as a voice. 12 s at most; null
  // if nothing was said within 6 s. Unboosted audio, levelled as a whole.
  private byte[] record(long waitMs) {
    final int rate = MicInput.RATE;
    MicInput rec;
    try {
      rec = new MicInput(prefs, false);
    } catch (Exception e) {
      Log.w(TAG, "microphone unavailable", e);
      return null;
    }
    final float sens = MicInput.gainFor(prefs);
    final double minVoice = 600.0 / sens;
    ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    short[] frame = new short[320]; // 20 ms
    double noise = -1, voice = 0;
    int loudRun = 0, quietMs = 0;
    boolean spoke = false;
    long started = SystemClock.elapsedRealtime();
    try {
      while (recording && !finished) {
        int n = rec.read(frame);
        if (n <= 0) break;
        double sum = 0;
        for (int i = 0; i < n; i++) {
          sum += (double) frame[i] * frame[i];
          pcm.write(frame[i] & 0xff);
          pcm.write((frame[i] >> 8) & 0xff);
        }
        double rms = Math.sqrt(sum / n);
        if (noise < 0) noise = rms;
        final float lvl = (float) Math.min(1.0, rms * sens / 3500.0);
        main.post(() -> level(lvl));
        if (!spoke) {
          if (rms > Math.max(minVoice, noise * 3.0)) {
            if (++loudRun >= 3) {
              spoke = true;
              voice = rms;
            }
          } else {
            loudRun = 0;
            noise = noise * 0.9 + rms * 0.1;
          }
        } else if (rms < Math.max(minVoice * 0.8, Math.max(noise * 2.0, voice * 0.18))) {
          quietMs += 20;
          noise = noise * 0.98 + rms * 0.02;
        } else {
          quietMs = 0;
          voice = Math.max(voice * 0.995, rms);
        }
        long elapsed = SystemClock.elapsedRealtime() - started;
        if (spoke && quietMs >= 700) break;
        if (!spoke && elapsed > waitMs) break;
        if (elapsed > 12000) break;
      }
    } finally {
      rec.close();
    }
    if (!spoke) return null;
    byte[] data = pcm.toByteArray();
    int keep = Math.max(0, data.length - Math.max(0, quietMs - 300) * 32); // drop trailing silence
    return wav(normalize(data, keep & ~1), rate);
  }

  // Levels the whole recording to ~90% of full scale (max 8x), no clipping.
  private static byte[] normalize(byte[] pcm, int len) {
    int peak = 1;
    for (int i = 0; i + 1 < len; i += 2) peak = Math.max(peak, Math.abs((short) ((pcm[i] & 0xff) | (pcm[i + 1] << 8))));
    float g = Math.min(8f, 0.9f * 32767f / peak);
    byte[] out = new byte[len];
    for (int i = 0; i + 1 < len; i += 2) {
      int v = Math.round(((short) ((pcm[i] & 0xff) | (pcm[i + 1] << 8))) * g);
      v = Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, v));
      out[i] = (byte) (v & 0xff);
      out[i + 1] = (byte) ((v >> 8) & 0xff);
    }
    return out;
  }

  private static byte[] wav(byte[] pcm, int rate) {
    ByteArrayOutputStream out = new ByteArrayOutputStream(pcm.length + 44);
    writeAscii(out, "RIFF");
    writeInt(out, 36 + pcm.length);
    writeAscii(out, "WAVEfmt ");
    writeInt(out, 16);
    writeShort(out, 1); // PCM
    writeShort(out, 1); // mono
    writeInt(out, rate);
    writeInt(out, rate * 2);
    writeShort(out, 2);
    writeShort(out, 16);
    writeAscii(out, "data");
    writeInt(out, pcm.length);
    out.write(pcm, 0, pcm.length);
    return out.toByteArray();
  }

  private static void writeAscii(ByteArrayOutputStream o, String s) {
    for (int i = 0; i < s.length(); i++) o.write(s.charAt(i));
  }

  private static void writeInt(ByteArrayOutputStream o, int v) {
    o.write(v & 0xff);
    o.write((v >> 8) & 0xff);
    o.write((v >> 16) & 0xff);
    o.write((v >> 24) & 0xff);
  }

  private static void writeShort(ByteArrayOutputStream o, int v) {
    o.write(v & 0xff);
    o.write((v >> 8) & 0xff);
  }

  // One request (POST /api/ai/voice): the recording goes up, the server
  // transcribes it and streams the answer back -- "question", then the
  // usual Ask AI events. Runs on the io thread.
  private void voiceAsk(byte[] wav) {
    HttpURLConnection c = null;
    try {
      long lastAt = prefs.getLong("voiceConversationAt", 0);
      String reuse = System.currentTimeMillis() - lastAt < CONVERSATION_REUSE_MS ? prefs.getString("voiceConversationId", null) : null;
      String api = prefs.getString("apiUrl", "https://trade-mind-ai-seven.vercel.app");
      String url = api + "/api/ai/voice?lang=" + lang + (reuse != null ? "&conversationId=" + reuse : "");
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setRequestMethod("POST");
      c.setConnectTimeout(20000);
      c.setReadTimeout(90000);
      c.setDoOutput(true);
      c.setFixedLengthStreamingMode(wav.length);
      c.setRequestProperty("Content-Type", "audio/wav");
      c.setRequestProperty("Authorization", "Bearer " + prefs.getString("token", ""));
      try (OutputStream os = c.getOutputStream()) {
        os.write(wav);
      }
      int code = c.getResponseCode();
      if (code == 401 || code == 403) {
        main.post(() -> fail(msg("loginTitle"), msg("login")));
        return;
      }
      if (code >= 400) {
        main.post(() -> fail(msg("errorTitle"), msg("error")));
        return;
      }
      BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
      String line, event = null;
      while ((line = r.readLine()) != null && !finished) {
        if (line.startsWith("event:")) {
          event = line.substring(6).trim();
        } else if (line.startsWith("data:") && event != null) {
          final JSONObject data = new JSONObject(line.substring(5).trim());
          final String ev = event;
          if ("nohear".equals(ev)) {
            main.post(() -> { if (followUp) finish(); else noHear(); });
            return;
          }
          if ("bye".equals(ev)) { // "thank you" / "stop": end the conversation
            main.post(this::finish);
            return;
          }
          main.post(() -> onEvent(ev, data));
        }
      }
      main.post(this::onAnswered);
    } catch (Exception e) {
      Log.w(TAG, "voice ask failed", e);
      main.post(() -> fail(online() ? msg("errorTitle") : msg("offlineTitle"), online() ? msg("error") : msg("offline")));
    } finally {
      if (c != null) c.disconnect();
    }
  }

  private void showQuestion(String q) {
    asked = q;
    if (question == null) return;
    question.setVisibility(View.VISIBLE);
    question.setText("“" + q + "”");
  }

  // ---------- asking ----------

  private void onEvent(String event, JSONObject data) {
    if (finished) return;
    switch (event) {
      case "question":
        showQuestion(data.optString("text", ""));
        break;
      case "conversation":
        conversationId = data.optString("id", null);
        prefs.edit().putString("voiceConversationId", conversationId).putLong("voiceConversationAt", System.currentTimeMillis()).apply();
        break;
      case "chunk":
        answerText.append(data.optString("text", ""));
        setAnswer(answerText.toString().trim());
        setStatus(msg("answer"));
        speakReady(false); // start talking at the first full sentence
        break;
      case "error":
        if (answerText.length() == 0) fail(msg("errorTitle"), data.optString("message", msg("error")));
        break;
      default:
        break;
    }
  }

  private void onAnswered() {
    if (finished || answerText.length() == 0) return;
    answered = true;
    setStatus(msg("answer"));
    if (!withCard) host.showAnswerNotification(asked, answerText.toString().trim());
    if (!speakAnswers || tts == null || !answerVoice) listenForFollowUp(); // answer shown, not spoken
    else if (ttsReady) speakReady(true);
    else say(answerText.toString()); // waits for the voice, or closes if there is none
  }

  // Answer finished: a soft tone, then listen again for a follow-up in the
  // same conversation (the server keeps the history).
  private void listenForFollowUp() {
    if (finished || recording) return;
    if (!answered) { // an error / "didn't hear" message was spoken: close as before
      closeIn(9000);
      return;
    }
    followUp = true;
    secondTry = false;
    main.removeCallbacks(closeLater);
    setStatus(msg("followUp"));
    level(0.2f);
    try {
      android.media.ToneGenerator tone = new android.media.ToneGenerator(AudioManager.STREAM_MUSIC, 35);
      tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 90);
      main.postDelayed(tone::release, 300);
    } catch (Exception ignored) {
    }
    main.postDelayed(() -> { if (!finished && !recording) listen(); }, 250); // after the tone and the voice's echo
  }

  // Speaks the finished sentences not spoken yet (all of the rest when
  // last), so the answer starts while the server is still writing it.
  private void speakReady(boolean last) {
    if (!speakAnswers || tts == null || !ttsReady || !answerVoice || greeting || finished) return;
    String all = answerText.toString();
    int end = last ? all.length() : sentenceEnd(all, spokenUpTo);
    List<String> parts = end > spokenUpTo ? chunks(clean(all.substring(spokenUpTo, end))) : new ArrayList<>();
    if (end > spokenUpTo) spokenUpTo = end;
    if (!parts.isEmpty()) louder();
    for (int i = 0; i < parts.size(); i++) {
      String id = (last && i == parts.size() - 1 ? "last" : "part") + (partNo++);
      tts.speak(parts.get(i), TextToSpeech.QUEUE_ADD, loud(), id);
    }
    if (last && parts.isEmpty()) tts.playSilentUtterance(10, TextToSpeech.QUEUE_ADD, "last" + (partNo++));
  }

  // End of the last complete sentence after `from` (a full stop counts only
  // when followed by a space, so "1.5" isn't split), or `from` if none.
  private static int sentenceEnd(String t, int from) {
    int end = from;
    for (int i = from; i < t.length(); i++) {
      char ch = t.charAt(i);
      if ("。！？".indexOf(ch) >= 0) end = i + 1;
      else if (".!?؟".indexOf(ch) >= 0 && i + 1 < t.length() && Character.isWhitespace(t.charAt(i + 1))) end = i + 1;
    }
    return end;
  }

  private void fail(String title, String message) {
    if (finished) return;
    if (!withCard) host.showAnswerNotification(title, message);
    setStatus(title);
    setAnswer(message);
    say(message);
  }

  // ---------- speaking ----------

  private static final Pattern MALE = Pattern.compile("-x-(iol|iom|tpd|gbb|gbd|rjs|aub|aud|enc|end|frb|frd|ard|arz)\\b|smtm\\d|(^|[^e])male", Pattern.CASE_INSENSITIVE);

  // Speech engine ready: answers use the 🎤 language; the greeting uses the
  // app language first (greet()).
  private void onTtsReady(int status) {
    if (tts == null) return;
    if (status != TextToSpeech.SUCCESS) {
      tts = null;
      if (greeting) finishGreeting();
      if (pendingSpeech != null) closeIn(20000);
      return;
    }
    tts.setSpeechRate(answerRate());
    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
      @Override public void onStart(String id) {
        main.post(() -> level(0.6f));
      }
      @Override public void onDone(String id) {
        if ("greet".equals(id)) main.post(VoiceAssistant.this::finishGreeting);
        else if ("prompt".equals(id)) main.post(() -> { if (!finished) listen(); });
        else if (id.startsWith("last")) main.post(VoiceAssistant.this::listenForFollowUp);
      }
      @Override public void onError(String id) {
        if ("greet".equals(id)) main.post(VoiceAssistant.this::finishGreeting);
        else if ("prompt".equals(id)) main.post(() -> { if (!finished) listen(); });
        else if (id.startsWith("last")) main.post(VoiceAssistant.this::listenForFollowUp);
      }
      @Override public void onRangeStart(String id, int start, int end, int frame) {
        main.post(() -> level(0.45f + (float) Math.random() * 0.5f));
      }
    });
    ttsReady = true;
    answerVoice = useLanguage(locale);
    if (!answerVoice) setFooter(msg("noVoice"));
    if (greeting) {
      if (player == null) greet();
    } else if (answerText.length() > 0) {
      speakReady(answered); // answer arrived before the voice was ready
    } else if (pendingSpeech != null) {
      String s = pendingSpeech;
      pendingSpeech = null;
      say(s);
    }
  }

  // Switches the engine to a language with a male on-device voice when
  // there is one (pitch lowered otherwise). False if the phone has no voice
  // for it.
  private boolean useLanguage(String tag) {
    return applyLanguage(tts, tag);
  }

  static boolean applyLanguage(TextToSpeech tts, String tag) {
    if (tts == null) return false;
    Locale loc = Locale.forLanguageTag(tag);
    int res = tts.setLanguage(loc);
    if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) return false;
    Voice pick = null;
    try {
      for (Voice v : tts.getVoices()) {
        if (!v.getLocale().getLanguage().equals(loc.getLanguage()) || v.isNetworkConnectionRequired()) continue;
        if (MALE.matcher(v.getName()).find()) {
          pick = v;
          break;
        }
      }
    } catch (Exception ignored) {
    }
    boolean male = pick != null;
    if (pick == null) { // no male voice: any on-device one (online voices start slowly)
      try {
        for (Voice v : tts.getVoices()) {
          if (v.getLocale().getLanguage().equals(loc.getLanguage()) && !v.isNetworkConnectionRequired()) {
            pick = v;
            break;
          }
        }
      } catch (Exception ignored) {
      }
    }
    if (pick != null) tts.setVoice(pick);
    tts.setPitch(male ? 1.0f : 0.85f);
    return true;
  }

  // ---------- greeting ("Yes, Jonathan?" in the app language) ----------

  private static final Map<String, String[]> GREETINGS = new HashMap<>();
  private static final Map<String, String> APP_LOCALES = new HashMap<>();

  static {
    // [ ... ] holds the part with the name, dropped when there's no name.
    GREETINGS.put("en", new String[] {"Yes[, {name}]?", "What's up[, {name}]?", "I'm here[, {name}].", "Go ahead[, {name}]."});
    GREETINGS.put("sw", new String[] {"Naam[, {name}]?", "Nipo[, {name}].", "Ndiyo[, {name}]?", "Sema[, {name}]."});
    GREETINGS.put("fr", new String[] {"Oui[, {name}] ?", "Je t'écoute[, {name}].", "Je suis là[, {name}].", "Vas-y[, {name}]."});
    GREETINGS.put("ar", new String[] {"نعم[ يا {name}]؟", "تفضل[ يا {name}].", "أنا هنا[ يا {name}].", "أسمعك[ يا {name}]."});
    GREETINGS.put("zh", new String[] {"在呢[，{name}]。", "我在[，{name}]。", "请说[，{name}]。"});
    GREETINGS.put("ko", new String[] {"네[, {name}님]?", "말씀하세요[, {name}님].", "듣고 있어요[, {name}님]."});
    GREETINGS.put("ja", new String[] {"はい[、{name}さん]？", "どうぞ[、{name}さん]。", "聞いていますよ[、{name}さん]。"});
    APP_LOCALES.put("en", "en-US");
    APP_LOCALES.put("sw", "sw-KE");
    APP_LOCALES.put("fr", "fr-FR");
    APP_LOCALES.put("ar", "ar-SA");
    APP_LOCALES.put("zh", "zh-CN");
    APP_LOCALES.put("ko", "ko-KR");
    APP_LOCALES.put("ja", "ja-JP");
  }

  private String greetingText(String language) {
    return greetingVariant(prefs, language, -1);
  }

  static String appLocale(String language) {
    return APP_LOCALES.containsKey(language) ? APP_LOCALES.get(language) : "en-US";
  }

  static int greetingCount(String language) {
    return (GREETINGS.containsKey(language) ? GREETINGS.get(language) : GREETINGS.get("en")).length;
  }

  /** Greeting number i (-1 = random) in `language`, with the first name. */
  static String greetingVariant(SharedPreferences prefs, String language, int i) {
    String[] list = GREETINGS.containsKey(language) ? GREETINGS.get(language) : GREETINGS.get("en");
    String t = list[i >= 0 ? i % list.length : (int) (Math.random() * list.length)];
    String name = prefs.getString("userName", "").trim();
    if (name.contains(" ")) name = name.substring(0, name.indexOf(' '));
    if (name.isEmpty()) return t.replaceAll("\\[[^\\]]*\\]", "");
    return t.replace("{name}", name).replace("[", "").replace("]", "");
  }

  private void greet() {
    String appLang = prefs.getString("appLang", lang);
    String text = greetingText(appLang);
    String appLocale = APP_LOCALES.containsKey(appLang) ? APP_LOCALES.get(appLang) : "en-US";
    if (!useLanguage(appLocale)) { // no voice for the app language on this phone
      text = greetingText("en");
      useLanguage("en-US");
    }
    setStatus(text);
    louder();
    tts.setSpeechRate(1.0f); // short greeting: natural pace
    if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, loud(), "greet") != TextToSpeech.SUCCESS) finishGreeting();
  }

  private boolean playClip(String[] clip) {
    try {
      android.media.MediaPlayer mp = new android.media.MediaPlayer();
      mp.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build());
      mp.setDataSource(clip[0]);
      mp.setOnCompletionListener((m) -> {
        m.release();
        player = null;
        finishGreeting();
      });
      mp.setOnErrorListener((m, what, extra) -> {
        m.release();
        player = null;
        finishGreeting();
        return true;
      });
      mp.prepare();
      setStatus(clip[1]);
      louder();
      player = mp;
      mp.start();
      return true;
    } catch (Exception e) {
      Log.w(TAG, "greeting clip failed", e);
      return false;
    }
  }

  private final Runnable greetTimeout = this::finishGreeting;

  // Greeting spoken (or the voice wasn't ready in time): start listening,
  // with the engine back on the answer language.
  private void finishGreeting() {
    if (!greeting || finished) return;
    greeting = false;
    main.removeCallbacks(greetTimeout);
    if (tts != null && ttsReady) {
      answerVoice = useLanguage(locale);
      tts.setSpeechRate(answerRate());
    }
    setStatus(msg("listening"));
    listen();
  }

  private void say(String text) {
    if (finished) return;
    if (!speakAnswers || tts == null) { // text-only mode, or no voice on this phone
      closeIn(25000);
      return;
    }
    if (!ttsReady) {
      pendingSpeech = text;
      return;
    }
    if (!answerVoice) { // no voice for the answer language: text only
      closeIn(25000);
      return;
    }
    louder();
    List<String> parts = chunks(clean(text));
    for (int i = 0; i < parts.size(); i++) {
      String id = (i == parts.size() - 1 ? "last" : "part") + i;
      tts.speak(parts.get(i), TextToSpeech.QUEUE_ADD, loud(), id);
    }
    if (parts.isEmpty()) closeIn(9000);
  }

  private float answerRate() {
    return "normal".equals(prefs.getString("speed", "slow")) ? 0.95f : 0.8f;
  }

  // ---------- loudness ----------

  // Full engine volume on the media stream.
  private static Bundle loud() {
    Bundle b = new Bundle();
    b.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
    b.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
    return b;
  }

  private void takeAudioFocus() {
    try {
      audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
      if (Build.VERSION.SDK_INT >= 26) {
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .build();
        audio.requestAudioFocus(focus);
      } else {
        audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
      }
    } catch (Exception ignored) {
    }
  }

  // Settings > "Speak loudly even if the phone is quiet": raise media
  // volume to at least 80% while TradeMind talks; put it back afterwards.
  private void louder() {
    if (audio == null || savedVolume >= 0 || "false".equals(prefs.getString("boostVolume", "true"))) return;
    try {
      int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
      int cur = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
      int want = (int) Math.ceil(max * 0.8);
      if (cur < want) {
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, want, 0);
        savedVolume = cur;
      }
    } catch (Exception ignored) { // Do Not Disturb, fixed-volume devices
    }
  }

  private void releaseAudio() {
    if (audio == null) return;
    try {
      if (savedVolume >= 0) audio.setStreamVolume(AudioManager.STREAM_MUSIC, savedVolume, 0);
      if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus);
      else audio.abandonAudioFocus(null);
    } catch (Exception ignored) {
    }
    savedVolume = -1;
  }

  private void closeIn(long ms) {
    main.removeCallbacks(closeLater);
    main.postDelayed(closeLater, ms);
  }

  private static String clean(String t) {
    return t.replaceAll("[*_#`>|]", " ")
        .replaceAll("[\\x{1F000}-\\x{1FFFF}\\x{2600}-\\x{27BF}\\x{FE0F}\\x{200D}]", " ")
        .replaceAll("\\bR:R\\b", "risk to reward")
        .replaceAll("\\bSL\\b", "stop loss")
        .replaceAll("\\bTP\\b", "take profit")
        .replaceAll("\\s+", " ")
        .trim();
  }

  private static List<String> chunks(String t) {
    List<String> out = new ArrayList<>();
    Matcher m = Pattern.compile("[^.!?。！？؟]+[.!?。！？؟]*").matcher(t);
    StringBuilder cur = new StringBuilder();
    while (m.find()) {
      String s = m.group().trim();
      if (s.isEmpty()) continue;
      if (cur.length() + s.length() > 400 && cur.length() > 0) {
        out.add(cur.toString());
        cur.setLength(0);
      }
      if (cur.length() > 0) cur.append(' ');
      cur.append(s);
    }
    if (cur.length() > 0) out.add(cur.toString());
    return out;
  }

  // ---------- helpers ----------

  private boolean online() {
    try {
      ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
      Network n = cm.getActiveNetwork();
      NetworkCapabilities nc = n != null ? cm.getNetworkCapabilities(n) : null;
      return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    } catch (Exception e) {
      return true;
    }
  }

  private static final Map<String, Map<String, String>> TEXT = new HashMap<>();

  private static void put(String lang, String... kv) {
    Map<String, String> m = new HashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
    TEXT.put(lang, m);
  }

  static {
    put("en", "followUp", "Listening… ask a follow-up", "listening", "Listening…", "thinking", "Thinking…", "waking", "Waking up the server…", "answer", "Answer",
        "offlineTitle", "No internet", "offline", "I need an internet connection to answer that. Please connect and try again.",
        "noHearTitle", "Didn't catch that", "noHear", "I didn't hear a question. Say Hey TradeMind and try again.",
        "loginTitle", "Not logged in", "login", "Please open TradeMind and log in first.",
        "errorTitle", "No answer", "error", "Sorry, I couldn't get an answer right now. Please try again in a moment.",
        "tapToOpen", "Tap to continue in TradeMind", "noVoice", "No voice for this language on this phone — showing the answer as text.");
    put("sw", "followUp", "Nasikiliza… uliza swali jingine", "listening", "Nasikiliza…", "thinking", "Ninafikiri…", "waking", "Inaamsha seva…", "answer", "Jibu",
        "offlineTitle", "Hakuna intaneti", "offline", "Nahitaji intaneti ili kujibu. Tafadhali unganisha kisha ujaribu tena.",
        "noHearTitle", "Sikusikia", "noHear", "Sikusikia swali. Sema Hey TradeMind ujaribu tena.",
        "loginTitle", "Hujaingia", "login", "Tafadhali fungua TradeMind uingie kwanza.",
        "errorTitle", "Hakuna jibu", "error", "Samahani, siwezi kupata jibu sasa hivi. Jaribu tena baadaye kidogo.",
        "tapToOpen", "Gusa kuendelea ndani ya TradeMind", "noVoice", "Hakuna sauti ya lugha hii kwenye simu — jibu limeonyeshwa kwa maandishi.");
    put("fr", "followUp", "J'écoute… une autre question ?", "listening", "J'écoute…", "thinking", "Je réfléchis…", "waking", "Réveil du serveur…", "answer", "Réponse",
        "offlineTitle", "Pas d'internet", "offline", "J'ai besoin d'une connexion internet pour répondre. Connectez-vous et réessayez.",
        "noHearTitle", "Pas compris", "noHear", "Je n'ai pas entendu de question. Dites Hey TradeMind et réessayez.",
        "loginTitle", "Non connecté", "login", "Ouvrez TradeMind et connectez-vous d'abord.",
        "errorTitle", "Pas de réponse", "error", "Désolé, je n'ai pas pu obtenir de réponse. Réessayez dans un instant.",
        "tapToOpen", "Touchez pour continuer dans TradeMind", "noVoice", "Pas de voix pour cette langue sur ce téléphone — réponse affichée en texte.");
    put("ar", "followUp", "أستمع… اسأل سؤالاً آخر", "listening", "أستمع…", "thinking", "أفكر…", "waking", "جارٍ تشغيل الخادم…", "answer", "الإجابة",
        "offlineTitle", "لا يوجد إنترنت", "offline", "أحتاج إلى اتصال بالإنترنت للإجابة. يرجى الاتصال والمحاولة مرة أخرى.",
        "noHearTitle", "لم أفهم", "noHear", "لم أسمع سؤالاً. قل Hey TradeMind وحاول مرة أخرى.",
        "loginTitle", "غير مسجّل الدخول", "login", "يرجى فتح TradeMind وتسجيل الدخول أولاً.",
        "errorTitle", "لا توجد إجابة", "error", "عذراً، لم أتمكن من الحصول على إجابة الآن. حاول مرة أخرى بعد قليل.",
        "tapToOpen", "اضغط للمتابعة في TradeMind", "noVoice", "لا يوجد صوت لهذه اللغة على الهاتف — الإجابة معروضة كنص.");
    put("zh", "followUp", "在听…可以继续问", "listening", "正在听…", "thinking", "正在思考…", "waking", "正在唤醒服务器…", "answer", "回答",
        "offlineTitle", "没有网络", "offline", "回答需要网络连接。请连接网络后再试。",
        "noHearTitle", "没听清", "noHear", "我没有听到问题。请说 Hey TradeMind 再试一次。",
        "loginTitle", "未登录", "login", "请先打开 TradeMind 并登录。",
        "errorTitle", "没有回答", "error", "抱歉，现在无法获取回答。请稍后再试。",
        "tapToOpen", "点击在 TradeMind 中继续", "noVoice", "此手机没有该语言的语音——以文字显示回答。");
    put("ko", "followUp", "듣고 있어요… 이어서 물어보세요", "listening", "듣고 있어요…", "thinking", "생각 중…", "waking", "서버를 깨우는 중…", "answer", "답변",
        "offlineTitle", "인터넷 없음", "offline", "답하려면 인터넷 연결이 필요합니다. 연결한 뒤 다시 시도하세요.",
        "noHearTitle", "못 들었어요", "noHear", "질문을 듣지 못했어요. Hey TradeMind라고 말하고 다시 시도하세요.",
        "loginTitle", "로그인 안 됨", "login", "먼저 TradeMind를 열고 로그인하세요.",
        "errorTitle", "답변 없음", "error", "죄송합니다. 지금은 답변을 가져올 수 없습니다. 잠시 후 다시 시도하세요.",
        "tapToOpen", "눌러서 TradeMind에서 계속하기", "noVoice", "이 휴대폰에 이 언어 음성이 없어 답변을 글로 보여줍니다.");
    put("ja", "followUp", "聞いています…続けてどうぞ", "listening", "聞いています…", "thinking", "考えています…", "waking", "サーバーを起動中…", "answer", "回答",
        "offlineTitle", "インターネットなし", "offline", "回答にはインターネット接続が必要です。接続してからもう一度お試しください。",
        "noHearTitle", "聞き取れませんでした", "noHear", "質問が聞こえませんでした。Hey TradeMind と言ってもう一度どうぞ。",
        "loginTitle", "未ログイン", "login", "まず TradeMind を開いてログインしてください。",
        "errorTitle", "回答なし", "error", "すみません、今は回答を取得できません。少ししてからもう一度お試しください。",
        "tapToOpen", "タップして TradeMind で続ける", "noVoice", "この端末にはこの言語の音声がないため、回答を文字で表示します。");
  }

  private String msg(String key) {
    Map<String, String> m = TEXT.get(lang);
    String s = m != null ? m.get(key) : null;
    return s != null ? s : TEXT.get("en").get(key);
  }
}
