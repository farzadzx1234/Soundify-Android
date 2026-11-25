package com.soundify.app.media;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;
import android.view.KeyEvent;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.mp3.Mp3Extractor;

import com.getcapacitor.JSObject;
import com.soundify.app.MainActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Soundify Android Foreground Media Service
 *
 * Implements:
 * - Ongoing media foreground service with FOREGROUND_SERVICE_MEDIA_PLAYBACK (Android 14+ strict compliant)
 * - PowerManager.WakeLock for uninterrupted audio playback in Doze mode
 * - Platform MediaSession with Lockscreen controls, Quick Settings shade media widget, and seekbar
 * - Audio Focus management (loss, transient loss on phone calls, ducking on navigation, gain resumption)
 * - Becoming Noisy broadcast receiver (auto-pauses on headphone / Bluetooth disconnection)
 * - Hardware media buttons & Bluetooth AVRCP headset control
 */
public class SoundifyMediaService extends Service {

    public static final String ACTION_START_SERVICE = "com.soundify.app.action.START_SERVICE";
    public static final String ACTION_SYNC_STATE = "com.soundify.app.action.SYNC_STATE";
    public static final String ACTION_PLAY = "com.soundify.app.action.PLAY";
    public static final String ACTION_PAUSE = "com.soundify.app.action.PAUSE";
    public static final String ACTION_PLAY_PAUSE = "com.soundify.app.action.PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.soundify.app.action.NEXT";
    public static final String ACTION_PREV = "com.soundify.app.action.PREV";
    public static final String ACTION_STOP = "com.soundify.app.action.STOP";
    public static final String ACTION_SEEK = "com.soundify.app.action.SEEK";
    public static final String ACTION_UPDATE_METADATA = "com.soundify.app.action.UPDATE_METADATA";
    public static final String ACTION_PLAY_NATIVE_STREAM = "com.soundify.app.action.PLAY_NATIVE_STREAM";
    public static final String ACTION_MEDIA_BUTTON = "android.intent.action.MEDIA_BUTTON";

    private static final String APP_USER_AGENT = "Soundify-Android/1.0.46";
    private static final String APP_VERSION_HEADER = "1.0.46";

    private static final String CHANNEL_ID = "soundify_media_playback";
    private static final int NOTIFICATION_ID = 2001;
    private static final String WAKE_LOCK_TAG = "Soundify:MediaPlaybackWakeLock";
    private static final String WIFI_LOCK_TAG = "Soundify:MediaPlaybackWifiLock";
    private static final String DEFAULT_BASE_URL = "https://soundify.mashhad-ix.ir";

    private static SoundifyMediaService instance;

    private MediaSession mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executorService = Executors.newSingleThreadExecutor();
    private final ExecutorService autoMixAnalyzerExecutor = Executors.newSingleThreadExecutor();

    private boolean isPlaying = false;
    private boolean isForeground = false;
    private boolean wasPlayingBeforeTransientLoss = false;
    private boolean isBecomingNoisyRegistered = false;

    private String currentTitle = "Soundify";
    private String currentArtist = "";
    private String currentAlbum = "";
    private String currentCoverUrl = "";
    private String currentTrackId = "";
    private double currentPositionSec = 0.0;
    private double currentDurationSec = 0.0;
    private double currentPlaybackRate = 1.0;
    private Bitmap cachedArtworkBitmap = null;
    private final AtomicInteger artworkRequestSeq = new AtomicInteger(0);

    private ExoPlayer nativePlayer = null;
    private ExoPlayer nextDeckPlayer = null;
    private ExoPlayer fadingOutPlayer = null;
    private AutoMixDspProcessor nativeDeckDsp = null;
    private AutoMixDspProcessor nextDeckDsp = null;
    private AutoMixDspProcessor fadingOutDsp = null;
    private DefaultHttpDataSource.Factory nativeHttpFactory = null;
    private volatile boolean nativeAudioActive = false;
    private volatile boolean isCrossfading = false;
    private volatile boolean isSwitchingNativeTrack = false;
    private int quietOutroTicks = 0;
    private int silenceOutroTicks = 0;
    private int instrumentalOutroTicks = 0;
    private int vocalDipTicks = 0;
    private int fadeOutSlopeTicks = 0;
    private float prevFadeLiveRms = 1.0f;
    private volatile boolean nextDeckIntroScanning = false;
    private volatile boolean nextDeckIntroScanDone = false;
    private volatile boolean nextDeckIntroScanStartedPlayback = false;
    private long nextDeckIntroScanPrepWallMs = 0L;
    private long nextDeckIntroScanStartWallMs = 0L;
    private long nextDeckFirstAudibleMs = -1L;
    private long nextDeckFirstMusicBodyMs = -1L;
    private int nextDeckAudibleTicks = 0;
    private float nextDeckTargetPlaybackRate = 1.0f;
    private String nextDeckTrackId = "";
    private String nextDeckStreamUrl = "";
    private String nextDeckTitle = "Soundify";
    private String nextDeckArtist = "";
    private String nextDeckAlbum = "";
    private String nextDeckCoverUrl = "";
    private double nextDeckDurationSec = 0.0;
    private long nextDeckStartMs = 0L;
    private String lastNativeStreamUrl = "";
    private String lastNativeAuthToken = "";
    private volatile String nativeRepeatMode = "off";
    private volatile boolean nativeShuffle = false;
    private volatile boolean nativeAutoMixEnabled = true;
    private static final class NativeQueueEntry {
        final String id;
        final String url;
        final String title;
        final String artist;
        final String album;
        final String coverUrl;
        final double durationSec;

        NativeQueueEntry(
            String id,
            String url,
            String title,
            String artist,
            String album,
            String coverUrl,
            double durationSec
        ) {
            this.id = id;
            this.url = url;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.coverUrl = coverUrl;
            this.durationSec = durationSec;
        }
    }
    private final List<NativeQueueEntry> nativeQueue = new ArrayList<>();
    private int nativeQueueIndex = -1;
    private int pendingNextQueueIndex = -1;
    private final Random queueShuffleRandom = new Random();
    private long crossfadeStartMs = 0L;
    private long crossfadeInvokedMs = 0L;
    private long crossfadePositionFloorMs = 0L;
    private long crossfadePositionGuardUntilMs = 0L;
    private boolean crossfadeIncomingReady = false;
    private boolean crossfadeFadeInOnly = false;
    private long crossfadeDurationMs = 7500L;
    private volatile AutoMixPcmAnalyzer.AutoMixPlanNative scheduledAutoMixPlan = null;
    private final AtomicInteger autoMixPlanSeq = new AtomicInteger(0);
    private volatile boolean sampleAccurateDspCrossfade = false;
    private volatile boolean crossfadeTempoSync = false;
    private float crossfadeInitialTempoRatioB = 1.0f;
    private float crossfadeTargetTempoRatioA = 1.0f;
    private double crossfadeTempoLockCompleteProgress = 0.75;
    private float crossfadeGainCompLinear = 1.0f;
    private volatile boolean pendingCrossfade = false;
    private long pendingCrossfadeMs = 7500L;
    private float pendingCrossfadeTargetVolume = 1.0f;
    private String pendingCrossfadeTitle = "Soundify";
    private String pendingCrossfadeArtist = "";
    private String pendingCrossfadeAlbum = "";
    private String pendingCrossfadeCoverUrl = "";
    private double pendingCrossfadeDurationSec = 0.0;
    private String pendingCrossfadeTrackId = "";
    private long fadeOutStartMs = 0L;
    private long fadeOutDurationMs = 7500L;
    private float fadeOutInitialVolume = 1.0f;
    private float currentNativeVolume = 1.0f;
    private float crossfadeTargetVolume = 1.0f;
    private String crossfadeTitle = "Soundify";
    private String crossfadeArtist = "";
    private String crossfadeAlbum = "";
    private String crossfadeCoverUrl = "";
    private double crossfadeNextDurationSec = 0.0;
    private String crossfadeNextTrackId = "";

    private void resetOutroCounters() {
        quietOutroTicks = 0;
        silenceOutroTicks = 0;
        instrumentalOutroTicks = 0;
        vocalDipTicks = 0;
        fadeOutSlopeTicks = 0;
        prevFadeLiveRms = 1.0f;
    }

    private long computeSmartScannedCueMs() {
        // Soundify Mix: only trim leading dead silence (<= 3.5s max) so Track B NEVER jumps randomly mid-song
        long cueMs = nextDeckStartMs;
        if (nextDeckFirstAudibleMs > 450L) {
            cueMs = Math.max(0L, nextDeckFirstAudibleMs - 200L);
        }
        if (nextDeckDurationSec > 0.0) {
            long maxSafeCueMs = Math.max(0L, (long) (nextDeckDurationSec * 250.0));
            cueMs = Math.min(cueMs, maxSafeCueMs);
        }
        return Math.max(0L, Math.min(3500L, cueMs));
    }

