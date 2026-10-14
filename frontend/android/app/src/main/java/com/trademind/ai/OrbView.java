package com.trademind.ai;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;

/**
 * The glowing, swirling voice orb (native twin of .tm-orb in index.css) for
 * the floating "Hey TradeMind" card. setLevel(0..1) makes it swell and spin
 * faster -- fed from the microphone volume while listening and from the
 * words while speaking.
 */
public class OrbView extends View {
  private static final int[] COLORS = {0xFF22C55E, 0xFF06B6D4, 0xFF8B5CF6, 0xFFF472B6};
  private static final float[] SPEEDS = {0.31f, -0.23f, 0.18f, -0.15f}; // turns per second
  private static final float[][] OFFSETS = {{-0.22f, -0.22f}, {0.24f, -0.12f}, {0f, 0.3f}, {-0.24f, 0.22f}};

  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final float[] phase = new float[4];
  private float target = 0f;
  private float level = 0f;
  private long last = SystemClock.uptimeMillis();

  public OrbView(Context context) {
    super(context);
    setLayerType(LAYER_TYPE_HARDWARE, null);
  }

  public void setLevel(float value) {
    target = Math.max(0f, Math.min(1f, value));
  }

  @Override
  protected void onDraw(Canvas canvas) {
    long now = SystemClock.uptimeMillis();
    float dt = Math.min(0.1f, (now - last) / 1000f);
    last = now;
    level += (target - level) * Math.min(1f, dt * 8f);
    target *= Math.max(0f, 1f - dt * 1.5f); // decays unless fed again

    float cx = getWidth() / 2f, cy = getHeight() / 2f;
    float base = Math.min(getWidth(), getHeight()) / 2f * 0.74f;
    float breathe = (float) Math.sin(now / 1000.0 * 2.4) * 0.03f;
    float r = base * (1f + 0.14f * level + breathe);

    // Outer glow and dark body.
    paint.setShader(new RadialGradient(cx, cy, r * 1.35f, 0x6622C55E, 0x0022C55E, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r * 1.35f, paint);
    paint.setShader(new RadialGradient(cx, cy, r, 0xFF0F1A2E, 0xFF020617, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r, paint);

    // Coloured light blobs drifting around inside the orb.
    for (int i = 0; i < 4; i++) {
      phase[i] += dt * SPEEDS[i] * (1f + level * 2.5f) * (float) (Math.PI * 2);
      double cos = Math.cos(phase[i]), sin = Math.sin(phase[i]);
      float ox = OFFSETS[i][0], oy = OFFSETS[i][1];
      float bx = cx + (float) (ox * cos - oy * sin) * r;
      float by = cy + (float) (ox * sin + oy * cos) * r;
      int c = COLORS[i];
      paint.setShader(new RadialGradient(bx, by, r * 0.95f, new int[] {c, (c & 0x00FFFFFF) | 0x66000000, c & 0x00FFFFFF},
          new float[] {0f, 0.45f, 1f}, Shader.TileMode.CLAMP));
      canvas.drawCircle(cx, cy, r, paint);
    }

    // Bright core.
    paint.setShader(new RadialGradient(cx, cy - r * 0.08f, r * 0.42f, 0xE6FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
    canvas.drawCircle(cx, cy, r, paint);
    paint.setShader(null);

    if (isAttachedToWindow()) postInvalidateOnAnimation();
  }
}
