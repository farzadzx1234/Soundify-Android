package com.soundify.app.media;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Capacitor Plugin allowing Soundify to save, discover, index, and read audio + artwork files
 * in both Android's public Music/Soundify directory (MediaStore) and app-private soundify_offline storage
 * so downloaded tracks stay 100% playable offline across upgrades/reinstalls without re-downloading.
 */
@CapacitorPlugin(name = "MediaStorePlugin")
public class MediaStorePlugin extends Plugin {

    private static File getPrivateOfflineDir(Context context) {
        File dir = new File(context.getFilesDir(), "soundify_offline");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private static String sanitizeIdForFile(String trackId) {
        if (trackId == null || trackId.trim().isEmpty()) {
            return "track_" + System.currentTimeMillis();
        }
        return trackId.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static boolean isSupportedAudioFileName(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.US);
        return lower.endsWith(".mp3")
            || lower.endsWith(".m4a")
            || lower.endsWith(".aac")
            || lower.endsWith(".ogg")
            || lower.endsWith(".opus")
            || lower.endsWith(".wav")
            || lower.endsWith(".flac");
    }

    private static byte[] readAllBytesLimited(File file, int maxBytes) {
        if (file == null || !file.exists() || !file.isFile() || file.length() <= 0 || file.length() > maxBytes) {
            return null;
        }
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            int total = 0;
            while ((n = fis.read(buf)) > 0) {
                total += n;
                if (total > maxBytes) return null;
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } catch (Exception ignored) {
            return null;
        }
    }

    @PluginMethod
    public void saveAudioToDevice(PluginCall call) {
        String base64Data = call.getString("base64");
        String fileName = call.getString("fileName");
        String trackId = call.getString("trackId", "");
        String coverBase64 = call.getString("coverBase64", "");
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
        if (!fileName.toLowerCase(Locale.US).endsWith(".mp3")) {
            fileName += ".mp3";
        }

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

        // Always persist a permanent app-private copy + cover + metadata (immune to WebView DB clears & scoped permissions)
        String privateUriStr = "";
        String coverPathStr = "";
        if (trackId != null && !trackId.trim().isEmpty()) {
            try {
                File privateDir = getPrivateOfflineDir(context);
                String safeId = sanitizeIdForFile(trackId);
                File privateMp3 = new File(privateDir, safeId + ".mp3");
                if (!privateMp3.exists() || privateMp3.length() == 0L) {
                    try (FileOutputStream fos = new FileOutputStream(privateMp3)) {
                        fos.write(audioBytes);
                        fos.flush();
                    }
                }
                privateUriStr = Uri.fromFile(privateMp3).toString();

                if (coverBase64 != null && !coverBase64.trim().isEmpty()) {
                    String cleanCoverB64 = coverBase64.contains(",")
                        ? coverBase64.substring(coverBase64.indexOf(",") + 1)
                        : coverBase64;
                    byte[] coverBytes = Base64.decode(cleanCoverB64, Base64.DEFAULT);
                    if (coverBytes != null && coverBytes.length > 0) {
                        File privateCover = new File(privateDir, safeId + ".jpg");
                        try (FileOutputStream cfos = new FileOutputStream(privateCover)) {
                            cfos.write(coverBytes);
                            cfos.flush();
                        }
                        coverPathStr = Uri.fromFile(privateCover).toString();
                    }
                }

                File metaFile = new File(privateDir, safeId + ".meta.json");
                JSONObject metaJson = new JSONObject();
                metaJson.put("trackId", trackId);
                metaJson.put("fileName", fileName);
                metaJson.put("title", title != null ? title : "");
                metaJson.put("artist", artist != null ? artist : "");
                metaJson.put("sizeBytes", audioBytes.length);
                try (FileOutputStream mfos = new FileOutputStream(metaFile)) {
                    mfos.write(metaJson.toString().getBytes(StandardCharsets.UTF_8));
                    mfos.flush();
                }
            } catch (Exception ignored) {}
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Uri collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                File publicFile = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                    "Soundify" + File.separator + fileName
                );

                // Prevent duplicate entries in Music/Soundify if track was already saved
                boolean alreadySaved = false;
                Uri existingPublicUri = null;
                try (Cursor cursor = resolver.query(
                    collection,
                    new String[]{MediaStore.Audio.Media._ID, MediaStore.Audio.Media.SIZE},
                    MediaStore.Audio.Media.DISPLAY_NAME + " = ? AND " + MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ?",
                    new String[]{fileName, "%Soundify%"},
                    null
                )) {
                    if (cursor != null && cursor.moveToFirst()) {
                        long id = cursor.getLong(0);
                        int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                        long existingSize = sizeCol >= 0 ? cursor.getLong(sizeCol) : 1L;
                        if (existingSize > 0) {
                            alreadySaved = true;
                            existingPublicUri = ContentUris.withAppendedId(collection, id);
                        }
                    }
                } catch (Exception ignored) {}

                if (alreadySaved) {
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("alreadyExists", true);
                    if (existingPublicUri != null) {
                        ret.put("uri", existingPublicUri.toString());
                    }
                    if (!privateUriStr.isEmpty()) ret.put("privateUri", privateUriStr);
                    if (!coverPathStr.isEmpty()) ret.put("coverPath", coverPathStr);
                    ret.put("path", publicFile.getAbsolutePath());
                    call.resolve(ret);
                    return;
                }

                ContentValues values = new ContentValues();
                values.put(MediaStore.Audio.Media.DISPLAY_NAME, fileName);
                values.put(MediaStore.Audio.Media.TITLE, title);
                values.put(MediaStore.Audio.Media.ARTIST, artist);
                values.put(MediaStore.Audio.Media.ALBUM, album);
                values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType);
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Soundify");
                values.put(MediaStore.Audio.Media.IS_PENDING, 1);

                Uri itemUri = resolver.insert(collection, values);

                if (itemUri == null) {
                    if (!privateUriStr.isEmpty()) {
                        JSObject fallbackRet = new JSObject();
                        fallbackRet.put("success", true);
                        fallbackRet.put("alreadyExists", false);
                        fallbackRet.put("uri", privateUriStr);
                        fallbackRet.put("privateUri", privateUriStr);
                        if (!coverPathStr.isEmpty()) fallbackRet.put("coverPath", coverPathStr);
                        fallbackRet.put("path", privateUriStr);
                        call.resolve(fallbackRet);
                        return;
                    }
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

                MediaScannerConnection.scanFile(
                    context,
                    new String[]{publicFile.getAbsolutePath()},
                    new String[]{mimeType},
                    null
                );

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("alreadyExists", false);
                ret.put("uri", itemUri.toString());
                if (!privateUriStr.isEmpty()) ret.put("privateUri", privateUriStr);
                if (!coverPathStr.isEmpty()) ret.put("coverPath", coverPathStr);
                ret.put("path", publicFile.getAbsolutePath());
                call.resolve(ret);
            } else {
                File musicDir = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                    "Soundify"
                );
                if (!musicDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    musicDir.mkdirs();
                }
                File outFile = new File(musicDir, fileName);
                boolean already = outFile.exists() && outFile.length() > 0;
                if (!already) {
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(audioBytes);
                        fos.flush();
                    }
                }

