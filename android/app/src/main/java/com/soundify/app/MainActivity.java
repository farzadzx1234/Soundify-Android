package com.soundify.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.ServiceWorkerController;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.soundify.app.media.MediaSessionPlugin;
import com.soundify.app.media.MediaStorePlugin;
import com.soundify.app.security.SecurityIntegrityPlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private static void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        try {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
        } catch (Exception ignored) {
            // Best-effort cleanup
        }
    }

    private static final String[] STALE_WEBVIEW_CACHE_DIRS = new String[]{
        "Service Worker",
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "Shared Dictionary"
    };

    private static void purgeProfileCacheDirs(File profileDir) {
        if (profileDir == null || !profileDir.isDirectory()) return;
        for (String name : STALE_WEBVIEW_CACHE_DIRS) {
            deleteRecursively(new File(profileDir, name));
        }
    }

    /**
     * Purges stale Chromium WebView Service Worker registrations, CacheStorage, and HTTP/Code caches
     * BEFORE super.onCreate() initializes WebView and loads https://localhost/.
     *
     * Dynamically scans all WebView profile subdirectories under app_webview/ (supporting OEM forks
     * like MIUI/HyperOS) while strictly preserving Local Storage, IndexedDB (downloaded offline tracks),
     * Cookies, Session Storage, Web Data, and SharedPreferences so users never lose login state or
     * offline downloads across APK updates.
     */
    private boolean purgeStaleWebViewCachesBeforeInit() {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            long currentVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pInfo.getLongVersionCode()
                : pInfo.versionCode;
            SharedPreferences metaPrefs = getSharedPreferences("soundify_app_meta", MODE_PRIVATE);
            long lastVersionCode = metaPrefs.getLong("last_version_code", -1L);
            if (lastVersionCode == currentVersionCode) {
                return false;
            }

            String dataDir = getApplicationInfo().dataDir;
            if (dataDir != null && !dataDir.isEmpty()) {
                File base = new File(dataDir);
                // Explicit canonical paths
                deleteRecursively(new File(base, "app_webview/Default/Service Worker"));
                deleteRecursively(new File(base, "app_webview/Service Worker"));
                deleteRecursively(new File(base, "app_webview/Default/Cache"));
                deleteRecursively(new File(base, "app_webview/Default/Code Cache"));
                deleteRecursively(new File(base, "app_webview/Default/GPUCache"));
                deleteRecursively(new File(base, "app_webview/Cache"));

                // Also scan any non-Default WebView profile directories (OEM/MIUI/HyperOS safety)
                File appWebViewDir = new File(base, "app_webview");
                if (appWebViewDir.isDirectory()) {
                    purgeProfileCacheDirs(appWebViewDir);
                    File[] children = appWebViewDir.listFiles();
                    if (children != null) {
                        for (File child : children) {
                            if (child.isDirectory()) {
                                String name = child.getName();
                                if (!"Local Storage".equals(name)
                                    && !"IndexedDB".equals(name)
                                    && !"Session Storage".equals(name)
                                    && !"databases".equals(name)) {
                                    purgeProfileCacheDirs(child);
                                }
                            }
                        }
                    }
                }
            }

            File cacheDir = getCacheDir();
            if (cacheDir != null) {
                deleteRecursively(new File(cacheDir, "WebView"));
                deleteRecursively(new File(cacheDir, "org.chromium.android_webview"));
            }

            metaPrefs.edit().putLong("last_version_code", currentVersionCode).commit();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate() so Chromium WebView never boots a stale Service Worker from an older APK
        boolean purgedOnUpgrade = purgeStaleWebViewCachesBeforeInit();

        // Register native plugins
        registerPlugin(SecurityIntegrityPlugin.class);
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(MediaStorePlugin.class);

        super.onCreate(savedInstanceState);

        // Request POST_NOTIFICATIONS runtime permission on Android 13+ (API 33+)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1001);
            }
        }

        // Enable Hardware Acceleration and request highest available refresh rate (90Hz / 120Hz)
        try {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            );
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Display display = getDisplay();
                if (display != null) {
                    Display.Mode[] modes = display.getSupportedModes();
                    Display.Mode bestMode = null;
                    float maxRate = 60.0f;
                    for (Display.Mode mode : modes) {
                        if (mode.getRefreshRate() > maxRate) {
                            maxRate = mode.getRefreshRate();
                            bestMode = mode;
                        }
                    }
                    if (bestMode != null) {
                        WindowManager.LayoutParams lp = getWindow().getAttributes();
                        lp.preferredDisplayModeId = bestMode.getModeId();
                        getWindow().setAttributes(lp);
                    }
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Display display = getWindowManager().getDefaultDisplay();
                if (display != null) {
                    Display.Mode[] modes = display.getSupportedModes();
                    Display.Mode bestMode = null;
                    float maxRate = 60.0f;
                    for (Display.Mode mode : modes) {
                        if (mode.getRefreshRate() > maxRate) {
                            maxRate = mode.getRefreshRate();
                            bestMode = mode;
                        }
                    }
                    if (bestMode != null) {
                        WindowManager.LayoutParams lp = getWindow().getAttributes();
                        lp.preferredDisplayModeId = bestMode.getModeId();
                        getWindow().setAttributes(lp);
                    }
                }
            }
        } catch (Exception ignored) {
            // Non-fatal
        }

        // Dispatch exact Android System Navigation Bar and Status Bar insets to WebView CSS variables (--sab, --sat)
        try {
            ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
                Insets systemBars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                float density = getResources().getDisplayMetrics().density;
                int bottomDp = density > 0 ? Math.round(systemBars.bottom / density) : 0;
                int topDp = density > 0 ? Math.round(systemBars.top / density) : 0;
                int safeBottom = Math.max(bottomDp, 0);

                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null) {
                    String script = String.format(
                        "document.documentElement.style.setProperty('--sab', '%dpx');" +
                        "document.documentElement.style.setProperty('--sat', '%dpx');",
                        safeBottom, topDp
                    );
                    wv.post(() -> wv.evaluateJavascript(script, null));
                }
                return insets;
            });
        } catch (Exception ignored) {
            // Non-fatal
        }

        // Harden the Capacitor WebView and enable uninterrupted media playback
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    // Prevent any surviving Service Worker on OEM WebView forks from serving cached /sw.js
                    ServiceWorkerController.getInstance()
                        .getServiceWorkerWebSettings()
                        .setCacheMode(WebSettings.LOAD_NO_CACHE);
                } catch (Exception ignored) {
                    // Best-effort SW cache bypass
                }
            }

            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                if (purgedOnUpgrade) {
                    try {
                        webView.clearCache(true);
                    } catch (Exception ignored) {
                        // Non-blocking cache invalidation
                    }
                }

                webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);
                WebSettings settings = webView.getSettings();
                settings.setOffscreenPreRaster(true);
                // Allow background autoplay between queue transitions without user gesture
                settings.setMediaPlaybackRequiresUserGesture(false);
                // Disable direct file access and content scheme access (OWASP MASVS / MSTG-PLATFORM-05)
                settings.setAllowFileAccess(false);
                settings.setAllowContentAccess(false);
                settings.setAllowFileAccessFromFileURLs(false);
                settings.setAllowUniversalAccessFromFileURLs(false);
                // Disable form/password persistence in webview
                settings.setSavePassword(false);
                settings.setGeolocationEnabled(false);
                // Allow mixed HTTP/HTTPS content so local LAN Wi-Fi testing (e.g. http://192.168.x.x:4100) works seamlessly from https://localhost
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                // Strip legacy/vulnerable JavaScript interfaces if present
                webView.removeJavascriptInterface("searchBoxJavaBridge_");
                webView.removeJavascriptInterface("accessibility");
                webView.removeJavascriptInterface("accessibilityTraversal");
            }
        } catch (Exception ignored) {
            // Safe fallback
        }
    }
}
