# Soundify Android R8 / ProGuard Configuration
# Hardens the compiled application against reverse engineering, decompilation, and tampering.

# ---------------------------------------------------------------------------
# 1. Code Optimization & Symbol Stripping
# ---------------------------------------------------------------------------
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Strip debugging line numbers and source file names
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable

# Strip sensitive and verbose logging calls from release binaries
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int println(...);
}

-assumenosideeffects class java.io.PrintStream {
    public void println(java.lang.String);
    public void print(java.lang.String);
}

# ---------------------------------------------------------------------------
# 2. Capacitor & WebView JavaScript Interface Protection
# ---------------------------------------------------------------------------
# Preserve JavascriptInterface methods so WebView bridge works securely
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Capacitor core, bridge, and reflection classes
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keep class * extends com.getcapacitor.BridgeActivity { *; }

# Preserve Soundify application and security plugins
-keep class com.soundify.app.** { *; }
-keep class com.soundify.app.security.** { *; }

# Preserve essential Java/Kotlin metadata for serialization and reflection
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Suppress harmless warnings for optional packages
-dontwarn com.google.android.gms.**
-dontwarn org.apache.commons.**
-dontwarn androidx.**