    private void finishNextDeckIntroScanOnMainThread(long cueMs) {
        mainHandler.removeCallbacks(nextDeckIntroScanTicker);
        nextDeckIntroScanning = false;
        nextDeckIntroScanDone = true;
        nextDeckIntroScanStartedPlayback = false;
        if (nextDeckPlayer != null) {
            try {
                nextDeckPlayer.setPlayWhenReady(false);
                nextDeckPlayer.pause();
                nextDeckPlayer.setVolume(0.0f);
                nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(nextDeckTargetPlaybackRate > 0 ? nextDeckTargetPlaybackRate : 1.0f));
                if (nextDeckPlayer.getPlaybackState() != Player.STATE_IDLE && nextDeckPlayer.isCurrentMediaItemSeekable()) {
                    nextDeckPlayer.seekTo(Math.max(0L, cueMs));
                }
            } catch (Exception ignored) {}
        }
        nextDeckStartMs = Math.max(0L, cueMs);
        if (nextDeckDsp != null) {
            nextDeckDsp.resetTrackStats();
        }
    }

    private void abortNextDeckIntroScanOnMainThread() {
        mainHandler.removeCallbacks(nextDeckIntroScanTicker);
        if (!nextDeckIntroScanning && !nextDeckIntroScanStartedPlayback) {
            return;
        }
        long resolvedCue = nextDeckStartMs;
        if (nextDeckFirstAudibleMs >= 0L || nextDeckFirstMusicBodyMs >= 0L) {
            resolvedCue = computeSmartScannedCueMs();
        }
        finishNextDeckIntroScanOnMainThread(resolvedCue);
    }

    private final Runnable nextDeckIntroScanTicker = new Runnable() {
        @Override
        public void run() {
            try {
                if (!nextDeckIntroScanning || isCrossfading || pendingCrossfade || !nativeAudioActive) {
                    nextDeckIntroScanning = false;
                    mainHandler.removeCallbacks(this);
                    return;
                }
                if (nextDeckPlayer == null || nextDeckTrackId.isEmpty() || nextDeckDsp == null) {
                    nextDeckIntroScanning = false;
                    return;
                }
                PlaybackException err = nextDeckPlayer.getPlayerError();
                int st = nextDeckPlayer.getPlaybackState();
                if (err != null) {
                    nextDeckIntroScanning = false;
                    return;
                }
                long now = SystemClock.elapsedRealtime();

                if (!nextDeckIntroScanStartedPlayback) {
                    if (st == Player.STATE_READY) {
                        if (!nextDeckPlayer.isCurrentMediaItemSeekable()) {
                            nextDeckIntroScanning = false;
                            nextDeckIntroScanDone = true;
                            try {
                                nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(nextDeckTargetPlaybackRate > 0 ? nextDeckTargetPlaybackRate : 1.0f));
                            } catch (Exception ignored) {}
                            return;
                        }
                        nextDeckIntroScanStartedPlayback = true;
                        nextDeckIntroScanStartWallMs = now;
                        nextDeckAudibleTicks = 0;
                        nextDeckFirstAudibleMs = -1L;
                        nextDeckFirstMusicBodyMs = -1L;
                        try {
                            nextDeckPlayer.setAudioAttributes(buildMediaAudioAttributes(), false);
                            nextDeckPlayer.setVolume(0.0f);
                            nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(3.0f));
                            nextDeckPlayer.setPlayWhenReady(true);
                            nextDeckPlayer.play();
                        } catch (Exception ignored) {
                            finishNextDeckIntroScanOnMainThread(nextDeckStartMs);
                            return;
                        }
                        mainHandler.postDelayed(this, 40L);
                        return;
                    }
                    if (now - nextDeckIntroScanPrepWallMs >= 10_000L) {
                        nextDeckIntroScanning = false;
                        return;
                    }
                    mainHandler.postDelayed(this, 60L);
                    return;
                }

                if (nextDeckDsp.getProcessedBlocks() < 2) {
                    if ((now - nextDeckIntroScanStartWallMs) >= 4800L) {
                        finishNextDeckIntroScanOnMainThread(nextDeckStartMs);
                        return;
                    }
                    mainHandler.postDelayed(this, 40L);
                    return;
                }

                long posMs = Math.max(0L, nextDeckPlayer.getCurrentPosition());
                float live = nextDeckDsp.getLiveRms();
                float bass = nextDeckDsp.getBassRms();

                if (live >= 0.024f || bass >= 0.015f) {
                    nextDeckAudibleTicks++;
                    if (nextDeckAudibleTicks >= 2 && nextDeckFirstAudibleMs < 0L) {
                        nextDeckFirstAudibleMs = Math.max(0L, posMs - 160L);
                    }
                } else {
                    nextDeckAudibleTicks = 0;
                }

                if (live >= 0.062f || bass >= 0.038f) {
                    nextDeckFirstMusicBodyMs = posMs;
                }

                boolean timedOut = (now - nextDeckIntroScanStartWallMs) >= 4800L;
                if (nextDeckFirstMusicBodyMs >= 0L || posMs >= 14500L || timedOut || st == Player.STATE_ENDED) {
                    finishNextDeckIntroScanOnMainThread(computeSmartScannedCueMs());
                    return;
                }
                mainHandler.postDelayed(this, 40L);
            } catch (Throwable ignored) {
                nextDeckIntroScanning = false;
            }
        }
    };

    private final Runnable nativeProgressTicker = new Runnable() {
        @Override
        public void run() {
            try {
                runNativeProgressTickInternal();
            } catch (Throwable ignored) {
                if (nativeAudioActive) {
                    mainHandler.postDelayed(this, 500L);
                }
            }
        }

        private void runNativeProgressTickInternal() {
            if (nativeAudioActive && nativePlayer != null && nativePlayer.isPlaying()) {
                if (isSwitchingNativeTrack) {
                    mainHandler.postDelayed(this, 250L);
                    return;
                }
                long posMs = Math.max(0L, nativePlayer.getCurrentPosition());
                long nowMs = SystemClock.elapsedRealtime();
                if (nowMs < crossfadePositionGuardUntilMs && Math.abs(posMs - crossfadePositionFloorMs) > 2500L) {
                    posMs = crossfadePositionFloorMs;
                } else if (nowMs >= crossfadePositionGuardUntilMs) {
                    crossfadePositionGuardUntilMs = 0L;
                }
                long durMs = nativePlayer.getDuration();
                currentPositionSec = posMs / 1000.0;
                if (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET) {
                    currentDurationSec = durMs / 1000.0;
                }
                applyPlaybackState();
                emitNativeState("state", null);

                // Autonomous screen-off queue pre-buffer so AutoMix & Loop never stall when Chromium JS sleeps
                double quickRemSec = currentDurationSec > 0 ? Math.max(0.0, currentDurationSec - currentPositionSec) : 999.0;
                if (
                    !"one".equals(nativeRepeatMode) &&
                    !isCrossfading &&
                    !pendingCrossfade &&
                    (nextDeckTrackId == null || nextDeckTrackId.isEmpty()) &&
                    !nativeQueue.isEmpty() &&
                    (quickRemSec <= 45.0 || (currentDurationSec <= 0.0 && currentPositionSec >= 10.0))
                ) {
                    maybeAutoPrepareNextFromQueueOnMainThread();
                }

                // Sample-Accurate Stage 2 Native Plan Trigger (zero JS timer jitter)
                AutoMixPcmAnalyzer.AutoMixPlanNative activePlan = scheduledAutoMixPlan;
                boolean hasValidPlanForPair =
                    nativeAutoMixEnabled &&
                    activePlan != null &&
                    currentTrackId.equals(activePlan.trackAId) &&
                    !nextDeckTrackId.isEmpty() &&
                    nextDeckTrackId.equals(activePlan.trackBId);

                if (
                    nativeAutoMixEnabled &&
                    !isCrossfading &&
                    !pendingCrossfade &&
                    !"one".equals(nativeRepeatMode) &&
                    hasValidPlanForPair &&
                    nextDeckPlayer != null &&
                    nextDeckPlayer.getPlaybackState() == Player.STATE_READY
                ) {
                    long planStartMsA = (activePlan.startSampleOnTrackA * 1000L) / Math.max(8000, activePlan.sampleRate);
                    if (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET) {
                        planStartMsA = Math.max(planStartMsA, Math.max(0L, durMs - 20000L));
                    }
                    long planDurMs = Math.min(7000L, Math.max(1200L, (activePlan.durationSamples * 1000L) / Math.max(8000, activePlan.sampleRate)));
                    if (posMs >= planStartMsA || (currentDurationSec >= 12.0 && quickRemSec <= 3.8 && quickRemSec >= 1.0)) {
                        long effectivePlanDurMs = posMs >= planStartMsA
                            ? planDurMs
                            : Math.max(1800L, Math.min(planDurMs, (long) ((quickRemSec - 0.18) * 1000.0)));
                        resetOutroCounters();
                        executeReadyNativeCrossfade(
                            effectivePlanDurMs,
                            currentNativeVolume,
                            nextDeckTitle,
                            nextDeckArtist,
                            nextDeckAlbum,
                            nextDeckCoverUrl,
                            nextDeckDurationSec,
                            nextDeckTrackId,
                            false
                        );
                        return;
                    }
                }

                // Live DSP Fade-Out & Zero-Skip Tail Safety Net (runs even when screen is off or track has strong outro)
                if (
                    nativeAutoMixEnabled &&
                    !isCrossfading &&
                    !pendingCrossfade &&
                    !"one".equals(nativeRepeatMode) &&
                    nextDeckPlayer != null &&
                    !nextDeckTrackId.isEmpty() &&
                    currentDurationSec >= 12.0
                ) {
                    double remSec = currentDurationSec - currentPositionSec;
                    int nextState = nextDeckPlayer.getPlaybackState();
                    float body = nativeDeckDsp != null ? nativeDeckDsp.getBodyRms() : 0.1f;
                    float live = nativeDeckDsp != null ? nativeDeckDsp.getLiveRms() : 0.1f;
                    float bodyBass = nativeDeckDsp != null ? nativeDeckDsp.getBodyBassRms() : 0.08f;
                    float bass = nativeDeckDsp != null ? nativeDeckDsp.getBassRms() : 0.08f;
                    float bodyVocal = nativeDeckDsp != null ? nativeDeckDsp.getBodyVocalRms() : 0.08f;
                    float vocal = nativeDeckDsp != null ? nativeDeckDsp.getVocalMidRms() : 0.08f;

                    if (nextDeckIntroScanning && (remSec <= 8.0 || live < Math.max(0.014f, body * 0.14f))) {
                        abortNextDeckIntroScanOnMainThread();
                    }

                    if (!nextDeckIntroScanning && nextState == Player.STATE_READY && nativeDeckDsp != null && nativeDeckDsp.getProcessedBlocks() >= 16) {
                        boolean vocalSafeNow = (bodyVocal <= 0.02f || vocal < bodyVocal * 0.48f);

                        // 1. Near-silence / whisper fade-out tail (catches slow fades even with activePlan != null)
                        if (remSec <= 18.0 && remSec >= 1.0 && live < Math.max(0.014f, body * 0.14f)) {
                            silenceOutroTicks++;
                        } else {
                            silenceOutroTicks = 0;
                        }

                        // 2. Sustained monotonic fade-out slope (catches 7..15s fade-outs cleanly)
                        if (
                            remSec <= 15.0 &&
                            remSec >= 2.0 &&
                            body > 0.025f &&
                            live < body * 0.42f &&
                            (live <= prevFadeLiveRms * 1.04f || live < body * 0.24f) &&
                            (vocalSafeNow || live < body * 0.26f)
                        ) {
                            fadeOutSlopeTicks++;
                        } else {
                            fadeOutSlopeTicks = 0;
                        }
                        prevFadeLiveRms = live;

                        // 3-5. Normal active-ending triggers strictly inside <=7.0s when no Stage 2 plan is active
                        if (!hasValidPlanForPair) {
                            if (remSec <= 7.0 && remSec >= 2.4 && body > 0.025f && live < body * 0.42f && vocalSafeNow) {
                                quietOutroTicks++;
                            } else {
                                quietOutroTicks = 0;
                            }

                            if (
                                remSec <= 7.0 &&
                                remSec >= 2.6 &&
                                bodyBass > 0.02f &&
                                bass < bodyBass * 0.36f &&
                                vocalSafeNow
                            ) {
                                instrumentalOutroTicks++;
                            } else {
                                instrumentalOutroTicks = 0;
                            }

                            if (remSec <= 6.5 && remSec >= 2.6 && bodyVocal > 0.02f && vocal < bodyVocal * 0.44f) {
                                vocalDipTicks++;
                            } else {
                                vocalDipTicks = 0;
                            }
                        } else {
                            quietOutroTicks = 0;
                            instrumentalOutroTicks = 0;
                            vocalDipTicks = 0;
                        }

                        long maxSafeMs = Math.max(1800L, Math.min(6800L, (long) ((remSec - 0.22) * 1000.0)));
                        long triggerCrossfadeMs = -1L;
                        if (silenceOutroTicks >= 3) {
                            triggerCrossfadeMs = Math.min(4200L, maxSafeMs);
                        } else if (fadeOutSlopeTicks >= 5) {
                            triggerCrossfadeMs = Math.min(5800L, maxSafeMs);
                        } else if (!hasValidPlanForPair && quietOutroTicks >= 4) {
                            triggerCrossfadeMs = Math.min(5800L, maxSafeMs);
                        } else if (!hasValidPlanForPair && instrumentalOutroTicks >= 4) {
                            triggerCrossfadeMs = Math.min(6500L, maxSafeMs);
                        } else if (!hasValidPlanForPair && vocalDipTicks >= 3) {
                            triggerCrossfadeMs = Math.min(5400L, maxSafeMs);
                        } else if (remSec <= 4.3 && remSec >= 1.1) {
                            // Guaranteed zero-skip AutoMix fallback for songs with dense loud/vocal endings
                            triggerCrossfadeMs = Math.max(1800L, Math.min(4200L, maxSafeMs));
                        }

                        if (triggerCrossfadeMs > 0L) {
                            resetOutroCounters();
                            executeReadyNativeCrossfade(
                                triggerCrossfadeMs,
                                currentNativeVolume,
                                nextDeckTitle,
                                nextDeckArtist,
                                nextDeckAlbum,
                                nextDeckCoverUrl,
                                nextDeckDurationSec,
                                nextDeckTrackId,
                                false
                            );
                            return;
                        }
                    } else if (
                        !nextDeckIntroScanning &&
                        nextState == Player.STATE_READY &&
                        remSec <= 4.3 &&
                        remSec >= 1.1
                    ) {
                        // Even if DSP hasn't accumulated 12 blocks (e.g. seeked straight into outro), still mix smoothly
                        long maxSafeMs = Math.max(1800L, Math.min(4200L, (long) ((remSec - 0.22) * 1000.0)));
                        resetOutroCounters();
                        executeReadyNativeCrossfade(
                            maxSafeMs,
                            currentNativeVolume,
                            nextDeckTitle,
                            nextDeckArtist,
                            nextDeckAlbum,
                            nextDeckCoverUrl,
                            nextDeckDurationSec,
                            nextDeckTrackId,
                            false
                        );
                        return;
                    } else if (
                        !nextDeckIntroScanning &&
                        nextState == Player.STATE_BUFFERING &&
                        remSec <= 4.3 &&
                        remSec >= 0.9
                    ) {
                        long waitFadeMs = Math.max(1800L, Math.min(4200L, (long) ((remSec - 0.2) * 1000.0)));
                        startNativeCrossfade(
                            waitFadeMs,
                            currentNativeVolume,
                            nextDeckTitle,
                            nextDeckArtist,
                            nextDeckAlbum,
                            nextDeckCoverUrl,
                            nextDeckDurationSec,
                            nextDeckTrackId
                        );
                    }
                } else {
                    resetOutroCounters();
                }

                mainHandler.postDelayed(this, 250L);
            }
        }
    };

    private final Player.Listener primaryPlayerListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int playbackState) {
            try {
                if (nativePlayer == null || !nativeAudioActive) return;
                long durMs = nativePlayer.getDuration();
                if (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET) {
                    currentDurationSec = durMs / 1000.0;
                }
                long posMs = Math.max(0L, nativePlayer.getCurrentPosition());
                currentPositionSec = posMs / 1000.0;

                if (playbackState == Player.STATE_BUFFERING) {
                    emitNativeState("buffering", null);
                } else if (playbackState == Player.STATE_READY) {
                    updatePlaybackState(nativePlayer.isPlaying(), currentPositionSec, currentDurationSec, currentPlaybackRate);
                    emitNativeState("ready", null);
                } else if (playbackState == Player.STATE_ENDED) {
                    if (isCrossfading) {
                        mainHandler.removeCallbacks(crossfadeTicker);
                        mainHandler.post(crossfadeTicker);
                        return;
                    }
                    if ("one".equals(nativeRepeatMode)) {
                        nativeReplayOnMainThread();
                        return;
                    }
                    if ("all".equals(nativeRepeatMode) && nativeQueue.size() == 1) {
                        nativeReplayOnMainThread();
                        return;
                    }
                    if (
                        nextDeckPlayer != null &&
                        !nextDeckTrackId.isEmpty() &&
                        nextDeckPlayer.getPlaybackState() != Player.STATE_IDLE &&
                        nextDeckPlayer.getPlayerError() == null
                    ) {
                        mainHandler.removeCallbacks(nativeProgressTicker);
                        pendingCrossfade = false;
                        mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
                        executeReadyNativeCrossfade(
                            nativeAutoMixEnabled ? 650L : 120L,
                            currentNativeVolume,
                            nextDeckTitle,
                            nextDeckArtist,
                            nextDeckAlbum,
                            nextDeckCoverUrl,
                            nextDeckDurationSec,
                            nextDeckTrackId,
                            true
                        );
                        return;
                    }
                    int nextIdx = resolveNextQueueIndex(true);
                    if (nextIdx >= 0 && nextIdx < nativeQueue.size()) {
                        NativeQueueEntry nextEntry = nativeQueue.get(nextIdx);
                        if (nextEntry != null && nextEntry.url != null && !nextEntry.url.isEmpty()) {
                            nativeQueueIndex = nextIdx;
                            pendingNextQueueIndex = -1;
                            playNativeQueueEntryOnMainThread(nextEntry);
                            emitNativeState("trackChanged", null);
                            return;
                        }
                    }
                    mainHandler.removeCallbacks(nativeProgressTicker);
                    isPlaying = false;
                    releaseWakeLock();
                    updatePlaybackState(false, currentDurationSec, currentDurationSec, currentPlaybackRate);
                    emitNativeState("ended", null);
                }
            } catch (Throwable ignored) {}
        }

        @Override
        public void onIsPlayingChanged(boolean playing) {
            try {
                if (nativePlayer == null || !nativeAudioActive) return;
                if ((isCrossfading || isSwitchingNativeTrack) && !playing) {
                    return;
                }
                if (!playing && nativePlayer.getPlayWhenReady() && nativePlayer.getPlaybackState() == Player.STATE_BUFFERING) {
                    isPlaying = true;
                    acquireWakeLock();
                    emitNativeState("buffering", null);
                    return;
                }
                isPlaying = playing;
                long posMs = Math.max(0L, nativePlayer.getCurrentPosition());
                currentPositionSec = posMs / 1000.0;
                mainHandler.removeCallbacks(nativeProgressTicker);
                if (playing) {
                    acquireWakeLock();
                    mainHandler.postDelayed(nativeProgressTicker, 250L);
                } else {
                    releaseWakeLock();
                }
                updatePlaybackState(playing, currentPositionSec, currentDurationSec, currentPlaybackRate);
                emitNativeState("state", null);
            } catch (Throwable ignored) {}
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            try {
                if (!nativeAudioActive || isCrossfading) return;
                mainHandler.removeCallbacks(nativeProgressTicker);
                isPlaying = false;
                releaseWakeLock();
                updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                emitNativeState("error", error);
            } catch (Throwable ignored) {}
        }
    };

    private final Runnable pendingCrossfadeWaitTicker = new Runnable() {
        @Override
        public void run() {
            try {
                runPendingCrossfadeWaitInternal();
            } catch (Throwable ignored) {
                pendingCrossfade = false;
            }
        }

        private void runPendingCrossfadeWaitInternal() {
            if (!pendingCrossfade) return;
            if (
                !nativeAudioActive ||
                nativePlayer == null ||
                nextDeckPlayer == null ||
                !pendingCrossfadeTrackId.equals(nextDeckTrackId)
            ) {
                pendingCrossfade = false;
                emitNativeState("crossfadeFailed", null);
                return;
            }
            PlaybackException nextErr = nextDeckPlayer.getPlayerError();
            int nextState = nextDeckPlayer.getPlaybackState();
            if (nextErr != null || nextState == Player.STATE_IDLE) {
                pendingCrossfade = false;
                cancelCrossfadeOnMainThread();
                emitNativeState("crossfadeFailed", nextErr);
                return;
            }
            if (nativePlayer.getPlaybackState() == Player.STATE_ENDED) {
                pendingCrossfade = false;
                executeReadyNativeCrossfade(
                    650L,
                    pendingCrossfadeTargetVolume,
                    pendingCrossfadeTitle,
                    pendingCrossfadeArtist,
                    pendingCrossfadeAlbum,
                    pendingCrossfadeCoverUrl,
                    pendingCrossfadeDurationSec,
                    pendingCrossfadeTrackId,
                    true
                );
                return;
            }
            if (nextState == Player.STATE_READY) {
                pendingCrossfade = false;
                executeReadyNativeCrossfade(
                    pendingCrossfadeMs,
                    pendingCrossfadeTargetVolume,
                    pendingCrossfadeTitle,
                    pendingCrossfadeArtist,
                    pendingCrossfadeAlbum,
                    pendingCrossfadeCoverUrl,
                    pendingCrossfadeDurationSec,
                    pendingCrossfadeTrackId,
                    false
                );
                return;
            }
            mainHandler.postDelayed(this, 32L);
        }
    };

    private final Runnable nativeFadeOutTicker = new Runnable() {
        @Override
        public void run() {
            try {
                if (fadingOutPlayer == null) return;
                int st = fadingOutPlayer.getPlaybackState();
                long elapsedMs = SystemClock.elapsedRealtime() - fadeOutStartMs;
                double p = Math.max(0.0, Math.min(1.0, (double) elapsedMs / Math.max(300L, fadeOutDurationMs)));
                double easedOut = 0.5 - 0.5 * Math.cos(p * Math.PI);
                float outGain = (float) (Math.pow(Math.max(0.0, Math.cos(easedOut * Math.PI * 0.5)), 1.35) * fadeOutInitialVolume);
                try {
                    fadingOutPlayer.setVolume(Math.max(0.0f, outGain));
                } catch (Exception ignored) {}
                if (fadingOutDsp != null) {
                    double outT = Math.max(0.0, Math.min(1.0, (p - 0.18) / 0.72));
                    double outSmooth = outT * outT * (3.0 - 2.0 * outT);
                    fadingOutDsp.setHighPassHz(outT <= 0.0 ? 0.0f : (float) (30.0 + outSmooth * 650.0));
                }

                if (p < 1.0 && st != Player.STATE_ENDED && st != Player.STATE_IDLE) {
                    mainHandler.postDelayed(this, 16L);
                    return;
                }
                stopFadingOutPlayerOnMainThread();
            } catch (Throwable ignored) {
                stopFadingOutPlayerOnMainThread();
            }
        }
    };

    private final Runnable crossfadeTicker = new Runnable() {
        @Override
        public void run() {
            try {
                runCrossfadeTickInternal();
            } catch (Throwable ignored) {
                isCrossfading = false;
            }
        }

        private void runCrossfadeTickInternal() {
            if (!isCrossfading || nativePlayer == null || (!crossfadeFadeInOnly && nextDeckPlayer == null) || !nativeAudioActive) {
                isCrossfading = false;
                return;
            }
            PlaybackException activeErr = nativePlayer.getPlayerError();
            if (activeErr != null || nativePlayer.getPlaybackState() == Player.STATE_IDLE) {
                cancelCrossfadeOnMainThread();
                emitNativeState("crossfadeFailed", activeErr);
                return;
            }
            boolean outgoingEnded = crossfadeFadeInOnly
                || nextDeckPlayer == null
                || nextDeckPlayer.getPlaybackState() == Player.STATE_ENDED
                || nextDeckPlayer.getPlaybackState() == Player.STATE_IDLE;

            if (!crossfadeIncomingReady) {
                int inState = nativePlayer.getPlaybackState();
                if (inState == Player.STATE_READY) {
                    crossfadeIncomingReady = true;
                    crossfadeStartMs = SystemClock.elapsedRealtime();
                } else if (inState == Player.STATE_BUFFERING && !outgoingEnded && nextDeckPlayer != null) {
                    long waitMs = SystemClock.elapsedRealtime() - crossfadeInvokedMs;
                    long outDurMs = nextDeckPlayer.getDuration();
                    long outPosMs = Math.max(0L, nextDeckPlayer.getCurrentPosition());
                    boolean outHasHeadroom = (outDurMs <= 0 || outDurMs == androidx.media3.common.C.TIME_UNSET)
                        || (outDurMs - outPosMs > 1800L);
                    if (waitMs < 3000L && outHasHeadroom) {
                        try {
                            nextDeckPlayer.setVolume(crossfadeTargetVolume);
                            nativePlayer.setVolume(0.0f);
                        } catch (Exception ignored) {}
                        crossfadeStartMs = SystemClock.elapsedRealtime();
                        mainHandler.postDelayed(this, 16L);
                        return;
                    }
                    crossfadeIncomingReady = true;
                    crossfadeStartMs = SystemClock.elapsedRealtime();
                } else {
                    crossfadeIncomingReady = true;
                    crossfadeStartMs = SystemClock.elapsedRealtime();
                }
            }

            long elapsedMs = SystemClock.elapsedRealtime() - crossfadeStartMs;
            double p = Math.max(0.0, Math.min(1.0, (double) elapsedMs / Math.max(500L, crossfadeDurationMs)));

            if (sampleAccurateDspCrossfade && !crossfadeFadeInOnly) {
                // Smooth hardware-synced equal-power S-curve right on ExoPlayer AudioTrack (0ms lag, zero abrupt cutoff)
                double smoothP = p * p * (3.0 - 2.0 * p);
                float outGain = outgoingEnded ? 0.0f : (float) (Math.cos(smoothP * Math.PI * 0.5) * crossfadeTargetVolume);
                float inGain = (float) Math.min(1.0, Math.sin(smoothP * Math.PI * 0.5) * crossfadeTargetVolume * crossfadeGainCompLinear);
                try {
                    if (nextDeckPlayer != null) {
                        nextDeckPlayer.setVolume(Math.max(0.0f, outGain));
                    }
                    nativePlayer.setVolume(Math.max(0.0f, inGain));
                } catch (Exception ignored) {}

                // Gentle, continuous sub-bass handoff without harsh 120ms bass chops
                double outT = Math.max(0.0, Math.min(1.0, (p - 0.25) / 0.63));
                double outSmooth = outT * outT * (3.0 - 2.0 * outT);
                if (nextDeckDsp != null) nextDeckDsp.setHighPassHz(outT <= 0.0 ? 0.0f : (float) (25.0 + outSmooth * 240.0));

                double inT = Math.max(0.0, Math.min(1.0, (p - 0.10) / 0.45));
                double inSmooth = inT * inT * (3.0 - 2.0 * inT);
                if (nativeDeckDsp != null) nativeDeckDsp.setHighPassHz(inT >= 1.0 ? 0.0f : (float) (220.0 * (1.0 - inSmooth)));

                if (crossfadeTempoSync) {
                    double lockEnd = Math.max(0.25, Math.min(0.95, crossfadeTempoLockCompleteProgress));
                    double x = Math.max(0.0, Math.min(1.0, p / lockEnd));
                    double s = x * x * (3.0 - 2.0 * x);
                    float speedA = (float) Math.max(0.92, Math.min(1.08, 1.0 + (crossfadeTargetTempoRatioA - 1.0) * s));
                    float speedB = (float) Math.max(0.92, Math.min(1.08, crossfadeInitialTempoRatioB + (1.0 - crossfadeInitialTempoRatioB) * s));
                    try {
                        nativePlayer.setPlaybackParameters(new PlaybackParameters(speedB, 1.0f));
                        if (!outgoingEnded && nextDeckPlayer != null) {
                            nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(speedA, 1.0f));
                        }
                    } catch (Exception ignored) {}
                }
            } else {
                // Fallback smoothness curve when no Stage 5 sample-accurate DSP plan is active
                double inP = Math.min(1.0, p / 0.82);
                double easedIn = 0.5 - 0.5 * Math.cos(inP * Math.PI);
                float inGain = (float) (Math.sin(easedIn * Math.PI * 0.5) * crossfadeTargetVolume);
                double easedOut = 0.5 - 0.5 * Math.cos(p * Math.PI);
                float outGain = outgoingEnded
                    ? 0.0f
                    : (float) (Math.pow(Math.max(0.0, Math.cos(easedOut * Math.PI * 0.5)), 1.35) * crossfadeTargetVolume);

                if (!crossfadeFadeInOnly) {
                    double outT = Math.max(0.0, Math.min(1.0, (p - 0.18) / 0.72));
                    double outSmooth = outT * outT * (3.0 - 2.0 * outT);
                    float outHpHz = outT <= 0.0 ? 0.0f : (float) (30.0 + outSmooth * 650.0);
                    if (nextDeckDsp != null) nextDeckDsp.setHighPassHz(outHpHz);

                    double inT = Math.max(0.0, Math.min(1.0, (p - 0.28) / 0.34));
                    double inSmooth = inT * inT * (3.0 - 2.0 * inT);
                    float inHpHz = inT >= 1.0 ? 0.0f : (float) (360.0 * (1.0 - inSmooth));
                    if (nativeDeckDsp != null) nativeDeckDsp.setHighPassHz(inHpHz);
                } else if (nativeDeckDsp != null) {
                    nativeDeckDsp.setHighPassHz(0.0f);
                }

                try {
                    if (!crossfadeFadeInOnly && nextDeckPlayer != null) {
                        nextDeckPlayer.setVolume(Math.max(0.0f, outGain));
                    }
                    nativePlayer.setVolume(Math.max(0.0f, inGain));
                } catch (Exception ignored) {}
            }

            if (p < 1.0 && (!outgoingEnded || crossfadeFadeInOnly)) {
                mainHandler.postDelayed(this, 16L);
                return;
            }

            isCrossfading = false;
            crossfadeIncomingReady = false;
            crossfadeFadeInOnly = false;
            sampleAccurateDspCrossfade = false;
            crossfadeTempoSync = false;
            scheduledAutoMixPlan = null;
            if (nativeDeckDsp != null) {
                nativeDeckDsp.stopSampleAccurateAutoMix();
                nativeDeckDsp.setHighPassHz(0.0f);
            }
            if (nextDeckDsp != null) {
                nextDeckDsp.stopSampleAccurateAutoMix();
                nextDeckDsp.setHighPassHz(0.0f);
            }
            try {
                nativePlayer.setVolume(crossfadeTargetVolume);
                nativePlayer.setPlaybackParameters(new PlaybackParameters((float) (currentPlaybackRate > 0 ? currentPlaybackRate : 1.0), 1.0f));
            } catch (Exception ignored) {}
            if (nextDeckPlayer != null) {
                try {
                    nextDeckPlayer.setPlayWhenReady(false);
                    nextDeckPlayer.pause();
                    nextDeckPlayer.stop();
                    nextDeckPlayer.clearMediaItems();
                } catch (Exception ignored) {}
                try {
                    nextDeckPlayer.setAudioAttributes(buildMediaAudioAttributes(), false);
                } catch (Exception ignored) {}
            }
            try {
                nativePlayer.setAudioAttributes(buildMediaAudioAttributes(), true);
            } catch (Exception ignored) {}
            emitNativeState("crossfadeComplete", null);
        }
    };

    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends Binder {
        public SoundifyMediaService getService() {
            return SoundifyMediaService.this;
        }
    }

    public static SoundifyMediaService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        createNotificationChannel();
        initMediaSession();
        initAudioManager();
        initWakeLock();
        registerBecomingNoisyReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForegroundNotification();
        if (intent != null && intent.getAction() != null) {
            handleAction(intent);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        instance = null;
        mainHandler.removeCallbacks(nativeProgressTicker);
        mainHandler.removeCallbacks(crossfadeTicker);
        mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
        mainHandler.removeCallbacks(nativeFadeOutTicker);
        mainHandler.removeCallbacks(nextDeckIntroScanTicker);
        nextDeckIntroScanning = false;
        pendingCrossfade = false;
        isCrossfading = false;
        nativeAudioActive = false;
        stopFadingOutPlayerOnMainThread();
        if (nativePlayer != null) {
            try {
                nativePlayer.release();
            } catch (Exception ignored) {}
            nativePlayer = null;
        }
        if (nextDeckPlayer != null) {
            try {
                nextDeckPlayer.release();
            } catch (Exception ignored) {}
            nextDeckPlayer = null;
        }
        unregisterBecomingNoisyReceiver();
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) {}
            mediaSession = null;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        isForeground = false;
        try {
            executorService.shutdownNow();
        } catch (Exception ignored) {}
        try {
            autoMixAnalyzerExecutor.shutdownNow();
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void handleAction(Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        switch (action) {
            case ACTION_START_SERVICE:
                String startTitle = intent.getStringExtra("title");
                if (startTitle != null && !startTitle.isEmpty()) {
                    updateMetadata(
                        startTitle,
                        intent.getStringExtra("artist"),
                        intent.getStringExtra("album"),
                        intent.getStringExtra("coverUrl"),
                        intent.getDoubleExtra("duration", 0.0),
                        intent.getStringExtra("trackId")
                    );
                }
                ensureForegroundNotification();
                break;

            case ACTION_SYNC_STATE:
                String syncTitle = intent.getStringExtra("title");
                if (syncTitle != null && !syncTitle.isEmpty()) {
                    updateMetadata(
                        syncTitle,
                        intent.getStringExtra("artist"),
                        intent.getStringExtra("album"),
                        intent.getStringExtra("coverUrl"),
                        intent.getDoubleExtra("duration", currentDurationSec),
                        intent.getStringExtra("trackId")
                    );
                }
                boolean syncPlaying = intent.getBooleanExtra("isPlaying", true);
                double syncPos = intent.getDoubleExtra("position", currentPositionSec);
                double syncDuration = intent.getDoubleExtra("duration", currentDurationSec);
                double syncRate = intent.getDoubleExtra("playbackRate", currentPlaybackRate);
                if (nativeAudioActive && nativePlayer != null) {
                    // Authoritative position lives in ExoPlayer; never let hidden <audio> position overwrite it.
                    mainHandler.post(() -> {
                        if (nativePlayer != null && nativeAudioActive) {
                            long posMs = Math.max(0L, nativePlayer.getCurrentPosition());
                            long durMs = nativePlayer.getDuration();
                            currentPositionSec = posMs / 1000.0;
                            if (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET) {
                                currentDurationSec = durMs / 1000.0;
                            }
                            updatePlaybackState(nativePlayer.isPlaying(), currentPositionSec, currentDurationSec, currentPlaybackRate);
                        }
                    });
                } else {
                    // Sync service/notification state from JS without echoing mediaAction back to JS
                    // and without stealing AudioFocus from Chromium WebView's <audio> element.
                    updatePlaybackState(syncPlaying, syncPos, syncDuration, syncRate);
                }
                break;

            case ACTION_PLAY:
                String playTitle = intent.getStringExtra("title");
                if (playTitle != null && !playTitle.isEmpty()) {
                    updateMetadata(
                        playTitle,
                        intent.getStringExtra("artist"),
                        intent.getStringExtra("album"),
                        intent.getStringExtra("coverUrl"),
                        intent.getDoubleExtra("duration", currentDurationSec),
                        intent.getStringExtra("trackId")
                    );
                }
                boolean hasExplicitPlayPos = intent.hasExtra("position");
                double explicitPlayPos = hasExplicitPlayPos
                    ? Math.max(0.0, intent.getDoubleExtra("position", 0.0))
                    : currentPositionSec;
                double playRate = intent.getDoubleExtra("playbackRate", currentPlaybackRate);
                currentPlaybackRate = playRate > 0 ? playRate : 1.0;
                if (nativeAudioActive && nativePlayer != null) {
                    mainHandler.post(() -> {
                        if (nativePlayer != null) {
                            acquireWakeLock();
                            if (hasExplicitPlayPos) {
                                nativePlayer.seekTo((long) (explicitPlayPos * 1000.0));
                            }
                            if (nativePlayer.getPlaybackState() == Player.STATE_ENDED) {
                                nativeReplayOnMainThread();
                            } else {
                                nativePlayer.play();
                            }
                        }
                    });
                } else {
                    currentPositionSec = explicitPlayPos;
                    acquireWakeLock();
                    isPlaying = true;
                    updatePlaybackState(true, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    MediaSessionPlugin.sendMediaAction("play", null);
                }
                break;

            case ACTION_PAUSE:
                isPlaying = false;
                releaseWakeLock();
                if (nativeAudioActive && nativePlayer != null) {
                    mainHandler.post(() -> {
                        cancelCrossfadeOnMainThread();
                        if (nativePlayer != null) nativePlayer.pause();
                    });
                } else {
                    updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    MediaSessionPlugin.sendMediaAction("pause", null);
                }
                break;

            case ACTION_PLAY_PAUSE:
                if (nativeAudioActive && nativePlayer != null) {
                    mainHandler.post(() -> {
                        if (nativePlayer != null) {
                            if (nativePlayer.isPlaying()) {
                                cancelCrossfadeOnMainThread();
                                nativePlayer.pause();
                            } else if (nativePlayer.getPlaybackState() == Player.STATE_ENDED) {
                                nativeReplayOnMainThread();
                            } else {
                                acquireWakeLock();
                                nativePlayer.play();
                            }
                        }
                    });
                } else {
                    isPlaying = !isPlaying;
                    if (isPlaying) {
                        acquireWakeLock();
                    } else {
                        releaseWakeLock();
                    }
                    updatePlaybackState(isPlaying, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    MediaSessionPlugin.sendMediaAction("togglePlay", null);
                }
                break;

            case ACTION_NEXT:
                MediaSessionPlugin.sendMediaAction("next", null);
                break;

            case ACTION_PREV:
                MediaSessionPlugin.sendMediaAction("prev", null);
                break;

            case ACTION_STOP:
                nativeStop();
                stopForegroundService();
                MediaSessionPlugin.sendMediaAction("stop", null);
                break;

            case ACTION_SEEK:
                double seekPos = intent.getDoubleExtra("position", currentPositionSec);
                currentPositionSec = seekPos;
                if (nativeAudioActive && nativePlayer != null) {
                    nativeSeek(seekPos);
                }
                JSObject seekData = new JSObject();
                seekData.put("position", seekPos);
                MediaSessionPlugin.sendMediaAction("seek", seekData);
                updatePlaybackState(isPlaying, seekPos, currentDurationSec, currentPlaybackRate);
                break;

            case ACTION_PLAY_NATIVE_STREAM:
                String streamUrl = intent.getStringExtra("url");
                if (streamUrl != null && !streamUrl.isEmpty()) {
                    playNativeStream(
                        streamUrl,
                        intent.getStringExtra("authToken"),
                        intent.getDoubleExtra("startSec", 0.0),
                        (float) intent.getDoubleExtra("playbackRate", 1.0),
                        (float) intent.getDoubleExtra("volume", 1.0),
                        intent.getStringExtra("title"),
                        intent.getStringExtra("artist"),
                        intent.getStringExtra("album"),
                        intent.getStringExtra("coverUrl"),
                        intent.getDoubleExtra("duration", 0.0),
                        intent.getStringExtra("trackId")
                    );
                }
                break;

            case ACTION_UPDATE_METADATA:
                String title = intent.getStringExtra("title");
                String artist = intent.getStringExtra("artist");
                String album = intent.getStringExtra("album");
                String coverUrl = intent.getStringExtra("coverUrl");
                double duration = intent.getDoubleExtra("duration", 0.0);
                String trackId = intent.getStringExtra("trackId");
                updateMetadata(title, artist, album, coverUrl, duration, trackId);
                break;

            case ACTION_MEDIA_BUTTON:
                KeyEvent keyEvent = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (keyEvent != null && keyEvent.getAction() == KeyEvent.ACTION_DOWN) {
                    handleMediaKeyEvent(keyEvent);
                }
                break;

            default:
                break;
        }
    }

    private void handleMediaKeyEvent(KeyEvent event) {
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                handleAction(new Intent(ACTION_PLAY));
                break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                handleAction(new Intent(ACTION_PAUSE));
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                handleAction(new Intent(ACTION_PLAY_PAUSE));
                break;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                handleAction(new Intent(ACTION_NEXT));
                break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                handleAction(new Intent(ACTION_PREV));
                break;
            case KeyEvent.KEYCODE_MEDIA_STOP:
                handleAction(new Intent(ACTION_STOP));
                break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                Intent ff = new Intent(ACTION_SEEK);
                ff.putExtra("position", currentPositionSec + 10.0);
                handleAction(ff);
                break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                Intent rw = new Intent(ACTION_SEEK);
                rw.putExtra("position", Math.max(0.0, currentPositionSec - 10.0));
                handleAction(rw);
                break;
            default:
                break;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Soundify Audio Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Background audio controls and media notification");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSession(this, "SoundifyMediaSession");
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                handleAction(new Intent(ACTION_PLAY));
            }

            @Override
            public void onPause() {
                handleAction(new Intent(ACTION_PAUSE));
            }

            @Override
            public void onSkipToNext() {
                handleAction(new Intent(ACTION_NEXT));
            }

            @Override
            public void onSkipToPrevious() {
                handleAction(new Intent(ACTION_PREV));
            }

            @Override
            public void onSeekTo(long pos) {
                Intent seekIntent = new Intent(ACTION_SEEK);
                seekIntent.putExtra("position", pos / 1000.0);
                handleAction(seekIntent);
            }

            @Override
            public void onStop() {
                handleAction(new Intent(ACTION_STOP));
            }

            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonIntent) {
                if (mediaButtonIntent != null && ACTION_MEDIA_BUTTON.equals(mediaButtonIntent.getAction())) {
                    KeyEvent event = mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    if (event != null && event.getAction() == KeyEvent.ACTION_DOWN) {
                        handleMediaKeyEvent(event);
                        return true;
                    }
                }
                return super.onMediaButtonEvent(mediaButtonIntent);
            }
        });

        // Setup PendingIntent for media buttons
        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setClass(this, MediaButtonReceiver.class);
        PendingIntent mbrPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            mediaButtonIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        mediaSession.setMediaButtonReceiver(mbrPendingIntent);
        mediaSession.setActive(true);
    }

    private void initAudioManager() {
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    private void initWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, WIFI_LOCK_TAG);
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}
    }

    public synchronized void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                // Safety acquire for 60 minutes of continuous background screen-off playback
                wakeLock.acquire(60 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
        try {
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    public synchronized void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    public boolean requestAudioFocus() {
        if (audioManager == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();

                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .build();
            }
            int res = audioManager.requestAudioFocus(audioFocusRequest);
            return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            int res = audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    public void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(audioFocusRequest);
                }
            } else {
                audioManager.abandonAudioFocus(audioFocusChangeListener);
            }
        } catch (Exception ignored) {}
    }

    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(int focusChange) {
            JSObject data = new JSObject();
            switch (focusChange) {
                case AudioManager.AUDIOFOCUS_GAIN:
                    data.put("state", "gain");
                    data.put("shouldResume", wasPlayingBeforeTransientLoss);
                    if (wasPlayingBeforeTransientLoss) {
                        acquireWakeLock();
                        isPlaying = true;
                        updatePlaybackState(true, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    }
                    wasPlayingBeforeTransientLoss = false;
                    MediaSessionPlugin.sendMediaAction("audioFocusChange", data);
                    break;

                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                    wasPlayingBeforeTransientLoss = isPlaying;
                    isPlaying = false;
                    releaseWakeLock();
                    updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    data.put("state", "transientLoss");
                    MediaSessionPlugin.sendMediaAction("audioFocusChange", data);
                    break;

                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                    data.put("state", "duck");
                    MediaSessionPlugin.sendMediaAction("audioFocusChange", data);
                    break;

                case AudioManager.AUDIOFOCUS_LOSS:
                    wasPlayingBeforeTransientLoss = false;
                    isPlaying = false;
                    releaseWakeLock();
                    updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                    data.put("state", "loss");
                    MediaSessionPlugin.sendMediaAction("audioFocusChange", data);
                    break;

                default:
                    break;
            }
        }
    };

    private final BroadcastReceiver becomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                isPlaying = false;
                releaseWakeLock();
                updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                MediaSessionPlugin.sendMediaAction("becomingNoisy", null);
            }
        }
    };

    private void registerBecomingNoisyReceiver() {
        if (!isBecomingNoisyRegistered) {
            try {
                IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(becomingNoisyReceiver, filter, Context.RECEIVER_EXPORTED);
                } else {
                    registerReceiver(becomingNoisyReceiver, filter);
                }
                isBecomingNoisyRegistered = true;
            } catch (Exception ignored) {}
        }
    }

    private void unregisterBecomingNoisyReceiver() {
        if (isBecomingNoisyRegistered) {
            try {
                unregisterReceiver(becomingNoisyReceiver);
                isBecomingNoisyRegistered = false;
            } catch (Exception ignored) {}
        }
    }

    public void updateMetadata(
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec,
        final String trackId
    ) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> updateMetadata(title, artist, album, coverUrl, durationSec, trackId));
            return;
        }
        this.currentTitle = (title != null && !title.isEmpty()) ? title : "Soundify";
        this.currentArtist = (artist != null) ? artist : "";
        this.currentAlbum = (album != null) ? album : "";
        this.currentDurationSec = durationSec;

        String safeCoverUrl = (coverUrl != null) ? coverUrl : "";
        String safeTrackId = (trackId != null) ? trackId : "";
        boolean trackChanged = !safeTrackId.equals(this.currentTrackId);
        boolean coverChanged = !safeCoverUrl.equals(this.currentCoverUrl);
        this.currentTrackId = safeTrackId;
        this.currentCoverUrl = safeCoverUrl;

        if (trackChanged || coverChanged) {
            this.cachedArtworkBitmap = null;
            artworkRequestSeq.incrementAndGet();
            applyMediaMetadata();
            updateNotification();
            loadArtworkAsync(this.currentCoverUrl);
        } else {
            applyMediaMetadata();
            updateNotification();
        }
    }

    private Notification buildMinimalFallbackNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(currentTitle != null && !currentTitle.isEmpty() ? currentTitle : "Soundify")
            .setContentText(currentArtist != null ? currentArtist : "")
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .build();
    }

    private boolean startForegroundSafely(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isForeground = true;
            return true;
        } catch (Throwable primaryErr) {
            try {
                Notification fallback = buildMinimalFallbackNotification();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, fallback, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, fallback);
                }
                isForeground = true;
                return true;
            } catch (Throwable fallbackErr) {
                try {
                    startForeground(NOTIFICATION_ID, buildMinimalFallbackNotification());
                    isForeground = true;
                    return true;
                } catch (Throwable ignored) {
                    return false;
                }
            }
        }
    }

    public void ensureForegroundNotification() {
        Notification notification;
        try {
            notification = buildNotification();
        } catch (Throwable t) {
            notification = buildMinimalFallbackNotification();
        }
        startForegroundSafely(notification);
    }

    public void updatePlaybackState(
        final boolean playing,
        final double positionSec,
        final double durationSec,
        final double playbackRate
    ) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> updatePlaybackState(playing, positionSec, durationSec, playbackRate));
            return;
        }
        this.isPlaying = playing;
        this.currentPositionSec = Math.max(0.0, positionSec);
        if (durationSec > 0) {
            this.currentDurationSec = durationSec;
        }
        this.currentPlaybackRate = playbackRate > 0 ? playbackRate : 1.0;

        this.nativeSnapshotPlaying = playing;
        this.nativeSnapshotPosSec = this.currentPositionSec;
        this.nativeSnapshotDurSec = this.currentDurationSec;
        this.nativeSnapshotSpeed = (float) this.currentPlaybackRate;

        // Note: Do NOT call requestAudioFocus() here. Audio decoding runs inside Chromium WebView's
        // <audio> element, which already acquires and manages Android Audio Focus natively.
        // Requesting a second competing AudioFocusRequest here causes Android (especially MIUI/HyperOS)
        // to immediately dispatch AUDIOFOCUS_LOSS to either this service or WebView, auto-pausing playback.
        if (playing) {
            acquireWakeLock();
        } else {
            releaseWakeLock();
        }

        applyPlaybackState();
        updateNotification();
    }

    private void applyMediaMetadata() {
        if (mediaSession == null) return;
        try {
            MediaMetadata.Builder builder = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (currentDurationSec * 1000));

            if (cachedArtworkBitmap != null && !cachedArtworkBitmap.isRecycled()) {
                builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cachedArtworkBitmap);
                builder.putBitmap(MediaMetadata.METADATA_KEY_ART, cachedArtworkBitmap);
            }

            mediaSession.setMetadata(builder.build());
        } catch (Throwable ignored) {}
    }

    private void applyPlaybackState() {
        if (mediaSession == null) return;
        try {
            long actions = PlaybackState.ACTION_PLAY |
                PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE |
                PlaybackState.ACTION_SKIP_TO_NEXT |
                PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                PlaybackState.ACTION_SEEK_TO |
                PlaybackState.ACTION_STOP;

            int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
            long positionMs = (long) (currentPositionSec * 1000);

            PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(actions)
                .setState(state, positionMs, (float) currentPlaybackRate);

            mediaSession.setPlaybackState(stateBuilder.build());
        } catch (Throwable ignored) {}
    }

    private static Bitmap decodeSampledBitmap(byte[] bytes, int maxDim) {
        if (bytes == null || bytes.length == 0) return null;
        BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
        boundsOpts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, boundsOpts);
        int rawW = boundsOpts.outWidth;
        int rawH = boundsOpts.outHeight;
        if (rawW <= 0 || rawH <= 0) return null;

        int inSampleSize = 1;
        while ((rawW / inSampleSize) > maxDim * 2 || (rawH / inSampleSize) > maxDim * 2) {
            inSampleSize *= 2;
        }
        BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
        decodeOpts.inSampleSize = Math.max(1, inSampleSize);
        decodeOpts.inPreferredConfig = Bitmap.Config.RGB_565;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, decodeOpts);
    }

    private static byte[] readArtworkBytesCapped(InputStream is, int maxBytes) throws java.io.IOException {
        if (is == null) return null;
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = is.read(buf)) > 0) {
            total += n;
            if (total > maxBytes) {
                return null;
            }
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private void loadArtworkAsync(final String rawCoverUrl) {
        final int reqSeq = artworkRequestSeq.incrementAndGet();
        if (rawCoverUrl == null || rawCoverUrl.isEmpty() || rawCoverUrl.startsWith("blob:")) {
            mainHandler.post(() -> {
                if (reqSeq == artworkRequestSeq.get()) {
                    cachedArtworkBitmap = null;
                    applyMediaMetadata();
                    updateNotification();
                }
            });
            return;
        }

        final String coverUrl;
        if (rawCoverUrl.startsWith("http://localhost") || rawCoverUrl.startsWith("https://localhost")) {
            coverUrl = rawCoverUrl.replaceFirst("^https?://localhost(:[0-9]+)?", DEFAULT_BASE_URL);
        } else if (rawCoverUrl.startsWith("/")) {
            coverUrl = DEFAULT_BASE_URL + rawCoverUrl;
        } else if (!rawCoverUrl.startsWith("http://") && !rawCoverUrl.startsWith("https://") && !rawCoverUrl.startsWith("data:")) {
            coverUrl = DEFAULT_BASE_URL + "/" + rawCoverUrl;
        } else {
            coverUrl = rawCoverUrl;
        }

        try {
            executorService.execute(() -> {
                if (reqSeq != artworkRequestSeq.get()) {
                    return;
                }
                try {
                    Bitmap bitmap = null;
                    if (coverUrl.startsWith("data:image/")) {
                        int commaIndex = coverUrl.indexOf(',');
                        if (commaIndex != -1) {
                            byte[] decoded = Base64.decode(coverUrl.substring(commaIndex + 1), Base64.DEFAULT);
                            bitmap = decodeSampledBitmap(decoded, 512);
                        }
                    } else if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
                        URL url = new URL(coverUrl);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setConnectTimeout(5000);
                        conn.setReadTimeout(5000);
                        conn.setRequestProperty("User-Agent", APP_USER_AGENT);
                        conn.setRequestProperty("X-App-Version", APP_VERSION_HEADER);
                        conn.setInstanceFollowRedirects(true);
                        try {
                            conn.connect();
                            if (conn.getResponseCode() == 200) {
                                try (InputStream is = conn.getInputStream()) {
                                    byte[] imgBytes = readArtworkBytesCapped(is, 4 * 1024 * 1024);
                                    if (imgBytes != null) {
                                        bitmap = decodeSampledBitmap(imgBytes, 512);
                                    }
                                }
                            }
                        } finally {
                            conn.disconnect();
                        }
                    }

                    if (reqSeq != artworkRequestSeq.get()) {
                        return;
                    }

                    if (bitmap == null) {
                        try {
                            bitmap = BitmapFactory.decodeResource(getResources(), com.soundify.app.R.mipmap.ic_launcher);
                        } catch (Throwable ignored) {}
                    }

                    if (bitmap != null && reqSeq == artworkRequestSeq.get() && rawCoverUrl.equals(currentCoverUrl)) {
                        int maxDim = 512;
                        int width = bitmap.getWidth();
                        int height = bitmap.getHeight();
                        if (width > maxDim || height > maxDim) {
                            float ratio = Math.min((float) maxDim / width, (float) maxDim / height);
                            int targetW = Math.max(1, Math.round(ratio * width));
                            int targetH = Math.max(1, Math.round(ratio * height));
                            bitmap = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true);
                        }
                        final Bitmap finalBitmap = bitmap;
                        mainHandler.post(() -> {
                            if (reqSeq == artworkRequestSeq.get() && rawCoverUrl.equals(currentCoverUrl)) {
                                cachedArtworkBitmap = finalBitmap;
                                applyMediaMetadata();
                                updateNotification();
                            }
                        });
                    } else if (reqSeq == artworkRequestSeq.get()) {
                        mainHandler.post(() -> {
                            if (reqSeq == artworkRequestSeq.get()) {
                                cachedArtworkBitmap = null;
                                applyMediaMetadata();
                                updateNotification();
                            }
                        });
                    }
                } catch (Throwable ignored) {
                    if (reqSeq == artworkRequestSeq.get()) {
                        mainHandler.post(() -> {
                            if (reqSeq == artworkRequestSeq.get()) {
                                cachedArtworkBitmap = null;
                                applyMediaMetadata();
                                updateNotification();
                            }
                        });
                    }
                }
            });
        } catch (Throwable ignored) {}
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Notification.MediaStyle mediaStyle = new Notification.MediaStyle();
        if (mediaSession != null) {
            mediaStyle.setMediaSession(mediaSession.getSessionToken());
        }
        mediaStyle.setShowActionsInCompactView(0, 1, 2);

        Intent deleteIntent = new Intent(this, SoundifyMediaService.class);
        deleteIntent.setAction(ACTION_STOP);
        int deleteFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent deletePendingIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            deletePendingIntent = PendingIntent.getForegroundService(this, 1099, deleteIntent, deleteFlags);
        } else {
            deletePendingIntent = PendingIntent.getService(this, 1099, deleteIntent, deleteFlags);
        }

        builder.setStyle(mediaStyle)
            .setSmallIcon(com.soundify.app.R.mipmap.ic_launcher)
            .setColor(0xFF6366F1)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(!currentAlbum.isEmpty() ? currentAlbum : null)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setDeleteIntent(deletePendingIntent)
            .setContentIntent(createContentIntent());

        if (cachedArtworkBitmap != null && !cachedArtworkBitmap.isRecycled()) {
            builder.setLargeIcon(cachedArtworkBitmap);
        }

        builder.addAction(createAction(android.R.drawable.ic_media_previous, "Previous", ACTION_PREV, 101));
        if (isPlaying) {
            builder.addAction(createAction(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE, 102));
        } else {
            builder.addAction(createAction(android.R.drawable.ic_media_play, "Play", ACTION_PLAY, 102));
        }
        builder.addAction(createAction(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 103));

        return builder.build();
    }

    private PendingIntent createContentIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
    }

    private Notification.Action createAction(int icon, String title, String action, int requestCode) {
        Intent intent = new Intent(this, SoundifyMediaService.class);
        intent.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pendingIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            pendingIntent = PendingIntent.getForegroundService(this, requestCode, intent, flags);
        } else {
            pendingIntent = PendingIntent.getService(this, requestCode, intent, flags);
        }
        return new Notification.Action.Builder(icon, title, pendingIntent).build();
    }

    private synchronized void updateNotification() {
        try {
            Notification notification = buildNotification();
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (isPlaying || isForeground) {
                startForegroundSafely(notification);
            } else {
                nm.notify(NOTIFICATION_ID, notification);
            }
        } catch (Throwable ignored) {}
    }

    private androidx.media3.common.AudioAttributes buildMediaAudioAttributes() {
        return new androidx.media3.common.AudioAttributes.Builder()
            .setUsage(androidx.media3.common.C.USAGE_MEDIA)
            .setContentType(androidx.media3.common.C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
    }

    private void stopFadingOutPlayerOnMainThread() {
        mainHandler.removeCallbacks(nativeFadeOutTicker);
        if (fadingOutDsp != null) {
            fadingOutDsp.stopSampleAccurateAutoMix();
            fadingOutDsp.setHighPassHz(0.0f);
            fadingOutDsp = null;
        }
        if (fadingOutPlayer != null) {
            try {
                fadingOutPlayer.setPlayWhenReady(false);
                fadingOutPlayer.pause();
                fadingOutPlayer.stop();
                fadingOutPlayer.clearMediaItems();
                fadingOutPlayer.release();
            } catch (Exception ignored) {}
            fadingOutPlayer = null;
        }
    }

    public void fadeOutAndStopNative(final long fadeMs) {
        mainHandler.post(() -> {
            mainHandler.removeCallbacks(nativeProgressTicker);
            mainHandler.removeCallbacks(crossfadeTicker);
            mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
            abortNextDeckIntroScanOnMainThread();
            pendingCrossfade = false;
            isCrossfading = false;
            crossfadeIncomingReady = false;
            crossfadeFadeInOnly = false;
            resetOutroCounters();
            nextDeckTrackId = "";
            if (nextDeckDsp != null) {
                nextDeckDsp.setHighPassHz(0.0f);
            }
            if (nextDeckPlayer != null) {
                try {
                    nextDeckPlayer.setPlayWhenReady(false);
                    nextDeckPlayer.pause();
                    nextDeckPlayer.stop();
                    nextDeckPlayer.clearMediaItems();
                } catch (Exception ignored) {}
            }
            stopFadingOutPlayerOnMainThread();
            if (nativePlayer != null && nativeAudioActive) {
                ExoPlayer outgoing = nativePlayer;
                AutoMixDspProcessor outgoingDsp = nativeDeckDsp;
                nativePlayer = null;
                nativeDeckDsp = null;
                nativeAudioActive = false;
                try {
                    outgoing.removeListener(primaryPlayerListener);
                    outgoing.setAudioAttributes(buildMediaAudioAttributes(), false);
                } catch (Exception ignored) {}
                fadingOutPlayer = outgoing;
                fadingOutDsp = outgoingDsp;
                fadeOutInitialVolume = currentNativeVolume;
                fadeOutDurationMs = Math.max(400L, fadeMs);
                fadeOutStartMs = SystemClock.elapsedRealtime();
                mainHandler.post(nativeFadeOutTicker);
            } else {
                nativeAudioActive = false;
            }
        });
    }

    private void cancelCrossfadeOnMainThread() {
        mainHandler.removeCallbacks(crossfadeTicker);
        mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
        abortNextDeckIntroScanOnMainThread();
        autoMixPlanSeq.incrementAndGet();
        scheduledAutoMixPlan = null;
        pendingCrossfade = false;
        isCrossfading = false;
        crossfadeIncomingReady = false;
        crossfadeFadeInOnly = false;
        sampleAccurateDspCrossfade = false;
        crossfadeTempoSync = false;
        resetOutroCounters();
        nextDeckTrackId = "";
        if (nativeDeckDsp != null) {
            nativeDeckDsp.stopSampleAccurateAutoMix();
            nativeDeckDsp.setHighPassHz(0.0f);
        }
        if (nextDeckDsp != null) {
            nextDeckDsp.stopSampleAccurateAutoMix();
            nextDeckDsp.setHighPassHz(0.0f);
        }
        stopFadingOutPlayerOnMainThread();
        if (nextDeckPlayer != null) {
            try {
                nextDeckPlayer.setPlayWhenReady(false);
                nextDeckPlayer.pause();
                nextDeckPlayer.stop();
                nextDeckPlayer.clearMediaItems();
            } catch (Exception ignored) {}
            try {
                nextDeckPlayer.setAudioAttributes(buildMediaAudioAttributes(), false);
            } catch (Exception ignored) {}
        }
        if (nativePlayer != null && nativeAudioActive) {
            try {
                nativePlayer.setAudioAttributes(buildMediaAudioAttributes(), true);
                nativePlayer.setVolume(currentNativeVolume);
            } catch (Exception ignored) {}
        }
    }

    private DefaultExtractorsFactory buildExtractorsFactory() {
        return new DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)
            .setConstantBitrateSeekingAlwaysEnabled(true)
            .setMp3ExtractorFlags(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING);
    }

    private DefaultLoadControl buildLoadControl() {
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMs(20_000, 180_000, 500, 1_200)
            .setBackBuffer(180_000, true)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
    }

    private ExoPlayer buildDspExoPlayer(final AutoMixDspProcessor dspProcessor) {
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
            @Override
            protected AudioSink buildAudioSink(
                Context context,
                boolean enableFloatOutput,
                boolean enableAudioTrackPlaybackParams
            ) {
                return new DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(false)
                    .setEnableAudioTrackPlaybackParams(false)
                    .setAudioProcessors(new AudioProcessor[] { dspProcessor })
                    .build();
            }
        };
        return new ExoPlayer.Builder(this, renderersFactory)
            .setLoadControl(buildLoadControl())
            .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, nativeHttpFactory), buildExtractorsFactory()))
            .build();
    }

    private void ensureNativePlayerOnMainThread(String authToken) {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-App-Version", APP_VERSION_HEADER);
        if (authToken != null && !authToken.trim().isEmpty()) {
            headers.put("Authorization", "Bearer " + authToken.trim());
        }

        if (nativeHttpFactory == null) {
            nativeHttpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(APP_USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(20_000)
                .setReadTimeoutMs(60_000);
        }
        nativeHttpFactory.setDefaultRequestProperties(headers);

        if (nativePlayer == null) {
            nativeDeckDsp = new AutoMixDspProcessor();
            nativePlayer = buildDspExoPlayer(nativeDeckDsp);

            nativePlayer.setAudioAttributes(buildMediaAudioAttributes(), true);
            nativePlayer.setHandleAudioBecomingNoisy(true);
            nativePlayer.setWakeMode(androidx.media3.common.C.WAKE_MODE_NETWORK);
            nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            nativePlayer.addListener(primaryPlayerListener);
        }
    }

    private void emitNativeState(String eventType, PlaybackException error) {
        JSObject payload = getNativeStateSnapshot();
        payload.put("event", eventType);
        if (error != null) {
            payload.put("errorCode", error.errorCode);
            payload.put("errorMessage", error.getMessage() != null ? error.getMessage() : "ExoPlayer error");
        }
        NativeAudioPlugin.emitState(payload);
    }

    private volatile boolean nativeSnapshotPlaying = false;
    private volatile boolean nativeSnapshotBuffering = false;
    private volatile double nativeSnapshotPosSec = 0.0;
    private volatile double nativeSnapshotDurSec = 0.0;
    private volatile float nativeSnapshotSpeed = 1.0f;

    public JSObject getNativeStateSnapshot() {
        JSObject obj = new JSObject();
        obj.put("active", nativeAudioActive);
        obj.put("trackId", currentTrackId != null ? currentTrackId : "");
        obj.put("title", currentTitle != null ? currentTitle : "Soundify");
        obj.put("artist", currentArtist != null ? currentArtist : "");
        obj.put("coverUrl", currentCoverUrl != null ? currentCoverUrl : "");
        obj.put("queueIndex", nativeQueueIndex);
        obj.put("repeatMode", nativeRepeatMode);
        obj.put("shuffle", nativeShuffle);
        if (nativePlayer != null && nativeAudioActive && Looper.myLooper() == Looper.getMainLooper()) {
            try {
                int state = nativePlayer.getPlaybackState();
                long posMs = Math.max(0L, nativePlayer.getCurrentPosition());
                long nowMs = SystemClock.elapsedRealtime();
                if (nowMs < crossfadePositionGuardUntilMs && Math.abs(posMs - crossfadePositionFloorMs) > 2500L) {
                    posMs = crossfadePositionFloorMs;
                }
                long durMs = nativePlayer.getDuration();
                double durSec = (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET)
                    ? durMs / 1000.0
                    : currentDurationSec;
                boolean effectivePlaying = nativePlayer.getPlayWhenReady()
                    && state != Player.STATE_IDLE
                    && state != Player.STATE_ENDED;
                double posSec = posMs / 1000.0;
                float spd = nativePlayer.getPlaybackParameters().speed;

                nativeSnapshotPlaying = effectivePlaying;
                nativeSnapshotBuffering = state == Player.STATE_BUFFERING;
                nativeSnapshotPosSec = posSec;
                nativeSnapshotDurSec = durSec;
                nativeSnapshotSpeed = spd;

                obj.put("isPlaying", effectivePlaying);
                obj.put("isBuffering", state == Player.STATE_BUFFERING);
                obj.put("position", posSec);
                obj.put("duration", durSec);
                obj.put("playbackRate", spd);
                return obj;
            } catch (Throwable ignored) {}
        }
        if (nativeAudioActive) {
            obj.put("isPlaying", nativeSnapshotPlaying);
            obj.put("isBuffering", nativeSnapshotBuffering);
            obj.put("position", nativeSnapshotPosSec);
            obj.put("duration", nativeSnapshotDurSec > 0 ? nativeSnapshotDurSec : currentDurationSec);
            obj.put("playbackRate", nativeSnapshotSpeed > 0 ? nativeSnapshotSpeed : (float) currentPlaybackRate);
        } else {
            obj.put("isPlaying", isPlaying);
            obj.put("isBuffering", false);
            obj.put("position", currentPositionSec);
            obj.put("duration", currentDurationSec);
            obj.put("playbackRate", currentPlaybackRate);
        }
        return obj;
    }

    public void playNativeStream(
        final String url,
        final String authToken,
        final double startSec,
        final float playbackRate,
        final float volume,
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec,
        final String trackId
    ) {
        mainHandler.post(() -> {
            if (url == null || url.trim().isEmpty()) {
                return;
            }
            mainHandler.removeCallbacks(nativeProgressTicker);
            ensureNativePlayerOnMainThread(authToken);
            currentNativeVolume = Math.max(0.0f, Math.min(1.0f, volume));
            cancelCrossfadeOnMainThread();
            resetOutroCounters();
            if (nativeDeckDsp != null) {
                nativeDeckDsp.resetTrackStats();
            }
            if (title != null && !title.isEmpty()) {
                updateMetadata(title, artist, album, coverUrl, durationSec, trackId);
            }
            nativeAudioActive = true;
            lastNativeStreamUrl = url.trim();
            lastNativeAuthToken = authToken != null ? authToken : "";
            currentPositionSec = Math.max(0.0, startSec);
            currentPlaybackRate = playbackRate > 0 ? playbackRate : 1.0f;
            if (durationSec > 0) {
                currentDurationSec = durationSec;
            }
            isPlaying = true;
            nativeSnapshotPlaying = true;
            nativeSnapshotBuffering = true;
            nativeSnapshotPosSec = currentPositionSec;
            nativeSnapshotDurSec = currentDurationSec;
            nativeSnapshotSpeed = (float) currentPlaybackRate;
            acquireWakeLock();
            ensureForegroundNotification();

            if (nativePlayer != null) {
                isSwitchingNativeTrack = true;
                try {
                    nativePlayer.setVolume(currentNativeVolume);
                    nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
                    nativePlayer.setPlaybackParameters(new PlaybackParameters(playbackRate > 0 ? playbackRate : 1.0f));
                    nativePlayer.setMediaItem(MediaItem.fromUri(url.trim()));
                    nativePlayer.seekTo(startSec > 0 ? (long) (startSec * 1000.0) : 0L);
                    nativePlayer.setPlayWhenReady(true);
                    nativePlayer.prepare();
                    nativePlayer.play();
                } catch (Throwable ignored) {
                } finally {
                    isSwitchingNativeTrack = false;
                }
            }
            emitNativeState("buffering", null);
        });
    }

    public void prepareNextNativeStream(
        final String url,
        final String authToken,
        final double startSec,
        final float playbackRate,
        final String trackId
    ) {
        prepareNextNativeStream(url, authToken, startSec, playbackRate, trackId, "Soundify", "", "", "", 0.0);
    }

    public void prepareNextNativeStream(
        final String url,
        final String authToken,
        final double startSec,
        final float playbackRate,
        final String trackId,
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec
    ) {
        if (url == null || url.trim().isEmpty()) return;
        mainHandler.post(() -> {
            ensureNativePlayerOnMainThread(authToken);
            mainHandler.removeCallbacks(nextDeckIntroScanTicker);
            nextDeckIntroScanning = false;
            nextDeckIntroScanDone = false;
            nextDeckIntroScanStartedPlayback = false;
            nextDeckFirstAudibleMs = -1L;
            nextDeckFirstMusicBodyMs = -1L;
            nextDeckAudibleTicks = 0;
            nextDeckTargetPlaybackRate = playbackRate > 0 ? playbackRate : 1.0f;
            if (nextDeckPlayer == null) {
                nextDeckDsp = new AutoMixDspProcessor();
                nextDeckPlayer = buildDspExoPlayer(nextDeckDsp);
                nextDeckPlayer.setWakeMode(androidx.media3.common.C.WAKE_MODE_NETWORK);
            }
            if (nextDeckDsp != null) {
                nextDeckDsp.resetTrackStats();
            }
            nextDeckPlayer.setAudioAttributes(buildMediaAudioAttributes(), false);
            nextDeckTrackId = trackId != null ? trackId : "";
            nextDeckStreamUrl = url.trim();
            nextDeckTitle = (title != null && !title.isEmpty()) ? title : "Soundify";
            nextDeckArtist = artist != null ? artist : "";
            nextDeckAlbum = album != null ? album : "";
            nextDeckCoverUrl = coverUrl != null ? coverUrl : "";
            nextDeckDurationSec = Math.max(0.0, durationSec);
            nextDeckStartMs = 0L;
            nextDeckPlayer.setPlayWhenReady(false);
            nextDeckPlayer.pause();
            nextDeckPlayer.stop();
            nextDeckPlayer.clearMediaItems();
            nextDeckPlayer.setVolume(0.0f);
            nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(nextDeckTargetPlaybackRate));
            nextDeckPlayer.setMediaItem(MediaItem.fromUri(url.trim()));
            nextDeckPlayer.seekTo(nextDeckStartMs);
            nextDeckPlayer.prepare();

            if (!isCrossfading) {
                nextDeckIntroScanning = true;
                nextDeckIntroScanPrepWallMs = SystemClock.elapsedRealtime();
                mainHandler.postDelayed(nextDeckIntroScanTicker, 60L);
            }

            // Asynchronously run Stage 1-2 MediaExtractor+MediaCodec PCM analysis on both decks (~30s ahead)
            if (scheduledAutoMixPlan == null || !nextDeckTrackId.equals(scheduledAutoMixPlan.trackBId)) {
                scheduledAutoMixPlan = null;
                final int planSeq = autoMixPlanSeq.incrementAndGet();
                final String captureAId = currentTrackId != null ? currentTrackId : "";
                final String captureAUrl = lastNativeStreamUrl != null ? lastNativeStreamUrl : "";
                final double captureDurA = currentDurationSec;
                final String captureBId = nextDeckTrackId;
                final String captureBUrl = nextDeckStreamUrl;
                final Map<String, String> analyzerHeaders = new HashMap<>();
                analyzerHeaders.put("User-Agent", APP_USER_AGENT);
                analyzerHeaders.put("X-App-Version", APP_VERSION_HEADER);
                if (authToken != null && !authToken.trim().isEmpty()) {
                    analyzerHeaders.put("Authorization", "Bearer " + authToken.trim());
                }

                if (!captureAUrl.isEmpty() && !captureBUrl.isEmpty()) {
                    try {
                        autoMixAnalyzerExecutor.execute(() -> {
                            try {
                                AutoMixPcmAnalyzer.AutoMixPlanNative analyzedPlan = AutoMixPcmAnalyzer.analyzeStreamPair(
                                    getApplicationContext(),
                                    captureAId,
                                    captureAUrl,
                                    captureDurA,
                                    captureBId,
                                    captureBUrl,
                                    analyzerHeaders
                                );
                                if (analyzedPlan == null) {
                                    return;
                                }
                                mainHandler.post(() -> {
                                    if (planSeq != autoMixPlanSeq.get() || isCrossfading) {
                                        return;
                                    }
                                    if (!captureAId.equals(currentTrackId) || !captureBId.equals(nextDeckTrackId)) {
                                        return;
                                    }
                                    scheduledAutoMixPlan = analyzedPlan;
                                    abortNextDeckIntroScanOnMainThread();
                                    long offsetMsB = Math.max(0L, (analyzedPlan.startOffsetSampleOnTrackB * 1000L) / Math.max(8000, analyzedPlan.sampleRate));
                                    nextDeckStartMs = offsetMsB;
                                    if (nextDeckPlayer != null && nextDeckPlayer.getPlaybackState() != Player.STATE_IDLE && nextDeckPlayer.isCurrentMediaItemSeekable()) {
                                        try {
                                            nextDeckPlayer.seekTo(offsetMsB);
                                        } catch (Exception ignored) {}
                                    }
                                });
                            } catch (Throwable ignored) {}
                        });
                    } catch (Throwable ignored) {}
                }
            }
        });
    }

    public void scheduleNativeAutoMixPlan(
        final AutoMixPcmAnalyzer.AutoMixPlanNative plan,
        final float volume,
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec
    ) {
        if (plan == null) return;
        mainHandler.post(() -> {
            autoMixPlanSeq.incrementAndGet();
            scheduledAutoMixPlan = plan;
            currentNativeVolume = Math.max(0.0f, Math.min(1.0f, volume));
            if (title != null && !title.isEmpty()) nextDeckTitle = title;
            if (artist != null) nextDeckArtist = artist;
            if (album != null) nextDeckAlbum = album;
            if (coverUrl != null) nextDeckCoverUrl = coverUrl;
            if (durationSec > 0) nextDeckDurationSec = durationSec;

            if (!isCrossfading && nextDeckPlayer != null && plan.trackBId.equals(nextDeckTrackId)) {
                abortNextDeckIntroScanOnMainThread();
                long offsetMsB = Math.max(0L, (plan.startOffsetSampleOnTrackB * 1000L) / Math.max(8000, plan.sampleRate));
                nextDeckStartMs = offsetMsB;
                if (nextDeckPlayer.getPlaybackState() != Player.STATE_IDLE && nextDeckPlayer.isCurrentMediaItemSeekable()) {
                    try {
                        nextDeckPlayer.seekTo(offsetMsB);
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    private void executeReadyNativeCrossfade(
        final long crossfadeMs,
        final float targetVolume,
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec,
        final String safeTrackId,
        final boolean fadeInOnly
    ) {
        if (nextDeckPlayer == null) {
            cancelCrossfadeOnMainThread();
            emitNativeState("crossfadeFailed", null);
            return;
        }
        abortNextDeckIntroScanOnMainThread();
        crossfadeTitle = (title != null && !title.isEmpty()) ? title : "Soundify";
        crossfadeArtist = artist != null ? artist : "";
        crossfadeAlbum = album != null ? album : "";
        crossfadeCoverUrl = coverUrl != null ? coverUrl : "";
        crossfadeNextDurationSec = Math.max(0.0, durationSec);
        crossfadeNextTrackId = safeTrackId;
        crossfadeTargetVolume = Math.max(0.0f, Math.min(1.0f, targetVolume));
        currentNativeVolume = crossfadeTargetVolume;
        crossfadeFadeInOnly = fadeInOnly;

        AutoMixPcmAnalyzer.AutoMixPlanNative matchedPlan = null;
        AutoMixPcmAnalyzer.AutoMixPlanNative candidatePlan = scheduledAutoMixPlan;
        String outgoingId = currentTrackId != null ? currentTrackId : "";
        if (!fadeInOnly && candidatePlan != null && outgoingId.equals(candidatePlan.trackAId) && safeTrackId.equals(candidatePlan.trackBId)) {
            matchedPlan = candidatePlan;
        }

        long clampedFadeMs = Math.min(7000L, Math.max(fadeInOnly ? 400L : 1200L, crossfadeMs));
        if (matchedPlan != null) {
            clampedFadeMs = Math.min(7000L, Math.max(1200L, (matchedPlan.durationSamples * 1000L) / Math.max(8000, matchedPlan.sampleRate)));
        }
        if (!fadeInOnly && nativePlayer != null) {
            long nativeDurMs = nativePlayer.getDuration();
            long nativePosMs = Math.max(0L, nativePlayer.getCurrentPosition());
            if (nativeDurMs > 0 && nativeDurMs != androidx.media3.common.C.TIME_UNSET) {
                long remainingMs = nativeDurMs - nativePosMs - 200L;
                if (remainingMs > 1200L) {
                    clampedFadeMs = Math.min(clampedFadeMs, remainingMs);
                } else {
                    clampedFadeMs = 1200L;
                }
            }
        }
        crossfadeDurationMs = clampedFadeMs;
        crossfadeInvokedMs = SystemClock.elapsedRealtime();
        crossfadeStartMs = crossfadeInvokedMs;

        // Promote incoming deck upfront so Player UI, lockscreen metadata & live progress switch immediately,
        // while outgoingDeck keeps Android AudioFocus undisturbed until the crossfade completes.
        resetOutroCounters();
        ExoPlayer outgoingDeck = nativePlayer;
        ExoPlayer incomingDeck = nextDeckPlayer;
        AutoMixDspProcessor outgoingDsp = nativeDeckDsp;
        AutoMixDspProcessor incomingDsp = nextDeckDsp;
        isSwitchingNativeTrack = true;
        if (outgoingDeck != null) {
            try {
                outgoingDeck.removeListener(primaryPlayerListener);
                if (fadeInOnly) {
                    outgoingDeck.setPlayWhenReady(false);
                    outgoingDeck.pause();
                    outgoingDeck.stop();
                    outgoingDeck.clearMediaItems();
                }
            } catch (Exception ignored) {}
        }

        nativePlayer = incomingDeck;
        nextDeckPlayer = outgoingDeck;
        nativeDeckDsp = incomingDsp;
        nextDeckDsp = outgoingDsp;

        sampleAccurateDspCrossfade = matchedPlan != null && !fadeInOnly;
        crossfadeTempoSync = matchedPlan != null && "BEAT_SYNC_PHRASE".equals(matchedPlan.mode) && !fadeInOnly;
        if (matchedPlan != null && !fadeInOnly) {
            crossfadeInitialTempoRatioB = matchedPlan.initialTempoRatioB;
            crossfadeTargetTempoRatioA = matchedPlan.targetTempoRatioA;
            crossfadeTempoLockCompleteProgress = matchedPlan.tempoLockCompleteProgress;
            crossfadeGainCompLinear = (float) Math.pow(10.0, Math.max(-4.0, Math.min(4.0, matchedPlan.gainCompensationDbB)) / 20.0);
            if (nativeDeckDsp != null) {
                nativeDeckDsp.resetTrackStats();
                nativeDeckDsp.setHighPassHz(220.0f);
            }
            if (nextDeckDsp != null) {
                nextDeckDsp.stopSampleAccurateAutoMix();
                nextDeckDsp.setHighPassHz(0.0f);
            }
        } else {
            crossfadeGainCompLinear = 1.0f;
            if (nativeDeckDsp != null) {
                nativeDeckDsp.resetTrackStats();
                nativeDeckDsp.setHighPassHz(fadeInOnly ? 0.0f : 260.0f);
            }
            if (nextDeckDsp != null) {
                nextDeckDsp.stopSampleAccurateAutoMix();
                nextDeckDsp.setHighPassHz(0.0f);
            }
        }
        nativeAudioActive = true;
        crossfadeIncomingReady = (nativePlayer.getPlaybackState() == Player.STATE_READY);

        try {
            nativePlayer.setVolume(0.0f);
            if (crossfadeTempoSync) {
                nativePlayer.setPlaybackParameters(new PlaybackParameters(crossfadeInitialTempoRatioB, 1.0f));
                if (nextDeckPlayer != null) {
                    nextDeckPlayer.setPlaybackParameters(new PlaybackParameters(1.0f, 1.0f));
                }
            }
            if (Math.abs(nativePlayer.getCurrentPosition() - nextDeckStartMs) > 600L) {
                nativePlayer.seekTo(nextDeckStartMs);
            }
            nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            nativePlayer.addListener(primaryPlayerListener);
            nativePlayer.setPlayWhenReady(true);
            nativePlayer.play();
        } catch (Exception ignored) {} finally {
            isSwitchingNativeTrack = false;
        }

        if (nextDeckStreamUrl != null && !nextDeckStreamUrl.isEmpty()) {
            lastNativeStreamUrl = nextDeckStreamUrl;
        }
        nextDeckStreamUrl = "";
        nextDeckTrackId = "";

        if (crossfadeNextTrackId != null && !crossfadeNextTrackId.isEmpty()) {
            int matchedIdx = findQueueIndexById(crossfadeNextTrackId);
            if (matchedIdx >= 0) {
                nativeQueueIndex = matchedIdx;
            } else if (pendingNextQueueIndex >= 0 && pendingNextQueueIndex < nativeQueue.size()) {
                nativeQueueIndex = pendingNextQueueIndex;
            }
        }
        pendingNextQueueIndex = -1;

        long initialPosMs = Math.max(0L, nextDeckStartMs);
        crossfadePositionFloorMs = initialPosMs;
        crossfadePositionGuardUntilMs = SystemClock.elapsedRealtime() + 750L;
        long durMs = nativePlayer.getDuration();
        currentPositionSec = initialPosMs / 1000.0;
        currentDurationSec = (durMs > 0 && durMs != androidx.media3.common.C.TIME_UNSET)
            ? durMs / 1000.0
            : (crossfadeNextDurationSec > 0 ? crossfadeNextDurationSec : currentDurationSec);
        isPlaying = true;

        if (crossfadeTitle != null && !crossfadeTitle.isEmpty()) {
            updateMetadata(
                crossfadeTitle,
                crossfadeArtist,
                crossfadeAlbum,
                crossfadeCoverUrl,
                currentDurationSec,
                crossfadeNextTrackId
            );
        }

        mainHandler.removeCallbacks(nativeProgressTicker);
        acquireWakeLock();
        ensureForegroundNotification();
        mainHandler.postDelayed(nativeProgressTicker, 250L);
        updatePlaybackState(true, currentPositionSec, currentDurationSec, currentPlaybackRate);

        isCrossfading = true;
        mainHandler.removeCallbacks(crossfadeTicker);
        mainHandler.post(crossfadeTicker);
        emitNativeState("crossfadeStarted", null);
    }

    public void startNativeCrossfade(
        final long crossfadeMs,
        final float targetVolume,
        final String title,
        final String artist,
        final String album,
        final String coverUrl,
        final double durationSec,
        final String trackId
    ) {
        mainHandler.post(() -> {
            abortNextDeckIntroScanOnMainThread();
            String safeTrackId = trackId != null ? trackId : "";
            PlaybackException nextErr = nextDeckPlayer != null ? nextDeckPlayer.getPlayerError() : null;
            if (
                nextDeckPlayer == null ||
                !safeTrackId.equals(nextDeckTrackId) ||
                nextDeckPlayer.getPlaybackState() == Player.STATE_IDLE ||
                nextErr != null
            ) {
                cancelCrossfadeOnMainThread();
                emitNativeState("crossfadeFailed", nextErr);
                return;
            }
            if (!nativeAudioActive || nativePlayer == null) {
                // Hybrid web-to-native crossfade: outgoing track fades in WebView while incoming fades in on ExoPlayer
                stopFadingOutPlayerOnMainThread();
                executeReadyNativeCrossfade(
                    crossfadeMs,
                    targetVolume,
                    title,
                    artist,
                    album,
                    coverUrl,
                    durationSec,
                    safeTrackId,
                    true
                );
                return;
            }
            if (nextDeckPlayer.getPlaybackState() == Player.STATE_BUFFERING) {
                // Wait until incoming stream has decoded audio ready before switching UI or ducking outgoing audio
                pendingCrossfadeMs = crossfadeMs;
                pendingCrossfadeTargetVolume = targetVolume;
                pendingCrossfadeTitle = title != null ? title : "Soundify";
                pendingCrossfadeArtist = artist != null ? artist : "";
                pendingCrossfadeAlbum = album != null ? album : "";
                pendingCrossfadeCoverUrl = coverUrl != null ? coverUrl : "";
                pendingCrossfadeDurationSec = durationSec;
                pendingCrossfadeTrackId = safeTrackId;
                pendingCrossfade = true;
                mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
                mainHandler.postDelayed(pendingCrossfadeWaitTicker, 32L);
                return;
            }
            pendingCrossfade = false;
            mainHandler.removeCallbacks(pendingCrossfadeWaitTicker);
            executeReadyNativeCrossfade(
                crossfadeMs,
                targetVolume,
                title,
                artist,
                album,
                coverUrl,
                durationSec,
                safeTrackId,
                false
            );
        });
    }

    public void cancelNativeCrossfade() {
        mainHandler.post(this::cancelCrossfadeOnMainThread);
    }

    public void nativePlay() {
        mainHandler.post(() -> {
            if (nativeAudioActive && nativePlayer != null) {
                acquireWakeLock();
                nativePlayer.play();
            }
        });
    }

    public void nativePause() {
        mainHandler.post(() -> {
            cancelCrossfadeOnMainThread();
            if (nativeAudioActive && nativePlayer != null) {
                nativePlayer.pause();
            }
        });
    }

    public void nativeStop() {
        mainHandler.post(() -> {
            mainHandler.removeCallbacks(nativeProgressTicker);
            cancelCrossfadeOnMainThread();
            nativeAudioActive = false;
            if (nativePlayer != null) {
                try {
                    nativePlayer.stop();
                    nativePlayer.clearMediaItems();
                } catch (Exception ignored) {}
            }
        });
    }

    private void nativeReplayOnMainThread() {
        cancelCrossfadeOnMainThread();
        if (!nativeAudioActive || nativePlayer == null) return;
        acquireWakeLock();
        isPlaying = true;
        currentPositionSec = 0.0;
        boolean seekable = nativePlayer.isCurrentMediaItemSeekable();
        if (seekable && nativePlayer.getPlaybackState() != Player.STATE_IDLE) {
            nativePlayer.seekTo(0L);
            nativePlayer.prepare();
            nativePlayer.play();
        } else if (lastNativeStreamUrl != null && !lastNativeStreamUrl.isEmpty()) {
            ensureNativePlayerOnMainThread(lastNativeAuthToken);
            nativePlayer.stop();
            nativePlayer.clearMediaItems();
            nativePlayer.setVolume(currentNativeVolume);
            nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            nativePlayer.setPlaybackParameters(new PlaybackParameters((float) (currentPlaybackRate > 0 ? currentPlaybackRate : 1.0)));
            nativePlayer.setMediaItem(MediaItem.fromUri(lastNativeStreamUrl));
            nativePlayer.prepare();
            nativePlayer.play();
        } else {
            nativePlayer.seekTo(0L);
            nativePlayer.prepare();
            nativePlayer.play();
        }
        mainHandler.removeCallbacks(nativeProgressTicker);
        mainHandler.postDelayed(nativeProgressTicker, 250L);
        updatePlaybackState(true, 0.0, currentDurationSec, currentPlaybackRate);
        emitNativeState("state", null);
    }

    public void nativeReplay() {
        mainHandler.post(this::nativeReplayOnMainThread);
    }

    private int findQueueIndexById(final String trackId) {
        if (trackId == null || trackId.isEmpty()) return -1;
        for (int i = 0; i < nativeQueue.size(); i++) {
            if (trackId.equals(nativeQueue.get(i).id)) {
                return i;
            }
        }
        return -1;
    }

    private int resolveNextQueueIndex(final boolean allowWrap) {
        int size = nativeQueue.size();
        if (size == 0) return -1;
        int curIdx = findQueueIndexById(currentTrackId);
        if (curIdx < 0) curIdx = nativeQueueIndex;
        if (curIdx < 0 || curIdx >= size) curIdx = 0;

        if (nativeShuffle && size > 1) {
            int candidate = queueShuffleRandom.nextInt(size);
            if (candidate == curIdx) {
                candidate = (curIdx + 1) % size;
            }
            return candidate;
        }

        int nextIdx = curIdx + 1;
        if (nextIdx >= size) {
            if ("all".equals(nativeRepeatMode) && allowWrap) {
                return 0;
            }
            return -1;
        }
        return nextIdx;
    }

    private void maybeAutoPrepareNextFromQueueOnMainThread() {
        if (!nativeAudioActive || nativePlayer == null || isCrossfading || pendingCrossfade) return;
        if ("one".equals(nativeRepeatMode)) return;
        if (nextDeckTrackId != null && !nextDeckTrackId.isEmpty()) return;
        if (nativeQueue.isEmpty()) return;

        int nextIdx = resolveNextQueueIndex(true);
        if (nextIdx < 0 || nextIdx >= nativeQueue.size()) return;
        NativeQueueEntry nextEntry = nativeQueue.get(nextIdx);
        if (nextEntry == null || nextEntry.url == null || nextEntry.url.isEmpty()) return;
        if (nextEntry.id != null && nextEntry.id.equals(currentTrackId)) return;

        pendingNextQueueIndex = nextIdx;
        prepareNextNativeStream(
            nextEntry.url,
            lastNativeAuthToken,
            0.0,
            (float) (currentPlaybackRate > 0 ? currentPlaybackRate : 1.0),
            nextEntry.id,
            nextEntry.title,
            nextEntry.artist,
            nextEntry.album,
            nextEntry.coverUrl,
            nextEntry.durationSec
        );
    }

    private void playNativeQueueEntryOnMainThread(final NativeQueueEntry entry) {
        if (entry == null || entry.url == null || entry.url.isEmpty()) return;
        ensureNativePlayerOnMainThread(lastNativeAuthToken);
        cancelCrossfadeOnMainThread();
        resetOutroCounters();
        if (nativeDeckDsp != null) {
            nativeDeckDsp.resetTrackStats();
        }
        updateMetadata(entry.title, entry.artist, entry.album, entry.coverUrl, entry.durationSec, entry.id);
        nativeAudioActive = true;
        lastNativeStreamUrl = entry.url;
        currentPositionSec = 0.0;
        if (entry.durationSec > 0) {
            currentDurationSec = entry.durationSec;
        }
        isPlaying = true;
        acquireWakeLock();
        ensureForegroundNotification();
        if (nativePlayer != null) {
            isSwitchingNativeTrack = true;
            try {
                nativePlayer.setVolume(currentNativeVolume);
                nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
                nativePlayer.setPlaybackParameters(new PlaybackParameters((float) (currentPlaybackRate > 0 ? currentPlaybackRate : 1.0)));
                nativePlayer.setMediaItem(MediaItem.fromUri(entry.url));
                nativePlayer.setPlayWhenReady(true);
                nativePlayer.prepare();
                nativePlayer.play();
            } catch (Throwable ignored) {
            } finally {
                isSwitchingNativeTrack = false;
            }
        }
        mainHandler.removeCallbacks(nativeProgressTicker);
        mainHandler.postDelayed(nativeProgressTicker, 250L);
        updatePlaybackState(true, 0.0, currentDurationSec, currentPlaybackRate);
    }

    public void syncNativeQueue(
        final String queueJson,
        final int currentIndex,
        final String activeTrackId,
        final boolean shuffle,
        final String repeatMode,
        final boolean autoMixEnabled,
        final String authToken
    ) {
        final String safeMode = "one".equals(repeatMode) ? "one" : ("all".equals(repeatMode) ? "all" : "off");
        nativeShuffle = shuffle;
        nativeRepeatMode = safeMode;
        nativeAutoMixEnabled = autoMixEnabled;
        if (authToken != null && !authToken.isEmpty()) {
            lastNativeAuthToken = authToken;
        }

        final List<NativeQueueEntry> parsed = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(queueJson != null ? queueJson : "[]");
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                String url = item.optString("url", "");
                if (id.isEmpty() || url.isEmpty()) continue;
                parsed.add(new NativeQueueEntry(
                    id,
                    url,
                    item.optString("title", "Soundify"),
                    item.optString("artist", ""),
                    item.optString("album", ""),
                    item.optString("coverUrl", ""),
                    item.optDouble("duration", 0.0)
                ));
            }
        } catch (Exception ignored) {}

        mainHandler.post(() -> {
            nativeQueue.clear();
            nativeQueue.addAll(parsed);
            int idxById = findQueueIndexById(activeTrackId != null && !activeTrackId.isEmpty() ? activeTrackId : currentTrackId);
            if (idxById >= 0) {
                nativeQueueIndex = idxById;
            } else if (currentIndex >= 0 && currentIndex < nativeQueue.size()) {
                nativeQueueIndex = currentIndex;
            } else {
                nativeQueueIndex = nativeQueue.isEmpty() ? -1 : 0;
            }
            if (nativePlayer != null) {
                nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            }
        });
    }

    public void setNativeAutoMixEnabled(final boolean enabled) {
        nativeAutoMixEnabled = enabled;
    }

    public void nativeSetRepeatMode(final String mode) {
        nativeRepeatMode = "one".equals(mode) ? "one" : ("all".equals(mode) ? "all" : "off");
        mainHandler.post(() -> {
            if (nativePlayer != null) {
                nativePlayer.setRepeatMode("one".equals(nativeRepeatMode) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            }
        });
    }

    public void nativeSeek(final double positionSec) {
        mainHandler.post(() -> {
            if (isCrossfading || pendingCrossfade) {
                cancelCrossfadeOnMainThread();
            }
            crossfadePositionGuardUntilMs = 0L;
            resetOutroCounters();
            double safePos = Math.max(0.0, positionSec);
            if (nativeAudioActive && nativePlayer != null) {
                long targetMs = (long) (safePos * 1000.0);
                int playbackState = nativePlayer.getPlaybackState();
                boolean seekable = nativePlayer.isCurrentMediaItemSeekable();
                long bufferedMs = Math.max(0L, nativePlayer.getBufferedPosition());

                if (playbackState == Player.STATE_ENDED) {
                    if (seekable || (targetMs == 0L && bufferedMs > 0L)) {
                        nativePlayer.seekTo(targetMs);
                        nativePlayer.prepare();
                        nativePlayer.play();
                    } else if (lastNativeStreamUrl != null && !lastNativeStreamUrl.isEmpty()) {
                        nativeReplayOnMainThread();
                        return;
                    }
                } else if (seekable) {
                    nativePlayer.seekTo(targetMs);
                } else {
                    // For unseekable live/transcoded pipes (e.g. SoundCloud HLS -> FFmpeg Accept-Ranges: none),
                    // seeking beyond buffered memory resets HTTP from byte 0 (0:00). Clamp strictly inside buffer.
                    if (bufferedMs > 1000L) {
                        long clampedMs = Math.min(targetMs, Math.max(0L, bufferedMs - 500L));
                        nativePlayer.seekTo(clampedMs);
                        safePos = clampedMs / 1000.0;
                    } else {
                        safePos = Math.max(0L, nativePlayer.getCurrentPosition()) / 1000.0;
                    }
                }
                currentPositionSec = safePos;
                updatePlaybackState(nativePlayer.isPlaying(), safePos, currentDurationSec, currentPlaybackRate);
                emitNativeState("state", null);
            } else {
                currentPositionSec = safePos;
            }
        });
    }

    public void nativeSetVolume(final float volume) {
        mainHandler.post(() -> {
            float safeVol = Math.max(0.0f, Math.min(1.0f, volume));
            currentNativeVolume = safeVol;
            crossfadeTargetVolume = safeVol;
            if (!isCrossfading && nativePlayer != null) {
                nativePlayer.setVolume(safeVol);
            }
        });
    }

    public void nativeSetPlaybackRate(final float rate) {
        mainHandler.post(() -> {
            float safeRate = rate > 0 ? rate : 1.0f;
            currentPlaybackRate = safeRate;
            if (nativePlayer != null) {
                nativePlayer.setPlaybackParameters(new PlaybackParameters(safeRate));
            }
        });
    }

    public void stopForegroundService() {
        isPlaying = false;
        releaseWakeLock();
        abandonAudioFocus();
        if (isForeground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            isForeground = false;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_ID);
        }
        stopSelf();
    }
}
