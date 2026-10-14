package com.trademind.ai;

import android.app.Activity;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;

/**
 * Shows the "Hey TradeMind" card on the lock screen (floating windows
 * can't appear there; activities flagged show-when-locked can, like alarm
 * and call screens), turning the screen on, so the trader can see it is
 * listening while the phone is locked or asleep. Only the card's height at
 * the bottom (or top); touches elsewhere pass through. Hosts the view
 * VoiceAssistant built; closing it ends the session.
 */
public class LockCardActivity extends Activity {
  static final String EXTRA_TOP = "top";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
    Window w = getWindow();
    w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
    w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    w.setBackgroundDrawable(new ColorDrawable(0));
    w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
    boolean top = getIntent().getBooleanExtra(EXTRA_TOP, false);
    w.setGravity((top ? Gravity.TOP : Gravity.BOTTOM) | Gravity.CENTER_HORIZONTAL);
    WindowManager.LayoutParams lp = w.getAttributes();
    lp.y = Math.round(getResources().getDisplayMetrics().density * (top ? 36 : 64));
    w.setAttributes(lp);

    VoiceAssistant a = VoiceAssistant.active;
    if (a == null || !a.attachTo(this)) finish();
  }

  @Override
  protected void onDestroy() {
    VoiceAssistant a = VoiceAssistant.active;
    if (a != null) a.onLockCardGone(this);
    super.onDestroy();
  }
}
