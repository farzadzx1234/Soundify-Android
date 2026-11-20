# Soundify Android 🎵

> A modern, elegant, and fast music streaming & offline media player designed for Android.  
> Enjoy seamless online music playback, background listening, real-time download progress, synchronized lyrics, and a fluid glass interface.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android Version](https://img.shields.io/badge/Android-10.0%2B%20(API%2029%2B)-green.svg)](android)
[![Version](https://img.shields.io/badge/version-1.0.8-indigo.svg)](package.json)

---

## 📑 Table of Contents / فهرست مطالب

- [English Documentation](#-english-documentation)
  - [About Soundify](#about-soundify)
  - [Key Features](#key-features)
  - [Installation Guide](#installation-guide)
  - [Building from Source](#building-from-source)
- [مستندات فارسی](#-مستندات-فارسی)
  - [درباره ساندیفای](#درباره-ساندیفای)
  - [ویژگی‌های کلیدی](#ویژگیهای-کلیدی)
  - [راهنمای نصب](#راهنمای-نصب)
  - [کامپایل از سورس](#کامپایل-از-سورس)
- [License / مجوز](#-license)

---

# 🌐 English Documentation

## About Soundify

**Soundify Android** is a music player crafted for Android devices. It combines a clean, modern aesthetic with fast music streaming and reliable offline playback. Whether you are connected to Wi-Fi or on the go without network access, Soundify lets you enjoy your music with synchronized lyrics, rich artwork, and responsive playback controls.

---

## Key Features

- 🎧 **Fast Music Streaming**: Search and stream your favorite tracks instantly with clean audio quality and minimal buffering.
- 💾 **Offline Music Storage**: Save songs directly to your device so you can listen anywhere, anytime — even in airplane mode.
- 📊 **Visual Download Progress**: Clear percentage indicators and progress bars show you exactly how much of your track has been downloaded in real time.
- 🎤 **Synchronized Lyrics**: Follow along with line-by-line synchronized lyrics that highlight and scroll automatically with the singer.
- 📱 **Native Android Integration**: Full playback controls in the notification bar, lock screen, and through Bluetooth headphones and car audio systems.
- 🎨 **Modern Glass Design**: Elegant translucent glass cards, dynamic album colors, and smooth animations inspired by modern design standards.
- 🌐 **Bilingual Interface**: Seamless support for both English (LTR) and Persian (RTL).

---

## Installation Guide

1. Go to the [Releases](https://github.com/farzadzx1234/Soundify-Android/releases) page.
2. Download the latest `app-debug.apk` file.
3. Open the downloaded file on your Android device (Android 10 or newer) and tap **Install**.
4. Launch Soundify and start enjoying your favorite music!

---

## Building from Source

### Prerequisites
- **Node.js**: v20 or v22 LTS
- **Java JDK**: 17 or 21
- **Android SDK**: API Level 34+

### Build Steps

```bash
# 1. Clone the repository
git clone https://github.com/farzadzx1234/Soundify-Android.git
cd Soundify-Android

# 2. Install dependencies
npm install

# 3. Build and export web assets
npm run build:export

# 4. Sync with Android project
npx cap sync android

# 5. Assemble APK
cd android
./gradlew assembleDebug
cd ..
```

The compiled APK will be generated at:  
`android/app/build/outputs/apk/debug/app-debug.apk`

---

# 📖 مستندات فارسی

## درباره ساندیفای

**ساندیفای اندروید (Soundify Android)** یک موزیک پلیر مدرن، زیبا و روان برای گوشی‌های اندروید است. این برنامه با رابط کاربری جذاب شیشه‌ای، پخش سریع آنلاین و قابلیت ذخیره‌سازی آفلاین، تجربه لذت‌بخشی از گوش دادن به موسیقی را برای شما فراهم می‌کند. چه آنلاین باشید و چه در حالت پرواز بدون اینترنت، موسیقی مورد علاقه شما همیشه در دسترس است.

---

## ویژگی‌های کلیدی

- 🎧 **پخش آنلاین سریع و روان**: جستجو و پخش بی‌وقفه آهنگ‌ها با کیفیت مطلوب و بارگذاری پرسرعت.
- 💾 **ذخیره و پخش آفلاین**: امکان دانلود آهنگ‌ها روی حافظه گوشی برای گوش دادن در زمان قطعی اینترنت یا مسافرت.
- 📊 **نمایش پیشرفت دانلود**: نمایش درصد دقیق و نوار پیشرفت زنده هنگام دانلود آهنگ تا از روند ذخیره‌سازی مطلع باشید.
- 🎤 **متن همگام ترانه‌ها (لیریکس)**: نمایش خط‌به‌خط و همزمان متن ترانه همگام با صدای خواننده با اسکرول خودکار.
- 📱 **هماهنگی کامل با اندروید**: کنترل کامل موسیقی در نوار اعلان‌ها (Notification)، صفحه قفل، دکمه‌های هندزفری و سیستم صوتی خودرو.
- 🎨 **طراحی مدرن شیشه‌ای**: گرافیک چشم‌نواز با رنگ‌بندی پویا برگرفته از کاور هر آهنگ و جلوه‌های بصری خیره‌کننده.
- 🌐 **پشتیبانی کامل از زبان فارسی**: چیدمان کاملاً راست‌چین و ترجمه دقیق تمام بخش‌های برنامه.

---

## راهنمای نصب

۱. به صفحه [انتشارها (Releases)](https://github.com/farzadzx1234/Soundify-Android/releases) در گیت‌هاب بروید.  
۲. جدیدترین نسخه فایل نصبی با پسوند `app-debug.apk` را دانلود کنید.  
۳. فایل دانلود شده را در گوشی اندروید خود (اندروید ۱۰ به بالا) باز کرده و گزینه نصب (Install) را انتخاب کنید.  
۴. برنامه ساندیفای را اجرا کنید و از شنیدن موسیقی لذت ببرید!

---

## کامپایل از سورس

```bash
# ۱. دریافت سورس کد
git clone https://github.com/farzadzx1234/Soundify-Android.git
cd Soundify-Android

# ۲. نصب وابستگی‌ها
npm install

# ۳. تولید خروجی
npm run build:export

# ۴. همگام‌سازی با پروژه اندروید
npx cap sync android

# ۵. تولید فایل نصبی APK
cd android
./gradlew assembleDebug
cd ..
```

فایل نصبی تولید شده در مسیر زیر قرار می‌گیرد:  
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License

This software is released under the [MIT License](LICENSE).  
Developed by **Farzad Alizadeh** — [@farzadzx1234](https://github.com/farzadzx1234)
