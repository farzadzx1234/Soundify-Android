# Soundify Android 🎵

> Modern Open-Source Music Streaming, Offline Storage & Synchronized Media Player for Android.  
> Designed with Apple Human Interface Guidelines (HIG) & Liquid Glass aesthetics, native Android MediaStore integration, line-by-line synchronized LRC lyrics, and multi-device Spotify Connect playback sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android Version](https://img.shields.io/badge/Android-10.0%2B%20(API%2029%2B)-green.svg)](android)
[![Version](https://img.shields.io/badge/version-1.0.6-indigo.svg)](package.json)
[![Package](https://img.shields.io/badge/package-com.soundify.app-orange.svg)](capacitor.config.ts)

---

## 📑 Table of Contents / فهرست مطالب

- [English Documentation](#-english-documentation)
  - [Overview](#overview)
  - [Key Features](#key-features)
  - [Audio Architecture & Streaming Protocol](#audio-architecture--streaming-protocol)
  - [Offline Storage & MediaStore Export](#offline-storage--mediastore-export)
  - [Spotify Connect Multi-Device Synchronization](#spotify-connect-multi-device-synchronization)
  - [Security, Privacy & Android Permissions](#security-privacy--android-permissions)
  - [Project Structure](#project-structure)
  - [Building & Installation](#building--installation)
- [مستندات فارسی](#-مستندات-فارسی-persian-documentation)
  - [معرفی پروژه ساندیفای](#معرفی-پروژه-ساندیفای)
  - [قابلیت‌های برجسته](#قابلیت‌های-برجسته)
  - [معماری استریمینگ و پخش زنده صوتی](#معماری-استریمینگ-و-پخش-زنده-صوتی)
  - [ذخیره‌سازی آفلاین و انتقال به موزیک پلیر گوشی](#ذخیره‌سازی-آفلاین-و-انتقال-به-موزیک-پلیر-گوشی)
  - [همگام‌سازی چند دستگاهی اسپاتیفای کانکت](#همگام‌سازی-چند-دستگاهی-اسپاتیفای-کانکت)
  - [امنیت، حریم خصوصی و مجوزهای اندروید](#امنیت-حریم-خصوصی-و-مجوزهای-اندروید)
  - [ساختار کد و معماری فنی](#ساختار-کد-و-معماری-فنی)
  - [راهنمای کامپایل و نصب](#راهنمای-کامپایل-و-نصب)
- [License / لایسنس](#-license)

---

# 🌐 English Documentation

## Overview

**Soundify Android** is a high-performance, open-source audio streaming and offline playback client built specifically for Android devices. Combining modern web engineering (Next.js 15, React 19, Tailwind CSS v4) with native Android system capabilities (Capacitor 8, Android MediaStore, MediaSessionCompat, Foreground Services), Soundify delivers a unified music listening experience across online catalogs and device media.

Designed adhering strictly to Apple's Human Interface Guidelines (HIG) and Liquid Glass design philosophy, the interface offers translucent blurred cards, smooth responsive touch feedback, dynamic cover palettes, and bidirectional typography (Persian RTL & English LTR).

---

## Key Features

### 1. Online Streaming (YouTube, SoundCloud & Spotify)
- Direct streaming from global media sources (YouTube, SoundCloud, Spotify candidate streams) via backend proxy and direct stream fallbacks.
- Intelligent stream refresh recovery protocol: detects expired audio sockets, automatically retrieves fresh direct URLs without interrupting listener intent, and avoids playing incorrect fallback tracks.
- Dynamic waveform scrubbers generated from real audio energy peaks with interactive millisecond seek precision.

### 2. Reliable Offline Audio Storage
- High-integrity client-side storage utilizing IndexedDB and CacheStorage to preserve complete audio files, cover artwork, and synchronized lyrics.
- Offline playback works seamlessly even without an active network connection or during complete server disconnection.
- Cryptographically signed offline licenses guaranteeing local catalog integrity.

### 3. Save to Device Storage (Android MediaStore Integration)
- Single-tap export to the phone's public `Music/Soundify` folder via Android `MediaStore.Audio.Media`.
- Automatically triggers system `MediaScannerConnection` so native music applications (Samsung Music, Mi Music, VLC, Poweramp, Google Files) instantly index exported MP3 files with proper ID3 metadata, artist tags, and album art.
- Fallback browser download provider for non-native environments or restricted storage scopes.

### 4. Line-by-Line Synchronized Lyrics (LRC)
- Synchronized timecoded lyrics engine with smooth auto-scroll, active lyric highlighting, and manual timing offset controls (`-5.0s` to `+5.0s`).
- Multi-source provider fallback (LRCLIB, Genius, plain text fallback).
- Offline-persisted lyrics for saved songs.

### 5. Spotify Connect Multi-Device Playback Sync
- Cross-device state synchronizer using WebSockets and BroadcastChannel.
- Dynamic leader-follower topology: taking action on an active phone automatically claims playback sovereignty.
- Drift-compensated remote command dispatch (`PLAY`, `PAUSE`, `SEEK`, `NEXT`, `PREV`, `VOLUME`).

### 6. Native Android Media Integration
- Android Notification shade playback controls with album artwork, interactive seekbar, and action buttons.
- Bluetooth headset, smartwatch, and car infotainment (AVRCP) controls.
- Audio focus management: automatically pauses during phone calls or navigational voice prompts and resumes smoothly.

---

## Audio Architecture & Streaming Protocol

```
┌─────────────────────────────────────────────────────────────┐
│                      Soundify Android                       │
├──────────────────────────────┬──────────────────────────────┤
│       UI & Controller        │   PlayerContext State Machine│
│  - TrackCard / ExternalCard  │   - Queue Management         │
│  - PlayerDock / Overlay      │   - Sovereignty & Intent     │
│  - WaveformScrubber          │   - Stream Refresh Protocol  │
└──────────────┬───────────────┴──────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      HTML5 Audio Pipeline    │ │      IndexedDB Storage     │
│  - Direct Media Stream URL   │ │  - Offline MP3 Blobs       │
│  - Range Request Buffering   │ │  - Synced LRC Lyrics       │
│  - Exponential Retry Delays  │ │  - High-res Cover Blobs    │
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│   Soundify Backend Stream    │ │   Android MediaStore API   │
│  - yt-dlp Stream Extractor   │ │  - Public Storage Export   │
│  - SSRF URL Sanitizer        │ │  - MediaScanner Refresh    │
│  - HTTP 206 Partial Content  │ │  - System Player Indexing  │
└──────────────────────────────┘ └────────────────────────────┘
```

1. **Stream Resolution**: When an external track (`ext-*`, YouTube, SoundCloud, Spotify) is played, the application resolves canonical URLs (`extractCanonicalExternalUrl`) and queries the verified streaming endpoint.
2. **Buffer Resilience**: The audio pipeline applies progressive retry intervals (1800ms, 3500ms) for external streams, preventing race conditions while the server extracts media feeds.
3. **Recovery Interception**: If an audio stream encounters a network stall or expired GoogleVideo token, `onError` intercepts the event, requests a freshly generated stream token via `/api/external/refresh-stream`, and re-establishes playback without substituting dummy tracks.

---

## Offline Storage & MediaStore Export

Soundify provides two distinct storage layers:

| Feature | App Offline Storage (Private) | Save to Device Storage (Public) |
| :--- | :--- | :--- |
| **Location** | Sandboxed IndexedDB / CacheStorage | Phone's shared `/Music/Soundify` directory |
| **Accessibility** | Accessible inside Soundify app | Visible in Samsung Music, Mi Music, VLC, Files |
| **Lyrics** | Persisted line-by-line synced LRC | Persisted matching `.lrc` file beside `.mp3` |
| **System Scanner** | Internal cache index | Native Android `MediaScannerConnection` scan |
| **Required Permissions** | None (scoped sandbox) | Scoped MediaStore (no dangerous permissions) |

---

## Spotify Connect Multi-Device Synchronization

Soundify includes multi-device remote control inspired by Spotify Connect:
- **Device Discovery**: Devices connected under the same user account communicate over secure WebSocket channels.
- **State Broadcast**: Timestamp-based drift compensation calculates playback time offsets across variable network ping latencies.
- **Remote Commands**: Transfer playback between your desktop browser, tablet, and Android phone seamlessly.

---

## Security, Privacy & Android Permissions

Soundify Android is built with security and user privacy as core requirements. The entire source code is auditable and open-source.

### Android Permissions Table

| Permission | API Level | Purpose & Justification |
| :--- | :--- | :--- |
| `android.permission.INTERNET` | All | Fetch music catalogs, stream audio tracks, download synced LRC lyrics. |
| `android.permission.ACCESS_NETWORK_STATE` | All | Detect offline status to smoothly switch to local offline storage. |
| `android.permission.FOREGROUND_SERVICE` | API 28+ | Keep audio service alive in background while the screen is off. |
| `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK` | API 34+ | Android 14 requirement for background media playback without termination. |
| `android.permission.POST_NOTIFICATIONS` | API 33+ | Show media notification controls (play/pause/next) in system shade. |
| `android.permission.MODIFY_AUDIO_SETTINGS` | All | Manage audio focus during incoming phone calls and notifications. |
| `android.permission.WAKE_LOCK` | All | Prevent CPU sleep during active audio playback. |
| `android.permission.WRITE_EXTERNAL_STORAGE` | `maxSdkVersion="28"` | Backward compatibility for Android 9 and older devices. Android 10+ uses Scoped Storage `MediaStore` without permissions. |

- **No Malicious Code**: Soundify contains zero tracking SDKs, zero third-party telemetry frameworks, and zero ad networks.
- **Privacy Assurance**: Downloaded songs, listening history, and user preferences reside safely on device storage.

---

## Project Structure

```
Soundify-Android/
├── android/                             # Android Studio native project
│   ├── app/
│   │   ├── src/main/java/com/soundify/app/
│   │   │   ├── MainActivity.java        # Main Capacitor bridge & WebView optimizations
│   │   │   └── media/
│   │   │       ├── MediaStorePlugin.java    # Android MediaStore public storage exporter
│   │   │       ├── MediaSessionPlugin.java  # System notification & lockscreen bridge
│   │   │       └── SoundifyMediaService.java# Foreground playback service
│   │   └── src/main/AndroidManifest.xml
│   └── build.gradle
├── src/
│   ├── app/                             # Next.js 15 App Router pages
│   │   ├── search/page.tsx              # Online multi-source search (YouTube/SoundCloud/Spotify)
│   │   ├── library/page.tsx             # Saved tracks, playlists & offline downloads
│   │   ├── track/[id]/                  # High-precision waveform scrubber & track details
│   │   └── playlist/[id]/
│   ├── components/
│   │   ├── ExternalTrackCard.tsx        # Branded online search cards
│   │   ├── LyricsPanel.tsx              # Synced line-by-line lyrics viewer
│   │   ├── PlayerDock.tsx               # Floating translucent glass player dock
│   │   └── GlassControls.tsx            # Apple HIG Liquid Glass controls
│   ├── context/
│   │   ├── PlayerContext.tsx            # Sovereign playback engine & stream recovery
│   │   ├── DeviceSyncContext.tsx        # Spotify Connect multi-device controller
│   │   └── I18nContext.tsx              # Persian & English localization
│   ├── lib/
│   │   ├── api.ts                       # REST client, YouTube/SoundCloud/Spotify extractors
│   │   ├── mediaExport.ts               # MediaStore export & web fallback
│   │   ├── offlineAudioStorage.ts       # IndexedDB offline engine
│   │   └── downloadManager.ts           # Background download queue
│   └── tests/                           # 40 Vitest suites with 379 tests
├── capacitor.config.ts
└── package.json
```

---

## Building & Installation

### Requirements
- **Node.js**: v20.x or v22.x LTS
- **JDK**: Java Development Kit 17 or 21
- **Android SDK**: API Level 34 or 35
- **Android Studio** or command-line Android build tools

### Build Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/farzadzx1234/Soundify-Android.git
   cd Soundify-Android
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Execute test suite**:
   ```bash
   npm test
   ```

4. **Compile & export web bundle**:
   ```bash
   npm run build:export
   ```

5. **Synchronize native Capacitor Android assets**:
   ```bash
   npx cap sync android
   ```

6. **Assemble the Android Debug APK**:
   ```bash
   cd android
   ./gradlew assembleDebug
   cd ..
   ```

The compiled APK will be output to:  
`android/app/build/outputs/apk/debug/app-debug.apk`

---

---

# 📖 مستندات فارسی (Persian Documentation)

## معرفی پروژه ساندیفای

**ساندیفای اندروید (Soundify Android)** یک موزیک پلیر و کلاینت استریم صوتی متن‌باز، مدرن و با کارایی فوق‌العاده بالا برای گوشی‌های اندروید است. این اپلیکیشن با ترکیب استانداردهای طراحی مدرن وب (Next.js 15 و React 19) و قابلیت‌های پیشرفته سیستم‌عامل اندروید (Capacitor 8، اندروید MediaStore، Foreground Services و MediaSessionCompat) یک تجربه شنیداری روان، پایدار و بدون وقفه را در اختیار کاربر قرار می‌دهد.

رابط کاربری این برنامه با الهام مستقیم از راهنماهای طراحی اپل (Human Interface Guidelines) و زبان طراحی شیشه‌ای سیال (Liquid Glass) ساخته شده است که شامل تاری‌های زیبا، کارت‌های شیشه‌ای منعکس‌کننده نور، بازخورد لرزشی لمسی (Haptic Feedback)، پالت‌های رنگی پویا بر اساس کاور آهنگ و پشتیبانی کامل از هر دو جهت نوشتاری (فارسی راست‌چین و انگلیسی چپ‌چین) می‌باشد.

---

## قابلیت‌های برجسته

### ۱. پخش آنلاین از یوتیوب، ساندکلود و اسپاتیفای
- امکان جستجو و استریم لحظه‌ای قطعات موسیقی از منابع معتبر جهانی (YouTube، SoundCloud و Spotify) بدون محدودیت.
- پروتکل هوشمند بازیابی استریم صوتی: شناسایی خودکار سوکت‌های صوتی منقضی‌شده یا فیلترشده و دریافت لینک مستقیم بدون جایگزین کردن آهنگ‌های متفرقه یا قطع صدا.
- نمایش نوار فرکانس صوتی (Waveform) با داده‌های واقعی و امکان جابجایی دقیق به میلی‌ثانیه.

### ۲. ذخیره‌سازی آفلاین مطمئن و امن
- ذخیره قطعات دانلود شده در پایگاه داده داخلی گوشی (IndexedDB و CacheStorage) به همراه فایل صوتی کامل، کاور کیفیت بالا و لیریکس سینک‌شده.
- عملکرد مستقل و ۱۰۰٪ آفلاین در زمان قطعی کامل اینترنت، پرواز یا عدم اتصال به سرور.
- سیستم امضای رمزنگاری‌شده لایسنس آفلاین برای حفظ یکپارچگی داده‌های محلی.

### ۳. انتقال مستقیم به حافظه گوشی (پوشه Music و موزیک پلیرهای دیگر)
- امکان ذخیره مستقیم فایل‌های MP3 در پوشه عمومی حافظه گوشی (`Music/Soundify`) با استفاده از رابط برنامه‌نویسی `MediaStore.Audio.Media` اندروید.
- فعال‌سازی خودکار اسکنر رسانه اندروید (`MediaScannerConnection`) تا فایل‌های خروجی به سرعت در تمام پلیرهای سیستمی (مانند Samsung Music، Mi Music، VLC، Poweramp و فایل‌منیجرها) با تگ‌های متادیتا، نام خواننده و کاور آلبوم ظاهر شوند.
- قابلیت دانلود جایگزین برای محیط‌های وب در صورت عدم دسترسی به افزونه بومی.

### ۴. متن همگام‌سازی شده ترانه‌ها (LRC سینک‌شده)
- نمایش خط‌به‌خط لیریکس همگام با صدای خواننده با اسکرول خودکار و نرم و برجسته‌سازی متن جاری.
- امکان تنظیم دستی آفست زمان (تاخیر یا تعجیل متن از ۵- ثانیه تا ۵+ ثانیه).
- پایداری لیریکس‌های دانلود شده برای مشاهده در حالت آفلاین.

### ۵. اتصال و کنترل چند دستگاهی (Spotify Connect Sync)
- کنترل پخش و ارسال فرمان‌های پخش از طریق وب‌سوکت و BroadcastChannel میان چند دستگاه همزمان.
- جابجایی بدون درز فرمان‌های کنترل (پخش، توقف، بعدی، قبلی، جابجایی زمان و تنظیم ولوم) میان مرورگر کامپیوتر و گوشی اندروید.
- اولویت حاکمیتی فوری دستگاه فعال محلی هنگام فشردن دکمه پخش در گوشی.

### ۶. سازگاری کامل با سیستم‌عامل اندروید
- کنترل کامل پخش در نوار اعلان‌ها (Notification) و صفحه قفل با کاور آلبوم و دکمه‌های کنترلی.
- پشتیبانی کامل از دکمه‌های هندزفری سیمی، هدفون‌های بلوتوثی، ساعت‌های هوشمند و مانیتور خودرو (AVRCP).
- مدیریت تمرکز صوتی (Audio Focus): توقف خودکار هنگام تماس تلفنی یا صدای مسیریاب و ادامه پخش ملایم پس از اتمام مکالمه.

---

## معماری استریمینگ و پخش زنده صوتی

در ساندیفای، مدیریت استریمینگ صوتی تحت قوانین سخت‌گیرانه‌ای اجرا می‌شود تا تجربه شنیداری بدون نقص باقی بماند:

1. **استخراج آدرس استریم مستقیم**: هنگام فراخوانی قطعه صوتی از یوتیوب، ساندکلود یا اسپاتیفای، شناسه منبع استخراج شده و به آدرس منبع معتبر نگاشت می‌شود.
2. **تاب‌آوری تایم‌اوت شبکه**: تاخیرهای تلاش مجدد برای قطعات خارجی بر روی ۱۸۰۰ و ۳۵۰۰ میلی‌ثانیه تنظیم شده‌اند تا از قطع ناگهانی و ارسال درخواست‌های تکراری هنگام پردازش سرور جلوگیری شود.
3. **عدم پخش آهنگ اشتباهی در صورت خطا**: در صورت خطای شبکه یا انقضای لینک استریم، اپلیکیشن به هیچ عنوان آهنگ نمونه دیگری را پخش نکرده و به جای آن اقدام به نوسازی توکن استریم از طریق `/api/external/refresh-stream` می‌نماید؛ در صورت عدم موفقیت نیز پیام واضح و کاربرپسند به زبان کاربر نمایش داده می‌شود.

---

## ذخیره‌سازی آفلاین و انتقال به موزیک پلیر گوشی

| ویژگی | ذخیره‌سازی آفلاین درون برنامه‌ای | انتقال به حافظه عمومی گوشی |
| :--- | :--- | :--- |
| **محل ذخیره** | محیط ایزوله و سندباکس IndexedDB | پوشه عمومی `Music/Soundify` حافظه داخلی |
| **قابلیت دسترسی** | منحصراً از داخل اپ ساندیفای | قابل پخش در تمام پلیرها (سامسونگ موزیک، شیائومی، VLC) |
| **لیریکس** | ذخیره هماهنگ LRC در دیتابیس برنامه | ایجاد فایل متنی `.lrc` در کنار فایل صوتی |
| **اسکن سیستمی** | ایندکس داخلی برنامه | اجرای `MediaScannerConnection` جهت ثبت فوری در سیستم |
| **سطح مجوز** | بدون نیاز به مجوز ذخیره‌سازی | استفاده از Scoped Storage استاندارد اندروید ۱۰+ |

---

## همگام‌سازی چند دستگاهی اسپاتیفای کانکت

ساندیفای از سیستم نوین همگام‌سازی ابری استفاده می‌کند:
- **تشخیص خودکار دستگاه‌ها**: دستگاه‌های لاگین‌شده با حساب کاربری یکسان وضعیت پخش را مخابره می‌کنند.
- **جبران تاخیر شبکه**: محاسبه انحراف زمانی (Drift Compensation) بر اساس پینگ شبکه برای همگام نگه‌داشتن میلی‌ثانیه‌ای تایم پخش.
- **انتقال صوت**: امکان هدایت صوت از کامپیوتر به گوشی و برعکس با یک لمس.

---

## امنیت، حریم خصوصی و مجوزهای اندروید

ساندیفای امنیت کاربران را در اولویت قرار داده است. سورس‌کد پروژه کاملاً شفاف و عاری از هرگونه مؤلفه مخرب است.

### جدول شفافیت مجوزهای سیستم‌عامل اندروید

| مجوز | سطح اندروید | ضرورت و کاربرد |
| :--- | :--- | :--- |
| `INTERNET` | تمامی نسخه‌ها | بارگذاری کاتالوگ آهنگ‌ها، پخش استریم آنلاین و دریافت لیریکس. |
| `ACCESS_NETWORK_STATE` | تمامی نسخه‌ها | پایش وضعیت شبکه جهت سوییچ نرم به قطعات آفلاین در زمان قطعی اینترنت. |
| `FOREGROUND_SERVICE` | اندروید ۹ به بالا | اجرای سرویس پخش پس‌زمینه بدون بسته شدن برنامه توسط سیستم. |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | اندروید ۱۴ به بالا | مشخص‌کردن نوع سرویس رسانه در سیستم‌عامل‌های مدرن اندروید. |
| `POST_NOTIFICATIONS` | اندروید ۱۳ به بالا | نمایش کنترل‌های پخش در نوار اعلان‌ها. |
| `MODIFY_AUDIO_SETTINGS` | تمامی نسخه‌ها | مدیریت هوشمند وقفه صدا هنگام زنگ خوردن گوشی یا هشدارها. |
| `WAKE_LOCK` | تمامی نسخه‌ها | جلوگیری از به خواب رفتن پردازنده در حین پخش مداوم موسیقی. |
| `WRITE_EXTERNAL_STORAGE` | حداکثر اندروید ۹ | سازگاری برای ذخیره فایل MP3 در نسخه‌های قدیمی. در اندروید ۱۰+ بدون مجوز انجام می‌شود. |

---

## ساختار کد و معماری فنی

- **Next.js 15 & React 19**: فریم‌ورک پایه وب جهت رندر بهینه، ساختاربندی ماژولار و خروجی استاتیک سازگار با اندروید.
- **Tailwind CSS v4 & Glisse**: استایل‌دهی مدرن با رنگ‌های گرادیانی، متریال شیشه‌ای بلور، و المان‌های منطبق با Apple HIG.
- **Capacitor 8**: پل ارتباطی پایدار میان هسته جاوااسکریپت و کدهای بومی جاوا (Java) در سیستم‌عامل اندروید.
- **Vitest Framework**: پوشش جامع آزمون‌ها با ۴۰ فایل تست و ۳۷۹ تست واحد مستقل.

---

## راهنمای کامپایل و نصب

### پیش‌نیازها
- **Node.js**: نگارش ۲۰ یا ۲۲
- **Java JDK**: نسخه ۱۷ یا ۲۱
- **Android SDK**: نسخه ۳۴ یا ۳۵

### مراحل کامپایل

۱. **دریافت سورس پروژه**:
   ```bash
   git clone https://github.com/farzadzx1234/Soundify-Android.git
   cd Soundify-Android
   ```

۲. **نصب وابستگی‌ها**:
   ```bash
   npm install
   ```

۳. **اجرای تست‌های نرم‌افزاری**:
   ```bash
   npm test
   ```

۴. **تولید خروجی وب استاتیک**:
   ```bash
   npm run build:export
   ```

۵. **همگام‌سازی با مخزن بومی اندروید**:
   ```bash
   npx cap sync android
   ```

۶. **کامپایل فایل نصبی (APK)**:
   ```bash
   cd android
   ./gradlew assembleDebug
   cd ..
   ```

فایل نهایی در مسیر زیر در دسترس خواهد بود:  
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License

This software is licensed under the [MIT License](LICENSE).  
توسعه‌داده شده توسط **فرزاد علیزاده (Farzad Alizadeh)** — [@farzadzx1234](https://github.com/farzadzx1234)
