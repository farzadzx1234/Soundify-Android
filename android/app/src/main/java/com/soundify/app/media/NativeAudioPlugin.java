package com.soundify.app.media;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin exposing Native Android Media3 ExoPlayer streaming
 * to the Soundify frontend for ultra-fast external audio startup,
 * resilient HTTP buffering, HLS/AAC/Opus/MP3 decoding, and background continuity.
 */
@CapacitorPlugin(name = "NativeAudioPlugin")
public class NativeAudioPlugin extends Plugin {

    private static NativeAudioPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    public static void emitState(JSObject payload) {
        if (instance != null && payload != null) {
            instance.notifyListeners("nativeAudioState", payload);
        }
    }

    @PluginMethod
    public void playStream(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Stream url is required");
            return;
        }

        String authToken = call.getString("authToken", "");
        Double startSec = call.getDouble("startSec", 0.0);
        Double rate = call.getDouble("playbackRate", 1.0);
        Double vol = call.getDouble("volume", 1.0);
        String title = call.getString("title", "Soundify");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");
        Double duration = call.getDouble("duration", 0.0);
        String trackId = call.getString("trackId", "");

        double safeStart = startSec != null && startSec > 0 ? startSec : 0.0;
        float safeRate = rate != null && rate > 0 ? rate.floatValue() : 1.0f;
        float safeVol = vol != null ? Math.max(0.0f, Math.min(1.0f, vol.floatValue())) : 1.0f;
        double safeDuration = duration != null && duration > 0 ? duration : 0.0;

        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                service.playNativeStream(
                    url.trim(),
                    authToken != null ? authToken : "",
                    safeStart,
                    safeRate,
                    safeVol,
                    title != null ? title : "Soundify",
                    artist != null ? artist : "",
                    album != null ? album : "",
                    coverUrl != null ? coverUrl : "",
                    safeDuration,
                    trackId != null ? trackId : ""
                );
            } else {
                Intent intent = new Intent(getContext(), SoundifyMediaService.class);
                intent.setAction(SoundifyMediaService.ACTION_PLAY_NATIVE_STREAM);
                intent.putExtra("url", url.trim());
                intent.putExtra("authToken", authToken != null ? authToken : "");
                intent.putExtra("startSec", safeStart);
                intent.putExtra("playbackRate", (double) safeRate);
                intent.putExtra("volume", (double) safeVol);
                intent.putExtra("title", title != null ? title : "Soundify");
                intent.putExtra("artist", artist != null ? artist : "");
                intent.putExtra("album", album != null ? album : "");
                intent.putExtra("coverUrl", coverUrl != null ? coverUrl : "");
                intent.putExtra("duration", safeDuration);
                intent.putExtra("trackId", trackId != null ? trackId : "");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(intent);
                } else {
                    getContext().startService(intent);
                }
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to play native stream: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativePlay();
        }
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativePause();
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeStop();
        }
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double pos = call.getDouble("position", 0.0);
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeSeek(pos != null ? pos : 0.0);
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double vol = call.getDouble("volume", 1.0);
        float safeVol = vol != null ? Math.max(0.0f, Math.min(1.0f, vol.floatValue())) : 1.0f;
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeSetVolume(safeVol);
        }
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackRate(PluginCall call) {
        Double rate = call.getDouble("rate", 1.0);
        float safeRate = rate != null && rate > 0 ? rate.floatValue() : 1.0f;
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeSetPlaybackRate(safeRate);
        }
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            call.resolve(service.getNativeStateSnapshot());
        } else {
            JSObject ret = new JSObject();
            ret.put("active", false);
            ret.put("isPlaying", false);
            ret.put("isBuffering", false);
            ret.put("position", 0.0);
            ret.put("duration", 0.0);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void prepareNextStream(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.resolve();
            return;
        }
        String authToken = call.getString("authToken", "");
        Double startSec = call.getDouble("startSec", 0.0);
        Double rate = call.getDouble("playbackRate", 1.0);
        String trackId = call.getString("trackId", "");

        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.prepareNextNativeStream(
                url.trim(),
                authToken != null ? authToken : "",
                startSec != null && startSec > 0 ? startSec : 0.0,
                rate != null && rate > 0 ? rate.floatValue() : 1.0f,
                trackId != null ? trackId : ""
            );
        }
        call.resolve();
    }

    @PluginMethod
    public void startCrossfade(PluginCall call) {
        Double crossfadeMs = call.getDouble("crossfadeMs", 5000.0);
        Double vol = call.getDouble("volume", 1.0);
        String title = call.getString("title", "Soundify");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");
        Double duration = call.getDouble("duration", 0.0);
        String trackId = call.getString("trackId", "");

        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.startNativeCrossfade(
                crossfadeMs != null ? crossfadeMs.longValue() : 5000L,
                vol != null ? Math.max(0.0f, Math.min(1.0f, vol.floatValue())) : 1.0f,
                title != null ? title : "Soundify",
                artist != null ? artist : "",
                album != null ? album : "",
                coverUrl != null ? coverUrl : "",
                duration != null && duration > 0 ? duration : 0.0,
                trackId != null ? trackId : ""
            );
        }
        call.resolve();
    }

    @PluginMethod
    public void cancelCrossfade(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.cancelNativeCrossfade();
        }
        call.resolve();
    }
}
