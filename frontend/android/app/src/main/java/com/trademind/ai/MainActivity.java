package com.trademind.ai;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    WebView.setWebContentsDebuggingEnabled(true);
    registerPlugin(WakeWordPlugin.class); // "Hey TradeMind" wake word
    registerPlugin(ImageClipboardPlugin.class); // copy charts / screenshots as images
    super.onCreate(savedInstanceState);
  }
}