                MediaScannerConnection.scanFile(
                    context,
                    new String[]{outFile.getAbsolutePath()},
                    new String[]{mimeType},
                    null
                );

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("alreadyExists", already);
                ret.put("uri", Uri.fromFile(outFile).toString());
                if (!privateUriStr.isEmpty()) ret.put("privateUri", privateUriStr);
                if (!coverPathStr.isEmpty()) ret.put("coverPath", coverPathStr);
                ret.put("path", outFile.getAbsolutePath());
                call.resolve(ret);
            }
        } catch (Exception e) {
            if (!privateUriStr.isEmpty()) {
                JSObject fallbackRet = new JSObject();
                fallbackRet.put("success", true);
                fallbackRet.put("alreadyExists", false);
                fallbackRet.put("uri", privateUriStr);
                fallbackRet.put("privateUri", privateUriStr);
                if (!coverPathStr.isEmpty()) fallbackRet.put("coverPath", coverPathStr);
                fallbackRet.put("path", privateUriStr);
                call.resolve(fallbackRet);
                return;
            }
            call.reject("Failed to save audio to device storage: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void listDeviceSoundifyAudio(PluginCall call) {
        JSArray filesArray = new JSArray();
        Set<String> seenFileNames = new HashSet<>();
        Set<String> seenTrackIds = new HashSet<>();
        Context context = getContext();

        // 1. Scan permanent app-private soundify_offline directory first (highest priority, zero permission issues)
        try {
            File privateDir = getPrivateOfflineDir(context);
            File[] children = privateDir.listFiles();
            if (children != null) {
                for (File f : children) {
                    if (!f.isFile() || !isSupportedAudioFileName(f.getName()) || f.length() <= 1024L) {
                        continue;
                    }
                    String baseName = f.getName().replaceFirst("\\.[^.]+$", "");
                    File metaFile = new File(privateDir, baseName + ".meta.json");
                    File coverFile = new File(privateDir, baseName + ".jpg");

                    String trackId = baseName;
                    String fileName = f.getName();
                    String title = baseName;
                    String artist = "";

                    byte[] metaBytes = readAllBytesLimited(metaFile, 64 * 1024);
                    if (metaBytes != null) {
                        try {
                            JSONObject meta = new JSONObject(new String(metaBytes, StandardCharsets.UTF_8));
                            if (meta.has("trackId") && !meta.optString("trackId").isEmpty()) {
                                trackId = meta.optString("trackId");
                            }
                            if (meta.has("fileName") && !meta.optString("fileName").isEmpty()) {
                                fileName = meta.optString("fileName");
                            }
                            if (meta.has("title") && !meta.optString("title").isEmpty()) {
                                title = meta.optString("title");
                            }
                            if (meta.has("artist") && !meta.optString("artist").isEmpty()) {
                                artist = meta.optString("artist");
                            }
                        } catch (Exception ignored) {}
                    }

                    JSObject item = new JSObject();
                    item.put("uri", Uri.fromFile(f).toString());
                    item.put("trackId", trackId);
                    item.put("fileName", fileName);
                    item.put("title", title);
                    item.put("artist", artist);
                    item.put("sizeBytes", f.length());
                    item.put("source", "private");
                    if (coverFile.exists() && coverFile.length() > 0L) {
                        item.put("coverUri", Uri.fromFile(coverFile).toString());
                    }
                    filesArray.put(item);
                    seenFileNames.add(fileName.toLowerCase(Locale.US));
                    seenTrackIds.add(trackId);
                }
            }
        } catch (Exception ignored) {}

        // 2. Scan public MediaStore Music/Soundify directory (includes songs from earlier installs!)
        try {
            ContentResolver resolver = context.getContentResolver();
            Uri collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

            String selection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ? AND " + MediaStore.Audio.Media.SIZE + " > 1024"
                : MediaStore.Audio.Media.DATA + " LIKE ? AND " + MediaStore.Audio.Media.SIZE + " > 1024";
            String[] selectionArgs = new String[]{
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? "%Soundify%" : "%/Soundify/%"
            };
            String[] projection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new String[]{
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.SIZE
                }
                : new String[]{
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.SIZE
                };

            try (Cursor cursor = resolver.query(collection, projection, selection, selectionArgs, null)) {
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(0);
                        String displayName = cursor.getString(1);
                        String title = cursor.getString(2);
                        String artist = cursor.getString(3);
                        long durationMs = cursor.getLong(4);
                        long sizeBytes = cursor.getLong(5);

                        if (displayName == null || !isSupportedAudioFileName(displayName)) {
                            continue;
                        }
                        if (seenFileNames.contains(displayName.toLowerCase(Locale.US))) {
                            continue;
                        }

                        Uri contentUri = ContentUris.withAppendedId(collection, id);
                        JSObject item = new JSObject();
                        item.put("uri", contentUri.toString());
                        item.put("fileName", displayName);
                        item.put("title", title != null ? title : "");
                        item.put("artist", (artist != null && !"<unknown>".equalsIgnoreCase(artist)) ? artist : "");
                        if (durationMs > 0L) {
                            item.put("durationSec", Math.round(durationMs / 1000.0));
                        }
                        item.put("sizeBytes", sizeBytes);
                        item.put("source", "mediastore");
                        filesArray.put(item);
                        seenFileNames.add(displayName.toLowerCase(Locale.US));
                    }
                }
            }
        } catch (Exception ignored) {}

        // 3. Direct filesystem fallback for Music/Soundify if accessible directly
        try {
            File musicSoundifyDir = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                "Soundify"
            );
            if (musicSoundifyDir.exists() && musicSoundifyDir.isDirectory()) {
                File[] publicFiles = musicSoundifyDir.listFiles();
                if (publicFiles != null) {
                    for (File pf : publicFiles) {
                        if (!pf.isFile() || !isSupportedAudioFileName(pf.getName()) || pf.length() <= 1024L) {
                            continue;
                        }
                        String key = pf.getName().toLowerCase(Locale.US);
                        if (seenFileNames.contains(key)) continue;
                        seenFileNames.add(key);

                        JSObject item = new JSObject();
                        item.put("uri", Uri.fromFile(pf).toString());
                        item.put("fileName", pf.getName());
                        item.put("title", "");
                        item.put("artist", "");
                        item.put("sizeBytes", pf.length());
                        item.put("source", "filesystem");
                        filesArray.put(item);
                    }
                }
            }
        } catch (Exception ignored) {}

        JSObject ret = new JSObject();
        ret.put("files", filesArray);
        call.resolve(ret);
    }

    @PluginMethod
    public void getLocalCoverDataUrl(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String audioUri = call.getString("audioUri", "");
        Context context = getContext();

        try {
            if (trackId != null && !trackId.trim().isEmpty()) {
                File coverFile = new File(getPrivateOfflineDir(context), sanitizeIdForFile(trackId) + ".jpg");
                byte[] coverBytes = readAllBytesLimited(coverFile, 2 * 1024 * 1024);
                if (coverBytes != null && coverBytes.length > 0) {
                    JSObject ret = new JSObject();
                    ret.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(coverBytes, Base64.NO_WRAP));
                    call.resolve(ret);
                    return;
                }
            }

            if (audioUri != null && !audioUri.trim().isEmpty()) {
                MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                try {
                    if (audioUri.startsWith("content://")) {
                        retriever.setDataSource(context, Uri.parse(audioUri));
                    } else if (audioUri.startsWith("file://")) {
                        retriever.setDataSource(Uri.parse(audioUri).getPath());
                    } else {
                        retriever.setDataSource(audioUri);
                    }
                    byte[] art = retriever.getEmbeddedPicture();
                    if (art != null && art.length > 0 && art.length <= 2 * 1024 * 1024) {
                        JSObject ret = new JSObject();
                        ret.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(art, Base64.NO_WRAP));
                        call.resolve(ret);
                        return;
                    }
                } finally {
                    try {
                        retriever.release();
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}

        JSObject empty = new JSObject();
        empty.put("dataUrl", JSONObject.NULL);
        call.resolve(empty);
    }

    @PluginMethod
    public void saveLocalCover(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String coverBase64 = call.getString("coverBase64", "");
        if (trackId == null || trackId.trim().isEmpty() || coverBase64 == null || coverBase64.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            call.resolve(ret);
            return;
        }
        try {
            String cleanB64 = coverBase64.contains(",")
                ? coverBase64.substring(coverBase64.indexOf(",") + 1)
                : coverBase64;
            byte[] coverBytes = Base64.decode(cleanB64, Base64.DEFAULT);
            if (coverBytes == null || coverBytes.length == 0 || coverBytes.length > 2 * 1024 * 1024) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                call.resolve(ret);
                return;
            }
            File privateDir = getPrivateOfflineDir(getContext());
            String safeId = sanitizeIdForFile(trackId);
            File privateCover = new File(privateDir, safeId + ".jpg");
            try (FileOutputStream cfos = new FileOutputStream(privateCover)) {
                cfos.write(coverBytes);
                cfos.flush();
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("coverUri", Uri.fromFile(privateCover).toString());
            call.resolve(ret);
        } catch (Exception ignored) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void saveLocalLyrics(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String lyricsJson = call.getString("lyricsJson", "");
        if (trackId == null || trackId.trim().isEmpty() || lyricsJson == null || lyricsJson.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            call.resolve(ret);
            return;
        }
        try {
            File privateDir = getPrivateOfflineDir(getContext());
            String safeId = sanitizeIdForFile(trackId);
            File lrcFile = new File(privateDir, safeId + ".lrc.json");
            try (FileOutputStream fos = new FileOutputStream(lrcFile)) {
                fos.write(lyricsJson.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception ignored) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void getLocalLyrics(PluginCall call) {
        String trackId = call.getString("trackId", "");
        JSObject ret = new JSObject();
        try {
            if (trackId != null && !trackId.trim().isEmpty()) {
                File lrcFile = new File(getPrivateOfflineDir(getContext()), sanitizeIdForFile(trackId) + ".lrc.json");
                byte[] bytes = readAllBytesLimited(lrcFile, 512 * 1024);
                if (bytes != null && bytes.length > 0) {
                    ret.put("lyricsJson", new String(bytes, StandardCharsets.UTF_8));
                    call.resolve(ret);
                    return;
                }
            }
        } catch (Exception ignored) {}
        ret.put("lyricsJson", JSONObject.NULL);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteOfflineFiles(PluginCall call) {
        String trackId = call.getString("trackId", "");
        Context context = getContext();
        try {
            if (trackId != null && !trackId.trim().isEmpty()) {
                File dir = getPrivateOfflineDir(context);
                String safeId = sanitizeIdForFile(trackId);
                for (String ext : new String[]{".mp3", ".jpg", ".meta.json", ".lrc.json"}) {
                    File f = new File(dir, safeId + ext);
                    if (f.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
        } catch (Exception ignored) {}
        call.resolve();
    }
}
