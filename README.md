# Soundify Android 🎵

> Open-Source Music Streaming & Offline Media Player for Android.  
> Designed with Apple HIG & Liquid Glass aesthetics, native Android MediaStore integration, synchronized LRC lyrics, and foreground media playback.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android Version](https://img.shields.io/badge/Android-10.0%2B%20(API%2029%2B)-green.svg)](android)
[![Version](https://img.shields.io/badge/version-1.0.5-indigo.svg)](package.json)
[![Package](https://img.shields.io/badge/package-com.soundify.app-orange.svg)](capacitor.config.ts)

---

## 📱 Overview

**Soundify Android** is a cross-platform music streaming and local audio management application for Android devices. It pairs modern web capabilities (Next.js 15, React 19, Tailwind CSS) with Android native platform APIs (Capacitor 8, Android MediaStore, MediaSessionCompat, Foreground Services) to deliver a fluid music experience.

### Key Capabilities
- **Offline Audio Storage**: Download your favorite tracks directly to persistent local offline storage (IndexedDB & CacheStorage) to listen anytime without internet connectivity.
- **Synchronized Lyrics (LRC)**: View line-by-line synced lyrics with smooth auto-scroll, manual sync offset adjustment, and multiple lyrics sources (LRCLIB, Genius). Offline tracks persist lyrics for offline viewing.
- **Save to Device Public Storage (Phone Music Player Export)**: Export downloaded MP3 tracks directly to the phone's public `Music/Soundify` folder via Android `MediaStore.Audio.Media` so native system players (Samsung Music, Mi Music, VLC, Google Files) can index and play them.
- **Native Android Media Integration**: Full support for lock screen media controls, Bluetooth AVRCP (headsets, smartwatches, car infotainment), and audio focus handling.
- **Liquid Glass & Apple HIG**: Refined translucent glassmorphism, responsive tactile haptic feedback, and accessibility-first navigation.
- **Bilingual Interface**: Seamless support for both Persian (Farsi - RTL) and English (LTR).

---

## 🔒 Security & Privacy Disclosure (Google Play & Play Protect Verification)

Soundify Android is committed to user privacy and software security. The complete source code is public and transparently verifiable.

### Declared Android Permissions & Justifications

| Permission | Android API | Justification / Usage |
| :--- | :--- | :--- |
| `android.permission.INTERNET` | All | Fetching music catalog, streaming audio tracks, downloading metadata & synced lyrics. |
| `android.permission.ACCESS_NETWORK_STATE` | All | Detecting online/offline state to seamlessly switch to offline local playback. |
| `android.permission.FOREGROUND_SERVICE` | API 28+ | Required by Android to run the background audio playback service. |
| `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK` | API 34+ (Android 14+) | Explicit Android 14+ foreground service type for media playback without system termination. |
| `android.permission.POST_NOTIFICATIONS` | API 33+ (Android 13+) | Displays playback controls (Play/Pause, Next, Previous) in the system notification shade. |
| `android.permission.MODIFY_AUDIO_SETTINGS` | All | Manages audio focus when alarms, calls, or other system sounds occur. |
| `android.permission.WAKE_LOCK` | All | Prevents processor from sleeping during active audio playback. |
| `android.permission.WRITE_EXTERNAL_STORAGE` | `maxSdkVersion="28"` | Backward compatibility for saving MP3 files on legacy Android 9 and lower. Android 10+ uses Scoped Storage `MediaStore` without requiring storage permissions. |

- **No Malicious Code**: Soundify contains NO spyware, trojans, backdoors, hidden miners, unauthorized device tracking, or advertising SDKs.
- **No Background Data Harvesting**: All offline media files are stored locally on the device. User data remains private.
- **Secure Network Communications**: Cleartext traffic is restricted according to Android Network Security Configuration.

---

## 🛠 Project Architecture

```
Soundify-Android/
├── android/                             # Android Studio native project
│   ├── app/
│   │   ├── src/main/java/com/soundify/app/
│   │   │   ├── MainActivity.java        # Main Bridge Activity & cache protection
│   │   │   ├── media/
│   │   │   │   ├── MediaStorePlugin.java    # Android MediaStore public storage export
│   │   │   │   ├── MediaSessionPlugin.java  # Lockscreen & notification bridge
│   │   │   │   └── SoundifyMediaService.java# Foreground media playback service
│   │   │   └── security/
│   │   └── src/main/AndroidManifest.xml
│   └── build.gradle
├── src/
│   ├── app/
│   │   ├── library/page.tsx             # Library page with Downloaded tab & Apple HIG list
│   │   ├── track/[id]/                  # Track details & player
│   │   └── playlist/[id]/
│   ├── components/
│   │   ├── LyricsPanel.tsx              # Synchronized lyrics viewer & offset sync
│   │   ├── PlayerDock.tsx               # Floating glass player dock
│   │   └── GlassControls.tsx            # Apple HIG translucent glass controls
│   ├── context/
│   │   ├── PlayerContext.tsx            # Audio playback & queue state machine
│   │   └── I18nContext.tsx              # English & Persian localization
│   ├── lib/
│   │   ├── mediaExport.ts               # Public storage export (MediaStore + Web download)
│   │   ├── offlineAudioStorage.ts       # IndexedDB offline storage & lyrics cache
│   │   └── downloadManager.ts           # Concurrent download queue & status store
│   └── tests/                           # 40 comprehensive Vitest test suites (373 tests)
├── capacitor.config.ts
└── package.json
```

---

## 🚀 Building from Source

### Prerequisites
- Node.js 20+ & npm
- JDK 17 or JDK 21
- Android Studio / Android SDK (API 34 / 35)

### Build Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/farzadzx1234/Soundify-Android.git
   cd Soundify-Android
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run unit tests**:
   ```bash
   npm test
   ```

4. **Build Next.js static assets**:
   ```bash
   npm run build:export
   ```

5. **Sync with Android Capacitor container**:
   ```bash
   npx cap sync android
   ```

6. **Assemble the Android Debug APK**:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```
   The compiled APK will be generated at:
   `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).

Developed by **Farzad Alizadeh** ([@farzadzx1234](https://github.com/farzadzx1234)).
