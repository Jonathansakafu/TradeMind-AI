package com.trademind.ai;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
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
 * microphone), has the server transcribe it (Groq Whisper), asks Ask AI in short spoken style (POST /api/ai/ask/stream, voice: true,
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
  private boolean greeting = false;
  private String pendingSpeech = null;
  private String conversationId = null;
  private boolean finished = false;
  private final StringBuilder answerText = new StringBuilder();
  private final Runnable closeLater = this::finish;

  VoiceAssistant(Context ctx, SharedPreferences prefs, boolean withCard, Host host) {
    this.ctx = ctx;
    this.withCard = withCard;
    this.prefs = prefs;
    this.host = host;
    this.locale = prefs.getString("micLocale", "en-US");
    this.lang = locale.substring(0, 2);
    this.speakAnswers = !"text".equals(prefs.getString("response", "voice"));
  }

  // ---------- lifecycle ----------

  void start() {
    if (withCard) showCard();
    if (speakAnswers) {
      tts = new TextToSpeech(ctx, (s) -> main.post(() -> onTtsReady(s)));
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
      greeting = true; // greet() runs when the voice is ready
      main.postDelayed(greetTimeout, 3000);
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
        tts.shutdown();
      } catch (Exception ignored) {
      }
      tts = null;
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

  private void listen() {
    recording = true;
    io.execute(() -> {
      byte[] wav = record();
      if (finished) return;
      if (wav == null) {
        main.post(this::noHear);
        return;
      }
      main.post(() -> {
        setStatus(msg("thinking"));
        main.postDelayed(() -> { if (asked == null && !finished) setStatus(msg("waking")); }, 7000);
      });
      final String text = transcribe(wav);
      main.post(() -> {
        if (finished) return;
        if (text == null) {
          if (httpCode == 401 || httpCode == 403) fail(msg("loginTitle"), msg("login"));
          else if (!online()) fail(msg("offlineTitle"), msg("offline"));
          else fail(msg("errorTitle"), msg("error"));
        } else if (text.trim().isEmpty()) {
          noHear();
        } else {
          ask(text.trim());
        }
      });
    });
  }

  private void noHear() {
    if (finished) return;
    setStatus(msg("noHearTitle"));
    setAnswer(msg("noHear"));
    say(msg("noHear"));
  }

  // Records until the speaker pauses (~1.3 s of quiet after speech), 15 s at
  // most; null if nothing was said within 7 s. 16 kHz mono 16-bit WAV.
  private byte[] record() {
    final int rate = 16000;
    try {
      Thread.sleep(350); // let the wake beep finish
    } catch (InterruptedException e) {
      return null;
    }
    AudioRecord rec;
    try {
      int min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT, Math.max(min, rate));
      if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
        rec.release();
        return null;
      }
      rec.startRecording();
    } catch (Exception e) {
      Log.w(TAG, "microphone unavailable", e);
      return null;
    }
    ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    short[] frame = new short[320]; // 20 ms
    double floor = Double.MAX_VALUE;
    int frames = 0, loudRun = 0, quietMs = 0;
    boolean spoke = false;
    long started = SystemClock.elapsedRealtime();
    try {
      while (recording && !finished) {
        int n = rec.read(frame, 0, frame.length);
        if (n <= 0) break;
        double sum = 0;
        for (int i = 0; i < n; i++) {
          sum += (double) frame[i] * frame[i];
          pcm.write(frame[i] & 0xff);
          pcm.write((frame[i] >> 8) & 0xff);
        }
        double rms = Math.sqrt(sum / n);
        if (++frames <= 15) floor = Math.min(floor, rms); // quietest of the first 300 ms
        double threshold = Math.max(350, (floor == Double.MAX_VALUE ? 0 : floor) * 3);
        final float lvl = (float) Math.min(1.0, rms / 3500.0);
        main.post(() -> level(lvl));
        if (rms > threshold) {
          if (++loudRun >= 4) spoke = true;
          quietMs = 0;
        } else {
          loudRun = 0;
          if (spoke) quietMs += 20;
        }
        long elapsed = SystemClock.elapsedRealtime() - started;
        if (spoke && quietMs >= 1300) break;
        if (!spoke && elapsed > 7000) break;
        if (elapsed > 15000) break;
      }
    } finally {
      try {
        rec.stop();
      } catch (Exception ignored) {
      }
      rec.release();
    }
    return spoke ? wav(pcm.toByteArray(), rate) : null;
  }

  private static byte[] wav(byte[] pcm, int rate) {
    ByteArrayOutputStream out = new ByteArrayOutputStream(pcm.length + 44);
    int byteRate = rate * 2;
    writeAscii(out, "RIFF");
    writeInt(out, 36 + pcm.length);
    writeAscii(out, "WAVEfmt ");
    writeInt(out, 16);
    writeShort(out, 1); // PCM
    writeShort(out, 1); // mono
    writeInt(out, rate);
    writeInt(out, byteRate);
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

  private volatile int httpCode = 0;

  // Server-side speech-to-text. "" = nothing understood, null = failed.
  private String transcribe(byte[] wav) {
    HttpURLConnection c = null;
    try {
      String api = prefs.getString("apiUrl", "https://trade-mind-ai-seven.vercel.app");
      c = (HttpURLConnection) new URL(api + "/api/ai/transcribe?lang=" + lang).openConnection();
      c.setRequestMethod("POST");
      c.setConnectTimeout(20000);
      c.setReadTimeout(90000);
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "audio/wav");
      c.setRequestProperty("Authorization", "Bearer " + prefs.getString("token", ""));
      try (OutputStream os = c.getOutputStream()) {
        os.write(wav);
      }
      httpCode = c.getResponseCode();
      if (httpCode >= 400) return null;
      StringBuilder sb = new StringBuilder();
      try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
      }
      return new JSONObject(sb.toString()).optString("text", "");
    } catch (Exception e) {
      Log.w(TAG, "transcribe failed", e);
      return null;
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

  private void ask(String q) {
    showQuestion(q);
    setStatus(msg("thinking"));
    level(0.3f);
    if (!online()) {
      setStatus(msg("offlineTitle"));
      setAnswer(msg("offline"));
      say(msg("offline"));
      return;
    }
    main.postDelayed(() -> {
      if (answerText.length() == 0 && !finished) setStatus(msg("waking"));
    }, 7000);
    long lastAt = prefs.getLong("voiceConversationAt", 0);
    String reuse = System.currentTimeMillis() - lastAt < CONVERSATION_REUSE_MS ? prefs.getString("voiceConversationId", null) : null;
    final String token = prefs.getString("token", "");
    final String api = prefs.getString("apiUrl", "https://trade-mind-ai-seven.vercel.app");
    io.execute(() -> {
      HttpURLConnection c = null;
      try {
        c = (HttpURLConnection) new URL(api + "/api/ai/ask/stream").openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(20000);
        c.setReadTimeout(90000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Authorization", "Bearer " + token);
        JSONObject body = new JSONObject().put("question", q).put("voice", true);
        if (reuse != null) body.put("conversationId", reuse);
        try (OutputStream os = c.getOutputStream()) {
          os.write(body.toString().getBytes(StandardCharsets.UTF_8));
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
        while ((line = r.readLine()) != null) {
          if (line.startsWith("event:")) {
            event = line.substring(6).trim();
          } else if (line.startsWith("data:") && event != null) {
            JSONObject data = new JSONObject(line.substring(5).trim());
            final String ev = event;
            main.post(() -> onEvent(ev, data));
          }
        }
        main.post(this::onAnswered);
      } catch (Exception e) {
        Log.w(TAG, "ask failed", e);
        main.post(() -> fail(online() ? msg("errorTitle") : msg("offlineTitle"), online() ? msg("error") : msg("offline")));
      } finally {
        if (c != null) c.disconnect();
      }
    });
  }

  private void onEvent(String event, JSONObject data) {
    if (finished) return;
    switch (event) {
      case "conversation":
        conversationId = data.optString("id", null);
        prefs.edit().putString("voiceConversationId", conversationId).putLong("voiceConversationAt", System.currentTimeMillis()).apply();
        break;
      case "chunk":
        answerText.append(data.optString("text", ""));
        setAnswer(answerText.toString().trim());
        setStatus(msg("answer"));
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
    setStatus(msg("answer"));
    if (!withCard) host.showAnswerNotification(asked, answerText.toString().trim());
    if (speakAnswers) say(answerText.toString());
    else closeIn(25000);
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
    tts.setSpeechRate("normal".equals(prefs.getString("speed", "slow")) ? 0.95f : 0.8f);
    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
      @Override public void onStart(String id) {
        main.post(() -> level(0.6f));
      }
      @Override public void onDone(String id) {
        if ("greet".equals(id)) main.post(VoiceAssistant.this::finishGreeting);
        else if (id.startsWith("last")) main.post(() -> closeIn(9000));
      }
      @Override public void onError(String id) {
        if ("greet".equals(id)) main.post(VoiceAssistant.this::finishGreeting);
        else if (id.startsWith("last")) main.post(() -> closeIn(15000));
      }
      @Override public void onRangeStart(String id, int start, int end, int frame) {
        main.post(() -> level(0.45f + (float) Math.random() * 0.5f));
      }
    });
    ttsReady = true;
    answerVoice = useLanguage(locale);
    if (!answerVoice) setFooter(msg("noVoice"));
    if (greeting) {
      greet();
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
    if (pick != null) tts.setVoice(pick);
    tts.setPitch(pick != null ? 1.0f : 0.85f);
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
    String[] list = GREETINGS.containsKey(language) ? GREETINGS.get(language) : GREETINGS.get("en");
    String t = list[(int) (Math.random() * list.length)];
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
    if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "greet") != TextToSpeech.SUCCESS) finishGreeting();
  }

  private final Runnable greetTimeout = this::finishGreeting;

  // Greeting spoken (or the voice wasn't ready in time): start listening,
  // with the engine back on the answer language.
  private void finishGreeting() {
    if (!greeting || finished) return;
    greeting = false;
    main.removeCallbacks(greetTimeout);
    if (tts != null && ttsReady) answerVoice = useLanguage(locale);
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
    List<String> parts = chunks(clean(text));
    for (int i = 0; i < parts.size(); i++) {
      String id = (i == parts.size() - 1 ? "last" : "part") + i;
      tts.speak(parts.get(i), TextToSpeech.QUEUE_ADD, null, id);
    }
    if (parts.isEmpty()) closeIn(9000);
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
    put("en", "listening", "Listening…", "thinking", "Thinking…", "waking", "Waking up the server…", "answer", "Answer",
        "offlineTitle", "No internet", "offline", "I need an internet connection to answer that. Please connect and try again.",
        "noHearTitle", "Didn't catch that", "noHear", "I didn't hear a question. Say Hey TradeMind and try again.",
        "loginTitle", "Not logged in", "login", "Please open TradeMind and log in first.",
        "errorTitle", "No answer", "error", "Sorry, I couldn't get an answer right now. Please try again in a moment.",
        "tapToOpen", "Tap to continue in TradeMind", "noVoice", "No voice for this language on this phone — showing the answer as text.");
    put("sw", "listening", "Nasikiliza…", "thinking", "Ninafikiri…", "waking", "Inaamsha seva…", "answer", "Jibu",
        "offlineTitle", "Hakuna intaneti", "offline", "Nahitaji intaneti ili kujibu. Tafadhali unganisha kisha ujaribu tena.",
        "noHearTitle", "Sikusikia", "noHear", "Sikusikia swali. Sema Hey TradeMind ujaribu tena.",
        "loginTitle", "Hujaingia", "login", "Tafadhali fungua TradeMind uingie kwanza.",
        "errorTitle", "Hakuna jibu", "error", "Samahani, siwezi kupata jibu sasa hivi. Jaribu tena baadaye kidogo.",
        "tapToOpen", "Gusa kuendelea ndani ya TradeMind", "noVoice", "Hakuna sauti ya lugha hii kwenye simu — jibu limeonyeshwa kwa maandishi.");
    put("fr", "listening", "J'écoute…", "thinking", "Je réfléchis…", "waking", "Réveil du serveur…", "answer", "Réponse",
        "offlineTitle", "Pas d'internet", "offline", "J'ai besoin d'une connexion internet pour répondre. Connectez-vous et réessayez.",
        "noHearTitle", "Pas compris", "noHear", "Je n'ai pas entendu de question. Dites Hey TradeMind et réessayez.",
        "loginTitle", "Non connecté", "login", "Ouvrez TradeMind et connectez-vous d'abord.",
        "errorTitle", "Pas de réponse", "error", "Désolé, je n'ai pas pu obtenir de réponse. Réessayez dans un instant.",
        "tapToOpen", "Touchez pour continuer dans TradeMind", "noVoice", "Pas de voix pour cette langue sur ce téléphone — réponse affichée en texte.");
    put("ar", "listening", "أستمع…", "thinking", "أفكر…", "waking", "جارٍ تشغيل الخادم…", "answer", "الإجابة",
        "offlineTitle", "لا يوجد إنترنت", "offline", "أحتاج إلى اتصال بالإنترنت للإجابة. يرجى الاتصال والمحاولة مرة أخرى.",
        "noHearTitle", "لم أفهم", "noHear", "لم أسمع سؤالاً. قل Hey TradeMind وحاول مرة أخرى.",
        "loginTitle", "غير مسجّل الدخول", "login", "يرجى فتح TradeMind وتسجيل الدخول أولاً.",
        "errorTitle", "لا توجد إجابة", "error", "عذراً، لم أتمكن من الحصول على إجابة الآن. حاول مرة أخرى بعد قليل.",
        "tapToOpen", "اضغط للمتابعة في TradeMind", "noVoice", "لا يوجد صوت لهذه اللغة على الهاتف — الإجابة معروضة كنص.");
    put("zh", "listening", "正在听…", "thinking", "正在思考…", "waking", "正在唤醒服务器…", "answer", "回答",
        "offlineTitle", "没有网络", "offline", "回答需要网络连接。请连接网络后再试。",
        "noHearTitle", "没听清", "noHear", "我没有听到问题。请说 Hey TradeMind 再试一次。",
        "loginTitle", "未登录", "login", "请先打开 TradeMind 并登录。",
        "errorTitle", "没有回答", "error", "抱歉，现在无法获取回答。请稍后再试。",
        "tapToOpen", "点击在 TradeMind 中继续", "noVoice", "此手机没有该语言的语音——以文字显示回答。");
    put("ko", "listening", "듣고 있어요…", "thinking", "생각 중…", "waking", "서버를 깨우는 중…", "answer", "답변",
        "offlineTitle", "인터넷 없음", "offline", "답하려면 인터넷 연결이 필요합니다. 연결한 뒤 다시 시도하세요.",
        "noHearTitle", "못 들었어요", "noHear", "질문을 듣지 못했어요. Hey TradeMind라고 말하고 다시 시도하세요.",
        "loginTitle", "로그인 안 됨", "login", "먼저 TradeMind를 열고 로그인하세요.",
        "errorTitle", "답변 없음", "error", "죄송합니다. 지금은 답변을 가져올 수 없습니다. 잠시 후 다시 시도하세요.",
        "tapToOpen", "눌러서 TradeMind에서 계속하기", "noVoice", "이 휴대폰에 이 언어 음성이 없어 답변을 글로 보여줍니다.");
    put("ja", "listening", "聞いています…", "thinking", "考えています…", "waking", "サーバーを起動中…", "answer", "回答",
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
