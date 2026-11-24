package com.soundify.app.security;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Debug;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

/**
 * Soundify Mobile Security Integrity Plugin
 *
 * Implements comprehensive native integrity checks:
 * - Root & SU binary detection
 * - Frida & Xposed dynamic hooking artifacts
 * - Debugger attachment & debuggable flags
 * - Emulator & simulated environment heuristics
 */
@CapacitorPlugin(name = "SecurityIntegrity")
public class SecurityIntegrityPlugin extends Plugin {

    private static final String[] SU_PATHS = {
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/data/local/su",
        "/data/local/tmp/su",
        "/data/adb/magisk",
        "/data/adb/ksu",
        "/data/adb/ap",
        "/system/app/Superuser.apk"
    };

    private static final String[] ROOT_PACKAGES = {
        "com.topjohnwu.magisk",
        "eu.chainfire.supersu",
        "com.noshufou.android.su",
        "com.koushikdutta.superuser",
        "com.thirdparty.superuser",
        "me.weishu.kernelsu",
        "me.bmax.apatch",
        "com.koushikdutta.rommanager",
        "com.zachspong.temprootremovejb",
        "com.amphoras.hidemyroot",
        "com.chelpus.luckypatcher"
    };

    @PluginMethod
    public void checkIntegrity(PluginCall call) {
        try {
            Context context = getContext();
            List<String> signals = new ArrayList<>();

            boolean isRooted = detectRoot(context, signals);
            boolean isHooked = detectHooking(signals);
            boolean isDebugger = detectDebugger(context, signals);
            boolean isEmulator = detectEmulator(signals);

            String threatLevel = "SECURE";
            if (isRooted || isHooked) {
                threatLevel = "COMPROMISED";
            } else if (isDebugger || isEmulator) {
                threatLevel = "SUSPICIOUS";
            }

            JSArray signalsArray = new JSArray();
            for (String sig : signals) {
                signalsArray.put(sig);
            }

            JSObject result = new JSObject();
            result.put("threatLevel", threatLevel);
            result.put("isRooted", isRooted);
            result.put("isHooked", isHooked);
            result.put("isDebuggerConnected", isDebugger);
            result.put("isEmulator", isEmulator);
            result.put("detectedSignals", signalsArray);
            result.put("timestamp", System.currentTimeMillis());

            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Security integrity check error: " + ex.getMessage(), ex);
        }
    }

    private boolean detectRoot(Context context, List<String> signals) {
        boolean rooted = false;

        // 1. Check for SU binaries
        for (String path : SU_PATHS) {
            try {
                File file = new File(path);
                if (file.exists()) {
                    signals.add("SU_BINARY_DETECTED:" + path);
                    rooted = true;
                    break;
                }
            } catch (Exception ignored) {}
        }

        // 2. Check for Test Keys in Build tags
        String buildTags = Build.TAGS;
        if (buildTags != null && buildTags.contains("test-keys")) {
            signals.add("BUILD_TAGS_TEST_KEYS");
            rooted = true;
        }

        // 3. Check for Root Management Packages
        if (context != null) {
            PackageManager pm = context.getPackageManager();
            for (String pkg : ROOT_PACKAGES) {
                try {
                    pm.getPackageInfo(pkg, 0);
                    signals.add("ROOT_PACKAGE_FOUND:" + pkg);
                    rooted = true;
                    break;
                } catch (PackageManager.NameNotFoundException ignored) {}
            }
        }

        // 4. Check for su binary accessible in PATH via runtime exec
        if (!rooted && checkSuExecutable()) {
            signals.add("SU_EXECUTABLE_VIA_PATH");
            rooted = true;
        }

        return rooted;
    }

    private boolean checkSuExecutable() {
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(new String[]{"which", "su"});
            BufferedReader in = new BufferedReader(new java.io.InputStreamReader(process.getInputStream()));
            return in.readLine() != null;
        } catch (Throwable ignored) {
            return false;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private boolean detectHooking(List<String> signals) {
        boolean hooked = false;

        // 1. Check memory maps for Frida / Xposed shared libraries
        try {
            File maps = new File("/proc/self/maps");
            if (maps.exists() && maps.canRead()) {
                BufferedReader reader = new BufferedReader(new FileReader(maps));
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.toLowerCase();
                    if (line.contains("frida-agent") || line.contains("frida-gadget") || line.contains("gadget.so")) {
                        signals.add("FRIDA_ARTIFACT_IN_MEMORY");
                        hooked = true;
                        break;
                    }
                    if (line.contains("xposed") || line.contains("substrate")) {
                        signals.add("XPOSED_ARTIFACT_IN_MEMORY");
                        hooked = true;
                        break;
                    }
                }
                reader.close();
            }
        } catch (Exception ignored) {}

        // 2. Check for Xposed Bridge classes
        try {
            Class.forName("de.robv.android.xposed.XposedBridge");
            signals.add("XPOSED_BRIDGE_CLASS_FOUND");
            hooked = true;
        } catch (ClassNotFoundException ignored) {}

        // 3. Check for standard Frida socket listener (port 27042)
        try {
            Socket socket = new Socket();
            socket.connect(new InetSocketAddress("127.0.0.1", 27042), 40);
            socket.close();
            signals.add("FRIDA_SERVER_PORT_OPEN");
            hooked = true;
        } catch (Exception ignored) {}

        return hooked;
    }

    private boolean detectDebugger(Context context, List<String> signals) {
        boolean debugged = false;
        if (Debug.isDebuggerConnected()) {
            signals.add("DEBUGGER_ATTACHED");
            debugged = true;
        }
        if (context != null) {
            ApplicationInfo appInfo = context.getApplicationInfo();
            if ((appInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                signals.add("APPLICATION_DEBUGGABLE_FLAG");
            }
        }
        return debugged;
    }

    private boolean detectEmulator(List<String> signals) {
        boolean emulator = false;
        String fingerprint = Build.FINGERPRINT != null ? Build.FINGERPRINT.toLowerCase() : "";
        String model = Build.MODEL != null ? Build.MODEL.toLowerCase() : "";
        String hardware = Build.HARDWARE != null ? Build.HARDWARE.toLowerCase() : "";
        String product = Build.PRODUCT != null ? Build.PRODUCT.toLowerCase() : "";

        if (fingerprint.startsWith("generic") || fingerprint.startsWith("unknown")) {
            signals.add("EMULATOR_FINGERPRINT:" + fingerprint);
            emulator = true;
        }
        if (hardware.contains("goldfish") || hardware.contains("ranchu")) {
            signals.add("EMULATOR_HARDWARE:" + hardware);
            emulator = true;
        }
        if (model.contains("google_sdk") || model.contains("emulator") || model.contains("android sdk built for x86")) {
            signals.add("EMULATOR_MODEL:" + model);
            emulator = true;
        }
        if (product.contains("sdk") || product.contains("google_sdk") || product.contains("sdk_x86")) {
            signals.add("EMULATOR_PRODUCT:" + product);
            emulator = true;
        }

        return emulator;
    }
}
