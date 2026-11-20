package com.soundify.app.media;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin providing bidirectional bridge between Soundify web frontend
 * and Android native Foreground Media Service, Lockscreen Controls & MediaSession.
 */
@CapacitorPlugin(name = "MediaSessionPlugin")
public class MediaSessionPlugin extends Plugin {

    private static MediaSessionPlugin instance;
    private static String lastTitle = "Soundify";
    private static String lastArtist = "";
    private static String lastAlbum = "";
    private static String lastCoverUrl = "";
    private static double lastDuration = 0.0;
    private static String lastTrackId = "";

    public static MediaSessionPlugin getInstance() {
        return instance;
    }

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    /**
     * Dispatches native media events (from lockscreen, Bluetooth headset, notifications, audio focus)
     * to the Capacitor JavaScript runtime.
     */
    public static void sendMediaAction(String action, JSObject data) {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("action", action);
            if (data != null) {
                ret.put("data", data);
            }
            instance.notifyListeners("mediaAction", ret);
        }
    }

    @PluginMethod
    public void startMediaService(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), SoundifyMediaService.class);
            serviceIntent.setAction(SoundifyMediaService.ACTION_START_SERVICE);
            serviceIntent.putExtra("title", lastTitle);
            serviceIntent.putExtra("artist", lastArtist);
            serviceIntent.putExtra("album", lastAlbum);
            serviceIntent.putExtra("coverUrl", lastCoverUrl);
            serviceIntent.putExtra("duration", lastDuration);
            serviceIntent.putExtra("trackId", lastTrackId);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to start media service: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void stopMediaService(PluginCall call) {
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.stopForegroundService();
            } else {
                Intent serviceIntent = new Intent(getContext(), SoundifyMediaService.class);
                getContext().stopService(serviceIntent);
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to stop media service: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        try {
            String title = call.getString("title", "Soundify");
            String artist = call.getString("artist", "");
            String album = call.getString("album", "");
            String coverUrl = call.getString("coverUrl", "");
            Double durationSeconds = call.getDouble("duration", 0.0);
            String trackId = call.getString("trackId", "");

            lastTitle = title != null ? title : "Soundify";
            lastArtist = artist != null ? artist : "";
            lastAlbum = album != null ? album : "";
            lastCoverUrl = coverUrl != null ? coverUrl : "";
            lastDuration = durationSeconds != null ? durationSeconds : 0.0;
            lastTrackId = trackId != null ? trackId : "";

            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.updateMetadata(lastTitle, lastArtist, lastAlbum, lastCoverUrl, lastDuration, lastTrackId);
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to update metadata: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        try {
            Boolean isPlaying = call.getBoolean("isPlaying", false);
            Double position = call.getDouble("position", 0.0);
            Double duration = call.getDouble("duration", 0.0);
            Double playbackRate = call.getDouble("playbackRate", 1.0);

            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.updatePlaybackState(
                    Boolean.TRUE.equals(isPlaying),
                    position != null ? position : 0.0,
                    duration != null ? duration : 0.0,
                    playbackRate != null ? playbackRate : 1.0
                );
            } else if (Boolean.TRUE.equals(isPlaying)) {
                Intent serviceIntent = new Intent(getContext(), SoundifyMediaService.class);
                serviceIntent.setAction(SoundifyMediaService.ACTION_SYNC_STATE);
                serviceIntent.putExtra("isPlaying", true);
                serviceIntent.putExtra("title", lastTitle);
                serviceIntent.putExtra("artist", lastArtist);
                serviceIntent.putExtra("album", lastAlbum);
                serviceIntent.putExtra("coverUrl", lastCoverUrl);
                serviceIntent.putExtra("duration", lastDuration > 0 ? lastDuration : (duration != null ? duration : 0.0));
                serviceIntent.putExtra("trackId", lastTrackId);
                serviceIntent.putExtra("position", position != null ? position : 0.0);
                serviceIntent.putExtra("playbackRate", playbackRate != null ? playbackRate : 1.0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to update playback state: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            boolean granted = false;
            if (service != null) {
                granted = service.requestAudioFocus();
            }
            JSObject ret = new JSObject();
            ret.put("granted", granted);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("Failed to request audio focus: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.abandonAudioFocus();
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to abandon audio focus: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void acquireWakeLock(PluginCall call) {
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.acquireWakeLock();
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to acquire wake lock: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void releaseWakeLock(PluginCall call) {
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.releaseWakeLock();
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to release wake lock: " + ex.getMessage(), ex);
        }
    }
}
