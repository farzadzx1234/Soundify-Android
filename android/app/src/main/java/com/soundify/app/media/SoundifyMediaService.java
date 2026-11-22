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
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.soundify.app.MainActivity;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    public static final String ACTION_MEDIA_BUTTON = "android.intent.action.MEDIA_BUTTON";

    private static final String CHANNEL_ID = "soundify_media_playback";
    private static final int NOTIFICATION_ID = 2001;
    private static final String WAKE_LOCK_TAG = "Soundify:MediaPlaybackWakeLock";
    private static final String DEFAULT_BASE_URL = "https://soundify.mashhad-ix.ir";

    private static SoundifyMediaService instance;

    private MediaSession mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executorService = Executors.newSingleThreadExecutor();

    private boolean isPlaying = false;
    private boolean isForeground = false;
    private boolean wasPlayingBeforeTransientLoss = false;
    private boolean isBecomingNoisyRegistered = false;

    private String currentTitle = "Soundify";
    private String currentArtist = "";
    private String currentAlbum = "";
    private String currentCoverUrl = "";
    private double currentPositionSec = 0.0;
    private double currentDurationSec = 0.0;
    private double currentPlaybackRate = 1.0;
    private Bitmap cachedArtworkBitmap = null;

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
        unregisterBecomingNoisyReceiver();
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        executorService.shutdownNow();
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
                // Sync service/notification state from JS without echoing mediaAction back to JS
                // and without stealing AudioFocus from Chromium WebView's <audio> element.
                updatePlaybackState(syncPlaying, syncPos, syncDuration, syncRate);
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
                double playPos = intent.getDoubleExtra("position", currentPositionSec);
                currentPositionSec = Math.max(0.0, playPos);
                double playRate = intent.getDoubleExtra("playbackRate", currentPlaybackRate);
                currentPlaybackRate = playRate > 0 ? playRate : 1.0;
                acquireWakeLock();
                isPlaying = true;
                updatePlaybackState(true, currentPositionSec, currentDurationSec, currentPlaybackRate);
                MediaSessionPlugin.sendMediaAction("play", null);
                break;

            case ACTION_PAUSE:
                isPlaying = false;
                releaseWakeLock();
                updatePlaybackState(false, currentPositionSec, currentDurationSec, currentPlaybackRate);
                MediaSessionPlugin.sendMediaAction("pause", null);
                break;

            case ACTION_PLAY_PAUSE:
                isPlaying = !isPlaying;
                if (isPlaying) {
                    acquireWakeLock();
                } else {
                    releaseWakeLock();
                }
                updatePlaybackState(isPlaying, currentPositionSec, currentDurationSec, currentPlaybackRate);
                MediaSessionPlugin.sendMediaAction("togglePlay", null);
                break;

            case ACTION_NEXT:
                MediaSessionPlugin.sendMediaAction("next", null);
                break;

            case ACTION_PREV:
                MediaSessionPlugin.sendMediaAction("prev", null);
                break;

            case ACTION_STOP:
                stopForegroundService();
                MediaSessionPlugin.sendMediaAction("stop", null);
                break;

            case ACTION_SEEK:
                double seekPos = intent.getDoubleExtra("position", currentPositionSec);
                currentPositionSec = seekPos;
                JSObject seekData = new JSObject();
                seekData.put("position", seekPos);
                MediaSessionPlugin.sendMediaAction("seek", seekData);
                updatePlaybackState(isPlaying, seekPos, currentDurationSec, currentPlaybackRate);
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
    }

    public synchronized void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                // Safety acquire for 45 minutes of continuous decoding
                wakeLock.acquire(45 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    public synchronized void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
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

    public void updateMetadata(String title, String artist, String album, String coverUrl, double durationSec, String trackId) {
        this.currentTitle = (title != null && !title.isEmpty()) ? title : "Soundify";
        this.currentArtist = (artist != null) ? artist : "";
        this.currentAlbum = (album != null) ? album : "";
        this.currentDurationSec = durationSec;

        boolean coverChanged = coverUrl != null && !coverUrl.equals(this.currentCoverUrl);
        this.currentCoverUrl = (coverUrl != null) ? coverUrl : "";

        if (coverChanged) {
            loadArtworkAsync(this.currentCoverUrl);
        } else {
            applyMediaMetadata();
            updateNotification();
        }
    }

    public void ensureForegroundNotification() {
        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isForeground = true;
        } catch (Exception ignored) {}
    }

    public void updatePlaybackState(boolean playing, double positionSec, double durationSec, double playbackRate) {
        this.isPlaying = playing;
        this.currentPositionSec = Math.max(0.0, positionSec);
        if (durationSec > 0) {
            this.currentDurationSec = durationSec;
        }
        this.currentPlaybackRate = playbackRate > 0 ? playbackRate : 1.0;

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

            if (cachedArtworkBitmap != null) {
                builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cachedArtworkBitmap);
                builder.putBitmap(MediaMetadata.METADATA_KEY_ART, cachedArtworkBitmap);
            }

            mediaSession.setMetadata(builder.build());
        } catch (Exception ignored) {}
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
        } catch (Exception ignored) {}
    }

    private void loadArtworkAsync(String rawCoverUrl) {
        if (rawCoverUrl == null || rawCoverUrl.isEmpty()) {
            cachedArtworkBitmap = null;
            applyMediaMetadata();
            updateNotification();
            return;
        }

        final String coverUrl;
        if (rawCoverUrl.startsWith("blob:")) {
            coverUrl = "";
        } else if (rawCoverUrl.startsWith("http://localhost") || rawCoverUrl.startsWith("https://localhost")) {
            coverUrl = rawCoverUrl.replaceFirst("^https?://localhost(:[0-9]+)?", DEFAULT_BASE_URL);
        } else if (rawCoverUrl.startsWith("/")) {
            coverUrl = DEFAULT_BASE_URL + rawCoverUrl;
        } else if (!rawCoverUrl.startsWith("http://") && !rawCoverUrl.startsWith("https://") && !rawCoverUrl.startsWith("data:")) {
            coverUrl = DEFAULT_BASE_URL + "/" + rawCoverUrl;
        } else {
            coverUrl = rawCoverUrl;
        }

        executorService.execute(() -> {
            try {
                Bitmap bitmap = null;
                if (coverUrl.startsWith("data:image/")) {
                    int commaIndex = coverUrl.indexOf(',');
                    if (commaIndex != -1) {
                        byte[] decoded = Base64.decode(coverUrl.substring(commaIndex + 1), Base64.DEFAULT);
                        bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
                    }
                } else if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
                    URL url = new URL(coverUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    conn.setRequestProperty("User-Agent", "Soundify-Android/1.0.16");
                    conn.setRequestProperty("X-App-Version", "1.0.16");
                    conn.setInstanceFollowRedirects(true);
                    conn.connect();
                    if (conn.getResponseCode() == 200) {
                        InputStream is = conn.getInputStream();
                        bitmap = BitmapFactory.decodeStream(is);
                        is.close();
                    }
                    conn.disconnect();
                }

                if (bitmap == null) {
                    try {
                        bitmap = BitmapFactory.decodeResource(getResources(), com.soundify.app.R.mipmap.ic_launcher);
                    } catch (Exception ignored) {}
                }

                if (bitmap != null && rawCoverUrl.equals(currentCoverUrl)) {
                    int maxDim = 512;
                    int width = bitmap.getWidth();
                    int height = bitmap.getHeight();
                    if (width > maxDim || height > maxDim) {
                        float ratio = Math.min((float) maxDim / width, (float) maxDim / height);
                        int targetW = Math.round(ratio * width);
                        int targetH = Math.round(ratio * height);
                        bitmap = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true);
                    }
                    final Bitmap finalBitmap = bitmap;
                    mainHandler.post(() -> {
                        if (rawCoverUrl.equals(currentCoverUrl)) {
                            cachedArtworkBitmap = finalBitmap;
                            applyMediaMetadata();
                            updateNotification();
                        }
                    });
                }
            } catch (Exception ignored) {}
        });
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

        if (cachedArtworkBitmap != null) {
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

            if (isPlaying) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                isForeground = true;
            } else {
                if (isForeground) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                } else {
                    nm.notify(NOTIFICATION_ID, notification);
                }
            }
        } catch (Exception ignored) {}
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
