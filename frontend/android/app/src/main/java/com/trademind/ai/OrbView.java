package com.trademind.ai;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;

/**
 * The glowing voice orb (native twin of .tm-orb in index.css) for the
 * "Hey TradeMind" card. It follows the voice: setLevel(0..1) -- fed ~50
 * times a second from the microphone while listening and word by word
 * while TradeMind speaks -- makes it expand and swirl; at silence it
 * shrinks back and stands still. setThinking(true) keeps a slow turn while
 * the answer is on its way.
 */
public class OrbView extends View {
  private static final int[] COLORS = {0xFF22C55E, 0xFF06B6D4, 0xFF8B5CF6, 0xFFF472B6};
  private static final float[] SPEEDS = {0.31f, -0.23f, 0.18f, -0.15f}; // turns per second at full voice
  private static final float[][] OFFSETS = {{-0.22f, -0.22f}, {0.24f, -0.12f}, {0f, 0.3f}, {-0.24f, 0.22f}};

  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final float[] phase = new float[4];
  private float target = 0f;
  private float level = 0f;
  private boolean thinking = false;
  private long last = SystemClock.uptimeMillis();

  public OrbView(Context context) {
    super(context);
    setLayerType(LAYER_TYPE_HARDWARE, null);
  }

  public void setLevel(float value) {
    target = Math.max(0f, Math.min(1f, value));
  }

  public void setThinking(boolean on) {
    thinking = on;
  }

  @Override
  protected void onDraw(Canvas canvas) {
    long now = SystemClock.uptimeMillis();
    float dt = Math.min(0.1f, (now - last) / 1000f);
    last = now;
    // Quick to swell with a syllable, a little slower to settle.
    float rate = target > level ? 22f : 7f;
    level += (target - level) * Math.min(1f, dt * rate);
    target *= Math.max(0f, 1f - dt * 5f); // falls to rest unless fed again
    if (level < 0.01f) level = 0f;

    float cx = getWidth() / 2f, cy = getHeight() / 2f;
    float max = Math.min(getWidth(), getHeight()) / 2f * 0.8f;
    float r = max * (0.72f + 0.28f * level); // smaller at rest, full size at a loud voice

    // Swirl only while there is sound (or a slow turn while thinking).
    float motion = Math.max(level, thinking ? 0.15f : 0f);
    for (int i = 0; i < 4; i++) phase[i] += dt * SPEEDS[i] * motion * 3f * (float) (Math.PI * 2);

    int glow = (int) (0x30 + 0x60 * level);
    paint.setShader(new RadialGradient(cx, cy, r * 1.35f, (glow << 24) | 0x22C55E, 0x0022C55E, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r * 1.35f, paint);
    paint.setShader(new RadialGradient(cx, cy, r, 0xFF0F1A2E, 0xFF020617, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r, paint);

    for (int i = 0; i < 4; i++) {
      double cos = Math.cos(phase[i]), sin = Math.sin(phase[i]);
      float spread = 1f + 0.35f * level; // colours drift outwards with the voice
      float ox = OFFSETS[i][0] * spread, oy = OFFSETS[i][1] * spread;
      float bx = cx + (float) (ox * cos - oy * sin) * r;
      float by = cy + (float) (ox * sin + oy * cos) * r;
      int c = COLORS[i];
      paint.setShader(new RadialGradient(bx, by, r * 0.95f, new int[] {c, (c & 0x00FFFFFF) | 0x66000000, c & 0x00FFFFFF},
          new float[] {0f, 0.45f, 1f}, Shader.TileMode.CLAMP));
      canvas.drawCircle(cx, cy, r, paint);
    }

    int core = (int) (0xB0 + 0x40 * level);
    paint.setShader(new RadialGradient(cx, cy - r * 0.08f, r * 0.42f, (core << 24) | 0xFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r, paint);
    paint.setShader(null);

    if (isAttachedToWindow()) postInvalidateOnAnimation();
  }
}
