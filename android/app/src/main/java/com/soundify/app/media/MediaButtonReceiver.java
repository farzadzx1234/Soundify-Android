package com.soundify.app.media;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.KeyEvent;

/**
 * BroadcastReceiver for hardware headset, Bluetooth AVRCP, and car steering wheel media buttons.
 */
public class MediaButtonReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || context == null) return;

        if (Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
            KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
            if (event != null && event.getAction() == KeyEvent.ACTION_DOWN) {
                Intent serviceIntent = new Intent(context, SoundifyMediaService.class);
                serviceIntent.setAction(SoundifyMediaService.ACTION_MEDIA_BUTTON);
                serviceIntent.putExtra(Intent.EXTRA_KEY_EVENT, event);

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent);
                    } else {
                        context.startService(serviceIntent);
                    }
                } catch (Exception ignored) {}
            }
        }
    }
}
