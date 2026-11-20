package com.soundify.app.media;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Capacitor Plugin allowing Soundify to save/export audio tracks directly to
 * the Android public Music directory (MediaStore) so native system music players
 * (Samsung Music, Mi Music, VLC, Google Files, etc.) discover and play them.
 */
@CapacitorPlugin(name = "MediaStorePlugin")
public class MediaStorePlugin extends Plugin {

    @PluginMethod
    public void saveAudioToDevice(PluginCall call) {
        String base64Data = call.getString("base64");
        String fileName = call.getString("fileName");
        String title = call.getString("title", "Unknown Title");
        String artist = call.getString("artist", "Unknown Artist");
        String album = call.getString("album", "Soundify");
        String mimeType = call.getString("mimeType", "audio/mpeg");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("Audio data (base64) is required");
            return;
        }

        if (fileName == null || fileName.isEmpty()) {
            fileName = "Soundify_" + System.currentTimeMillis() + ".mp3";
        }

        // Clean fileName to remove illegal characters
        fileName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (!fileName.toLowerCase().endsWith(".mp3")) {
            fileName += ".mp3";
        }

        // Strip data URI scheme prefix if present
        if (base64Data.contains(",")) {
            base64Data = base64Data.substring(base64Data.indexOf(",") + 1);
        }

        byte[] audioBytes;
        try {
            audioBytes = Base64.decode(base64Data, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("Failed to decode base64 audio data: " + e.getMessage());
            return;
        }

        Context context = getContext();
        ContentResolver resolver = context.getContentResolver();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Modern Android 10+ (API 29+) Scoped Storage MediaStore insertion
                ContentValues values = new ContentValues();
                values.put(MediaStore.Audio.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Audio.Media.TITLE, title);
                values.put(MediaStore.Audio.Media.ARTIST, artist);
                values.put(MediaStore.Audio.Media.ALBUM, album);
                values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType);
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Soundify");
                values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                Uri collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri itemUri = resolver.insert(collection, values);

                if (itemUri == null) {
                    call.reject("Failed to create MediaStore audio entry");
                    return;
                }

                try (OutputStream os = resolver.openOutputStream(itemUri)) {
                    if (os == null) {
                        call.reject("Failed to open output stream for MediaStore entry");
                        return;
                    }
                    os.write(audioBytes);
                    os.flush();
                }

                values.clear();
                values.put(MediaStore.Audio.Media.IS_PENDING, 0);
                resolver.update(itemUri, values, null, null);

                // Force MediaScanner indexing
                MediaScannerConnection.scanFile(
                    context,
                    new String[]{Environment.DIRECTORY_MUSIC + "/Soundify/" + fileName},
                    new String[]{mimeType},
                    null
                );

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("uri", itemUri.toString());
                ret.put("path", Environment.DIRECTORY_MUSIC + "/Soundify/" + fileName);
                call.resolve(ret);
            } else {
                // Legacy Android (< API 29) external music storage fallback
                File musicDir = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                    "Soundify"
                );
                if (!musicDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    musicDir.mkdirs();
                }
                File outFile = new File(musicDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(audioBytes);
                    fos.flush();
                }

                MediaScannerConnection.scanFile(
                    context,
                    new String[]{outFile.getAbsolutePath()},
                    new String[]{mimeType},
                    null
                );

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("path", outFile.getAbsolutePath());
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Failed to save audio to device storage: " + e.getMessage(), e);
        }
    }
}
