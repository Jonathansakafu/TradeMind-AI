package com.trademind.ai;

import android.content.SharedPreferences;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;

/**
 * Microphone for the "Hey TradeMind" listener and the question recorder
 * (added 2026-10-14 after "the microphone sensitivity is too low"): 16 kHz
 * mono with Android's automatic gain control and noise suppression when
 * the phone has them, plus a software boost from Settings > Hey TradeMind
 * > Microphone sensitivity (Normal 1x, High 2.5x, Maximum 4.5x).
 */
class MicInput {
  static final int RATE = 16000;

  private final AudioRecord record;
  private final float gain;
  private AutomaticGainControl agc;
  private NoiseSuppressor ns;

  /** Throws if the microphone can't be opened (busy, blocked). */
  MicInput(SharedPreferences prefs) {
    int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    record = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
    if (record.getState() != AudioRecord.STATE_INITIALIZED) {
      record.release();
      throw new IllegalStateException("microphone unavailable");
    }
    try {
      if (AutomaticGainControl.isAvailable()) {
        agc = AutomaticGainControl.create(record.getAudioSessionId());
        if (agc != null) agc.setEnabled(true);
      }
      if (NoiseSuppressor.isAvailable()) {
        ns = NoiseSuppressor.create(record.getAudioSessionId());
        if (ns != null) ns.setEnabled(true);
      }
    } catch (Exception ignored) {
    }
    gain = gainFor(prefs);
    record.startRecording();
  }

  static float gainFor(SharedPreferences prefs) {
    switch (prefs.getString("micGain", "high")) {
      case "normal": return 1.0f;
      case "max": return 4.5f;
      default: return 2.5f;
    }
  }

  /** Reads and boosts up to buf.length samples; returns the count (<= 0 on error). */
  int read(short[] buf) {
    int n = record.read(buf, 0, buf.length);
    if (gain != 1f) {
      for (int i = 0; i < n; i++) {
        int v = Math.round(buf[i] * gain);
        buf[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, v));
      }
    }
    return n;
  }

  void close() {
    try {
      record.stop();
    } catch (Exception ignored) {
    }
    record.release();
    if (agc != null) agc.release();
    if (ns != null) ns.release();
  }
}
