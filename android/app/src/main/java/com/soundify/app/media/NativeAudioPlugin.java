package com.soundify.app.media;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Capacitor Plugin exposing Native Android Media3 ExoPlayer streaming
 * to the Soundify frontend for ultra-fast external audio startup,
 * resilient HTTP buffering, HLS/AAC/Opus/MP3 decoding, background continuity,
 * and live audio output device detection (Bluetooth AirPods / Wired / USB).
 */
@CapacitorPlugin(
    name = "NativeAudioPlugin",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = { Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class NativeAudioPlugin extends Plugin {

    private static NativeAudioPlugin instance;
    private AudioManager audioManager;
    private AudioDeviceCallback audioDeviceCallback;
    private BroadcastReceiver outputReceiver;
    private final Handler outputHandler = new Handler(Looper.getMainLooper());
    private final Runnable emitOutputRunnable = this::emitCurrentAudioOutput;

    @Override
    public void load() {
        super.load();
        instance = this;
        registerAudioOutputMonitors();
    }

    @Override
    protected void handleOnDestroy() {
        unregisterAudioOutputMonitors();
        super.handleOnDestroy();
    }

    private void registerAudioOutputMonitors() {
        try {
            Context ctx = getContext();
            if (ctx == null) return;
            audioManager = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioDeviceCallback = new AudioDeviceCallback() {
                    @Override
                    public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                        scheduleAudioOutputEmit();
                    }

                    @Override
                    public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                        scheduleAudioOutputEmit();
                    }
                };
                audioManager.registerAudioDeviceCallback(audioDeviceCallback, outputHandler);
            }
            outputReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    scheduleAudioOutputEmit();
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            filter.addAction(AudioManager.ACTION_HEADSET_PLUG);
            filter.addAction(AudioManager.ACTION_HDMI_AUDIO_PLUG);
            filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
            filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
            filter.addAction(BluetoothAdapter.ACTION_CONNECTION_STATE_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(outputReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ctx.registerReceiver(outputReceiver, filter);
            }
        } catch (Throwable ignored) {}
    }

    private void unregisterAudioOutputMonitors() {
        try {
            outputHandler.removeCallbacksAndMessages(null);
            if (audioManager != null && audioDeviceCallback != null) {
                audioManager.unregisterAudioDeviceCallback(audioDeviceCallback);
            }
            Context ctx = getContext();
            if (ctx != null && outputReceiver != null) {
                ctx.unregisterReceiver(outputReceiver);
            }
        } catch (Throwable ignored) {}
    }

    private void scheduleAudioOutputEmit() {
        outputHandler.removeCallbacks(emitOutputRunnable);
        emitCurrentAudioOutput();
        outputHandler.postDelayed(emitOutputRunnable, 450L);
        outputHandler.postDelayed(emitOutputRunnable, 1400L);
    }

    private void emitCurrentAudioOutput() {
        try {
            notifyListeners("audioOutputChanged", resolveAudioOutputPayload());
        } catch (Throwable ignored) {}
    }

    private boolean isBluetoothConnectAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private String cleanDeviceProductName(CharSequence rawName) {
        if (rawName == null) return "";
        String trimmed = rawName.toString().trim();
        if (trimmed.isEmpty()) return "";
        String model = Build.MODEL != null ? Build.MODEL.trim() : "";
        if (!model.isEmpty() && trimmed.equalsIgnoreCase(model)) return "";
        if (trimmed.equalsIgnoreCase("android") || trimmed.equalsIgnoreCase("phone")) return "";
        return trimmed;
    }

    private JSObject resolveAudioOutputPayload() {
        JSObject ret = new JSObject();
        ret.put("kind", "speaker");
        ret.put("name", "");
        ret.put("permissionNeeded", false);
        try {
            Context ctx = getContext();
            if (ctx == null) return ret;
            AudioManager am = audioManager != null
                ? audioManager
                : (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return ret;

            AudioDeviceInfo[] outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            AudioDeviceInfo btDevice = null;
            AudioDeviceInfo usbDevice = null;
            AudioDeviceInfo wiredDevice = null;

            for (AudioDeviceInfo dev : outputs) {
                int type = dev.getType();
                if (
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    (Build.VERSION.SDK_INT >= 31 && (
                        type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                        type == AudioDeviceInfo.TYPE_BLE_BROADCAST
                    )) ||
                    type == AudioDeviceInfo.TYPE_HEARING_AID
                ) {
                    if (btDevice == null) btDevice = dev;
                } else if (
                    type == AudioDeviceInfo.TYPE_USB_HEADSET ||
                    type == AudioDeviceInfo.TYPE_USB_DEVICE
                ) {
                    if (usbDevice == null) usbDevice = dev;
                } else if (
                    type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                ) {
                    if (wiredDevice == null) wiredDevice = dev;
                }
            }

            if (btDevice != null) {
                ret.put("kind", "bluetooth");
                String name = cleanDeviceProductName(btDevice.getProductName());
                if (name.isEmpty() && isBluetoothConnectAllowed(ctx)) {
                    try {
                        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                        if (adapter != null) {
                            for (BluetoothDevice bonded : adapter.getBondedDevices()) {
                                if (bonded != null && bonded.getName() != null && !bonded.getName().trim().isEmpty()) {
                                    int a2dpState = adapter.getProfileConnectionState(BluetoothProfile.A2DP);
                                    if (a2dpState == BluetoothProfile.STATE_CONNECTED) {
                                        name = bonded.getName().trim();
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (Throwable ignored) {}
                }
                if (name.isEmpty() && !isBluetoothConnectAllowed(ctx)) {
                    ret.put("permissionNeeded", true);
                }
                ret.put("name", name);
                return ret;
            }
            if (usbDevice != null) {
                ret.put("kind", "usb");
                ret.put("name", cleanDeviceProductName(usbDevice.getProductName()));
                return ret;
            }
            if (wiredDevice != null) {
                ret.put("kind", "wired");
                ret.put("name", cleanDeviceProductName(wiredDevice.getProductName()));
                return ret;
            }
        } catch (Throwable ignored) {}
        return ret;
    }

    @PluginMethod
    public void getAudioOutputDevice(PluginCall call) {
        call.resolve(resolveAudioOutputPayload());
    }

    @PluginMethod
    public void requestBluetoothPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            call.resolve(resolveAudioOutputPayload());
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        emitCurrentAudioOutput();
        call.resolve(resolveAudioOutputPayload());
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
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        getContext().startForegroundService(intent);
                    } else {
                        getContext().startService(intent);
                    }
                } catch (Exception fgsEx) {
                    try {
                        getContext().startService(intent);
                    } catch (Exception ignored) {}
                }
            }
            call.resolve();
        } catch (Throwable ex) {
            call.reject("Failed to play native stream: " + ex.getMessage());
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
        try {
            SoundifyMediaService service = SoundifyMediaService.getInstance();
            if (service != null) {
                call.resolve(service.getNativeStateSnapshot());
                return;
            }
        } catch (Throwable ignored) {}
        JSObject ret = new JSObject();
        ret.put("active", false);
        ret.put("isPlaying", false);
        ret.put("isBuffering", false);
        ret.put("position", 0.0);
        ret.put("duration", 0.0);
        call.resolve(ret);
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
        String title = call.getString("title", "Soundify");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");
        Double duration = call.getDouble("duration", 0.0);

        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.prepareNextNativeStream(
                url.trim(),
                authToken != null ? authToken : "",
                startSec != null && startSec > 0 ? startSec : 0.0,
                rate != null && rate > 0 ? rate.floatValue() : 1.0f,
                trackId != null ? trackId : "",
                title != null ? title : "Soundify",
                artist != null ? artist : "",
                album != null ? album : "",
                coverUrl != null ? coverUrl : "",
                duration != null && duration > 0 ? duration : 0.0
            );
        }
        call.resolve();
    }

    @PluginMethod
    public void fadeOutAndStop(PluginCall call) {
        Double fadeMs = call.getDouble("fadeMs", 4000.0);
        long safeFadeMs = fadeMs != null ? Math.max(400L, fadeMs.longValue()) : 4000L;
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.fadeOutAndStopNative(safeFadeMs);
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
    public void scheduleAutoMixPlan(PluginCall call) {
        String mode = call.getString("mode", "BEAT_SYNC_PHRASE");
        String trackAId = call.getString("trackAId", "");
        String trackBId = call.getString("trackBId", "");
        Long startSampleOnTrackA = call.getLong("startSampleOnTrackA", 0L);
        Long startOffsetSampleOnTrackB = call.getLong("startOffsetSampleOnTrackB", 0L);
        Long durationSamples = call.getLong("durationSamples", 0L);
        Double initialTempoRatioB = call.getDouble("initialTempoRatioB", 1.0);
        Double targetTempoRatioA = call.getDouble("targetTempoRatioA", 1.0);
        Double tempoLockCompleteProgress = call.getDouble("tempoLockCompleteProgress", 0.75);
        Double bassSwapProgress = call.getDouble("bassSwapProgress", 0.50);
        Double gainCompensationDbB = call.getDouble("gainCompensationDbB", 0.0);
        Integer sampleRate = call.getInt("sampleRate", 44100);
        Double vol = call.getDouble("volume", 1.0);
        String title = call.getString("title", "Soundify");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");
        Double duration = call.getDouble("duration", 0.0);

        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.scheduleNativeAutoMixPlan(
                new AutoMixPcmAnalyzer.AutoMixPlanNative(
                    mode != null ? mode : "BEAT_SYNC_PHRASE",
                    trackAId != null ? trackAId : "",
                    trackBId != null ? trackBId : "",
                    sampleRate != null && sampleRate >= 8000 ? sampleRate : 44100,
                    startSampleOnTrackA != null ? Math.max(0L, startSampleOnTrackA) : 0L,
                    startOffsetSampleOnTrackB != null ? Math.max(0L, startOffsetSampleOnTrackB) : 0L,
                    durationSamples != null ? Math.max(4096L, durationSamples) : 154350L,
                    initialTempoRatioB != null ? initialTempoRatioB.floatValue() : 1.0f,
                    targetTempoRatioA != null ? targetTempoRatioA.floatValue() : 1.0f,
                    tempoLockCompleteProgress != null ? tempoLockCompleteProgress : 0.75,
                    bassSwapProgress != null ? bassSwapProgress : 0.50,
                    gainCompensationDbB != null ? gainCompensationDbB : 0.0
                ),
                vol != null ? Math.max(0.0f, Math.min(1.0f, vol.floatValue())) : 1.0f,
                title != null ? title : "Soundify",
                artist != null ? artist : "",
                album != null ? album : "",
                coverUrl != null ? coverUrl : "",
                duration != null && duration > 0 ? duration : 0.0
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

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String mode = call.getString("mode", "off");
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeSetRepeatMode(mode != null ? mode : "off");
        }
        call.resolve();
    }

    @PluginMethod
    public void syncQueue(PluginCall call) {
        String queueJson = call.getString("queueJson", "[]");
        Integer currentIndex = call.getInt("currentIndex", -1);
        String currentTrackId = call.getString("currentTrackId", "");
        Boolean shuffle = call.getBoolean("shuffle", false);
        String repeatMode = call.getString("repeatMode", "off");
        Boolean autoMixEnabled = call.getBoolean("autoMixEnabled", true);
        String authToken = call.getString("authToken", "");

        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.syncNativeQueue(
                queueJson != null ? queueJson : "[]",
                currentIndex != null ? currentIndex : -1,
                currentTrackId != null ? currentTrackId : "",
                Boolean.TRUE.equals(shuffle),
                repeatMode != null ? repeatMode : "off",
                autoMixEnabled == null || Boolean.TRUE.equals(autoMixEnabled),
                authToken != null ? authToken : ""
            );
        }
        call.resolve();
    }

    @PluginMethod
    public void setAutoMixEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.setNativeAutoMixEnabled(enabled == null || Boolean.TRUE.equals(enabled));
        }
        call.resolve();
    }

    @PluginMethod
    public void replay(PluginCall call) {
        SoundifyMediaService service = SoundifyMediaService.getInstance();
        if (service != null) {
            service.nativeReplay();
        }
        call.resolve();
    }
}
