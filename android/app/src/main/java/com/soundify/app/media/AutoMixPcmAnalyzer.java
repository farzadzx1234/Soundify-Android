package com.soundify.app.media;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Build;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Native Android Background PCM Decoder & Stage 1-2 Acoustic AutoMix Planner.
 * Decodes up to 35s outro of Track A and up to 35s intro of Track B using hardware MediaExtractor + MediaCodec,
 * extracts BPM / Downbeats / 4-or-8-bar Phrases / 300Hz-3.5kHz Formant+HPR VAD / Camelot Key / LUFS,
 * and solves an exact sample-indexed AutoMixPlan without blocking playback.
 */
public final class AutoMixPcmAnalyzer {

    private static final double SEGMENT_WINDOW_SEC = 35.0;
    private static final double ONSET_HOP_SEC = 0.01;
    private static final double VAD_HOP_SEC = 0.05;
    private static final double SILENCE_MINUS_50_DBFS = 0.00316227766;
    private static final long DECODE_TIMEOUT_MS = 6500L;

    private static final double[] KS_MAJOR = {6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88};
    private static final double[] KS_MINOR = {6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17};
    private static final int[] MAJOR_CAMELOT = {8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1};
    private static final int[] MINOR_CAMELOT = {5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10};
    private static final double[] VOCAL_FREQS = {330, 470, 670, 950, 1340, 1890, 2650, 3380};

    public static final class AutoMixPlanNative {
        public final String mode; // "BEAT_SYNC_PHRASE" or "SILENCE_TRIMMED_FADE"
        public final String trackAId;
        public final String trackBId;
        public final int sampleRate;
        public final long startSampleOnTrackA;
        public final long startOffsetSampleOnTrackB;
        public final long durationSamples;
        public final float initialTempoRatioB;
        public final float targetTempoRatioA;
        public final double tempoLockCompleteProgress;
        public final double bassSwapProgress;
        public final double gainCompensationDbB;

        public AutoMixPlanNative(
            String mode,
            String trackAId,
            String trackBId,
            int sampleRate,
            long startSampleOnTrackA,
            long startOffsetSampleOnTrackB,
            long durationSamples,
            float initialTempoRatioB,
            float targetTempoRatioA,
            double tempoLockCompleteProgress,
            double bassSwapProgress,
            double gainCompensationDbB
        ) {
            this.mode = mode;
            this.trackAId = trackAId;
            this.trackBId = trackBId;
            this.sampleRate = sampleRate;
            this.startSampleOnTrackA = startSampleOnTrackA;
            this.startOffsetSampleOnTrackB = startOffsetSampleOnTrackB;
            this.durationSamples = durationSamples;
            this.initialTempoRatioB = initialTempoRatioB;
            this.targetTempoRatioA = targetTempoRatioA;
            this.tempoLockCompleteProgress = tempoLockCompleteProgress;
            this.bassSwapProgress = bassSwapProgress;
            this.gainCompensationDbB = gainCompensationDbB;
        }
    }

    private static final class DecodedSegment {
        final float[] pcm;
        final int sampleRate;
        final double segmentStartSec;

        DecodedSegment(float[] pcm, int sampleRate, double segmentStartSec) {
            this.pcm = pcm;
            this.sampleRate = sampleRate;
            this.segmentStartSec = segmentStartSec;
        }
    }

    private static final class SegmentStats {
        final double bpm;
        final List<Double> beatsSec;
        final List<Double> downbeatsSec;
        final List<Double> phraseBoundariesSec;
        final double tVocalEndSec;
        final double tVocalStartSec;
        final double firstAudibleSec;
        final double effectiveEndSec;
        final double segmentStartSec;
        final int camelotNum;
        final char camelotLetter;
        final double lufs;
        final double[][] spectralFrames;
        final double[] frameRms;
        final double[] vadProb;

        SegmentStats(
            double bpm,
            List<Double> beatsSec,
            List<Double> downbeatsSec,
            List<Double> phraseBoundariesSec,
            double tVocalEndSec,
            double tVocalStartSec,
            double firstAudibleSec,
            double effectiveEndSec,
            double segmentStartSec,
            int camelotNum,
            char camelotLetter,
            double lufs,
            double[][] spectralFrames,
            double[] frameRms,
            double[] vadProb
        ) {
            this.bpm = bpm;
            this.beatsSec = beatsSec;
            this.downbeatsSec = downbeatsSec;
            this.phraseBoundariesSec = phraseBoundariesSec;
            this.tVocalEndSec = tVocalEndSec;
            this.tVocalStartSec = tVocalStartSec;
            this.firstAudibleSec = firstAudibleSec;
            this.effectiveEndSec = effectiveEndSec;
            this.segmentStartSec = segmentStartSec;
            this.camelotNum = camelotNum;
            this.camelotLetter = camelotLetter;
            this.lufs = lufs;
            this.spectralFrames = spectralFrames;
            this.frameRms = frameRms;
            this.vadProb = vadProb;
        }
    }

    public static AutoMixPlanNative analyzeStreamPair(
        String trackAId,
        String urlA,
        double knownDurationSecA,
        String trackBId,
        String urlB,
        Map<String, String> headers
    ) {
        return analyzeStreamPair(null, trackAId, urlA, knownDurationSecA, trackBId, urlB, headers);
    }

    public static AutoMixPlanNative analyzeStreamPair(
        Context context,
        String trackAId,
        String urlA,
        double knownDurationSecA,
        String trackBId,
        String urlB,
        Map<String, String> headers
    ) {
        if (urlA == null || urlA.isEmpty() || urlB == null || urlB.isEmpty()) {
            return null;
        }
        DecodedSegment segA = decodeWindow(context, urlA, headers, true, knownDurationSecA);
        if (segA == null || segA.pcm.length < segA.sampleRate * 8) {
            return null;
        }
        DecodedSegment segB = decodeWindow(context, urlB, headers, false, 0.0);
        if (segB == null || segB.pcm.length < segB.sampleRate * 4) {
            return null;
        }

        SegmentStats statsA = analyzeSegment(segA, true);
        SegmentStats statsB = analyzeSegment(segB, false);
        return solvePlan(trackAId, trackBId, statsA, statsB, segA.sampleRate);
    }

    private static DecodedSegment decodeWindow(
        Context context,
        String url,
        Map<String, String> headers,
        boolean outro,
        double knownDurationSec
    ) {
        MediaExtractor extractor = null;
        MediaCodec codec = null;
        long deadlineMs = android.os.SystemClock.elapsedRealtime() + DECODE_TIMEOUT_MS;
        try {
            extractor = new MediaExtractor();
            if (url.startsWith("content://") && context != null) {
                extractor.setDataSource(context, Uri.parse(url), null);
            } else if (url.startsWith("file://")) {
                String path = Uri.parse(url).getPath();
                extractor.setDataSource(path != null ? path : url);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && headers != null) {
                extractor.setDataSource(url, headers);
            } else {
                extractor.setDataSource(url);
            }
            int audioTrack = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrack = i;
                    format = f;
                    break;
                }
            }
            if (audioTrack < 0 || format == null) {
                return null;
            }
            extractor.selectTrack(audioTrack);

            int sampleRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                : 44100;
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                : 2;
            long durationUs = format.containsKey(MediaFormat.KEY_DURATION)
                ? format.getLong(MediaFormat.KEY_DURATION)
                : (knownDurationSec > 0 ? (long) (knownDurationSec * 1_000_000.0) : 0L);

            double segStartSec = 0.0;
            if (outro) {
                if (durationUs <= 10_000_000L) {
                    return null;
                }
                long targetSeekUs = Math.max(0L, durationUs - (long) (SEGMENT_WINDOW_SEC * 1_000_000.0));
                extractor.seekTo(targetSeekUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
                long actualPtsUs = extractor.getSampleTime();
                segStartSec = (actualPtsUs >= 0 ? actualPtsUs : targetSeekUs) / 1_000_000.0;
            }

            String mime = format.getString(MediaFormat.KEY_MIME);
            if (mime == null) return null;
            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(format, null, null, 0);
            codec.start();

            int maxSamples = (int) Math.min(sampleRate * (SEGMENT_WINDOW_SEC + 1.0), 48000 * 36);
            float[] monoOut = new float[maxSamples];
            int outWritePos = 0;

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean sawInputEos = false;
            boolean sawOutputEos = false;
            int pcmEncoding = android.media.AudioFormat.ENCODING_PCM_16BIT;
            int outChannels = Math.max(1, channels);
            int outRate = Math.max(8000, sampleRate);

            while (!sawOutputEos && outWritePos < maxSamples) {
                if (android.os.SystemClock.elapsedRealtime() > deadlineMs) {
                    break;
                }
                if (!sawInputEos) {
                    int inIdx = codec.dequeueInputBuffer(10_000L);
                    if (inIdx >= 0) {
                        ByteBuffer inBuf = codec.getInputBuffer(inIdx);
                        if (inBuf != null) {
                            int sampleSize = extractor.readSampleData(inBuf, 0);
                            if (sampleSize < 0) {
                                codec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                sawInputEos = true;
                            } else {
                                long ptsUs = extractor.getSampleTime();
                                codec.queueInputBuffer(inIdx, 0, sampleSize, Math.max(0L, ptsUs), 0);
                                extractor.advance();
                            }
                        }
                    }
                }

                int outIdx = codec.dequeueOutputBuffer(info, 10_000L);
                if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat outFmt = codec.getOutputFormat();
                    if (outFmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        outChannels = Math.max(1, outFmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                    }
                    if (outFmt.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        outRate = Math.max(8000, outFmt.getInteger(MediaFormat.KEY_SAMPLE_RATE));
                    }
                    if (outFmt.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        pcmEncoding = outFmt.getInteger(MediaFormat.KEY_PCM_ENCODING);
                    }
                } else if (outIdx >= 0) {
                    ByteBuffer outBuf = codec.getOutputBuffer(outIdx);
                    if (outBuf != null && info.size > 0) {
                        outBuf.position(info.offset);
                        outBuf.limit(info.offset + info.size);
                        outBuf.order(ByteOrder.LITTLE_ENDIAN);
                        boolean isFloat = pcmEncoding == android.media.AudioFormat.ENCODING_PCM_FLOAT;
                        int bytesPerFrame = outChannels * (isFloat ? 4 : 2);
                        int frames = info.size / Math.max(1, bytesPerFrame);
                        for (int f = 0; f < frames && outWritePos < maxSamples; f++) {
                            double sum = 0.0;
                            for (int c = 0; c < outChannels; c++) {
                                if (isFloat) {
                                    float v = outBuf.getFloat();
                                    if (Float.isFinite(v)) sum += v;
                                } else {
                                    sum += outBuf.getShort() / 32768.0;
                                }
                            }
                            monoOut[outWritePos++] = (float) (sum / outChannels);
                        }
                    }
                    codec.releaseOutputBuffer(outIdx, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        sawOutputEos = true;
                    }
                }
            }

            if (outWritePos < outRate * 3) {
                return null;
            }
            float[] trimmed = new float[outWritePos];
            System.arraycopy(monoOut, 0, trimmed, 0, outWritePos);
            return new DecodedSegment(trimmed, outRate, segStartSec);
        } catch (Throwable ignored) {
            return null;
        } finally {
            if (codec != null) {
                try {
                    codec.stop();
                } catch (Throwable ignored) {}
                try {
                    codec.release();
                } catch (Throwable ignored) {}
            }
            if (extractor != null) {
                try {
                    extractor.release();
                } catch (Throwable ignored) {}
            }
        }
    }

    private static SegmentStats analyzeSegment(DecodedSegment seg, boolean outro) {
        float[] buf = seg.pcm;
        int sr = seg.sampleRate;
        int hopSamples = Math.max(64, (int) Math.round(sr * ONSET_HOP_SEC));
        int numFrames = Math.max(1, buf.length / hopSamples);

        double[] onsetEnv = new double[numFrames];
        double[] bassEnv = new double[numFrames];
        double[] fullRms = new double[numFrames];

        double a140 = 1.0 - Math.exp((-2.0 * Math.PI * 140.0) / sr);
        double a600 = 1.0 - Math.exp((-2.0 * Math.PI * 600.0) / sr);
        double a2800 = 1.0 - Math.exp((-2.0 * Math.PI * 2800.0) / sr);
        double lp140 = 0.0, lp600 = 0.0, lp2800 = 0.0;
        double prevB0 = 0.0, prevB1 = 0.0, prevB2 = 0.0, prevB3 = 0.0;

        for (int f = 0; f < numFrames; f++) {
            int start = f * hopSamples;
            int end = Math.min(buf.length, start + hopSamples);
            double sqFull = 0.0, sqB0 = 0.0, sqB1 = 0.0, sqB2 = 0.0, sqB3 = 0.0;
            for (int i = start; i < end; i++) {
                double x = buf[i];
                lp140 += a140 * (x - lp140);
                lp600 += a600 * (x - lp600);
                lp2800 += a2800 * (x - lp2800);
                double b0 = lp140;
                double b1 = lp600 - lp140;
                double b2 = lp2800 - lp600;
                double b3 = x - lp2800;
                sqFull += x * x;
                sqB0 += b0 * b0;
                sqB1 += b1 * b1;
                sqB2 += b2 * b2;
                sqB3 += b3 * b3;
            }
            int len = Math.max(1, end - start);
            fullRms[f] = Math.sqrt(sqFull / len);
            bassEnv[f] = Math.sqrt(sqB0 / len);
            double l0 = Math.log1p(100.0 * Math.sqrt(sqB0 / len));
            double l1 = Math.log1p(100.0 * Math.sqrt(sqB1 / len));
            double l2 = Math.log1p(100.0 * Math.sqrt(sqB2 / len));
            double l3 = Math.log1p(100.0 * Math.sqrt(sqB3 / len));
            if (f > 0) {
                onsetEnv[f] = Math.max(0.0, l0 - prevB0) * 1.3
                    + Math.max(0.0, l1 - prevB1)
                    + Math.max(0.0, l2 - prevB2)
                    + Math.max(0.0, l3 - prevB3) * 0.85;
            }
            prevB0 = l0;
            prevB1 = l1;
            prevB2 = l2;
            prevB3 = l3;
        }

        // Autocorrelation BPM (70..170 BPM)
        double onsetMean = 0.0;
        for (double v : onsetEnv) onsetMean += v;
        onsetMean /= Math.max(1, numFrames);
        double[] centered = new double[numFrames];
        for (int i = 0; i < numFrames; i++) centered[i] = Math.max(0.0, onsetEnv[i] - onsetMean * 0.6);

        int minLag = Math.max(8, (int) Math.round(60.0 / 170.0 / ONSET_HOP_SEC));
        int maxLag = Math.min((int) (numFrames * 0.45), (int) Math.round(60.0 / 70.0 / ONSET_HOP_SEC));
        double bestBpm = 120.0;
        double bestScore = -1e18;
        for (int lag = minLag; lag <= maxLag; lag++) {
            double ac = 0.0;
            for (int i = 0; i < numFrames - lag; i++) {
                ac += centered[i] * centered[i + lag];
            }
            double ac2 = 0.0;
            if (lag * 2 < numFrames - 1) {
                for (int i = 0; i < numFrames - lag * 2; i++) {
                    ac2 += centered[i] * centered[i + lag * 2];
                }
            }
            double cand = 60.0 / (lag * ONSET_HOP_SEC);
            double logRatio = Math.log(cand / 118.0) / Math.log(2.0);
            double prior = Math.exp(-0.5 * (logRatio / 0.72) * (logRatio / 0.72));
            double sc = (ac + ac2 * 0.45) * prior;
            if (sc > bestScore) {
                bestScore = sc;
                bestBpm = cand;
            }
        }
        if (bestBpm < 80.0 && bestBpm * 2.0 <= 160.0) bestBpm *= 2.0;
        bestBpm = Math.max(70.0, Math.min(170.0, bestBpm));
        double periodFrames = (60.0 / bestBpm) / ONSET_HOP_SEC;

        int searchLimit = Math.min(numFrames - 1, (int) Math.round(periodFrames * 1.5));
        int bestPhase = 0;
        double bestComb = -1e18;
        for (int ph = 0; ph < Math.min((int) Math.round(periodFrames), searchLimit); ph++) {
            double comb = 0.0;
            for (double p = ph; p < numFrames; p += periodFrames) {
                int idx = (int) Math.round(p);
                if (idx >= 0 && idx < numFrames) comb += onsetEnv[idx] + bassEnv[idx] * 0.4;
            }
            if (comb > bestComb) {
                bestComb = comb;
                bestPhase = ph;
            }
        }

        List<Double> beatsSec = new ArrayList<>();
        int snapR = Math.max(1, (int) Math.round(periodFrames * 0.12));
        double cursor = bestPhase;
        while (cursor < numFrames) {
            int lo = Math.max(0, (int) Math.round(cursor) - snapR);
            int hi = Math.min(numFrames - 1, (int) Math.round(cursor) + snapR);
            int pk = (int) Math.round(cursor);
            double pkVal = -1.0;
            for (int idx = lo; idx <= hi; idx++) {
                double val = onsetEnv[idx] + bassEnv[idx] * 0.3;
                if (val > pkVal) {
                    pkVal = val;
                    pk = idx;
                }
            }
            beatsSec.add(seg.segmentStartSec + pk * ONSET_HOP_SEC);
            cursor = cursor * 0.35 + pk * 0.65 + periodFrames;
        }

        int bestBarPhase = 0;
        double bestBarScore = -1e18;
        for (int bp = 0; bp < 4; bp++) {
            double s = 0.0;
            for (int i = bp; i < beatsSec.size(); i += 4) {
                int f = Math.max(0, Math.min(numFrames - 1, (int) Math.round((beatsSec.get(i) - seg.segmentStartSec) / ONSET_HOP_SEC)));
                s += bassEnv[f] * 1.4 + onsetEnv[f];
            }
            if (s > bestBarScore) {
                bestBarScore = s;
                bestBarPhase = bp;
            }
        }

        List<Double> downbeatsSec = new ArrayList<>();
        for (int i = bestBarPhase; i < beatsSec.size(); i += 4) {
            downbeatsSec.add(beatsSec.get(i));
        }
        if (downbeatsSec.isEmpty() && !beatsSec.isEmpty()) {
            downbeatsSec.add(beatsSec.get(0));
        }

        // VAD mask (50ms) + firstAudible / effectiveEnd
        int vadHopSamples = Math.max(128, (int) Math.round(sr * VAD_HOP_SEC));
        int numVad = Math.max(1, buf.length / vadHopSamples);
        double[] vadProb = new double[numVad];
        double[] vadRms = new double[numVad];
        double a300 = 1.0 - Math.exp((-2.0 * Math.PI * 300.0) / sr);
        double a3500 = 1.0 - Math.exp((-2.0 * Math.PI * 3500.0) / sr);
        double lp300 = 0.0, lp3500 = 0.0;
        int gStep = Math.max(1, sr / 11025);

        for (int w = 0; w < numVad; w++) {
            int start = w * vadHopSamples;
            int end = Math.min(buf.length, start + vadHopSamples);
            double sqAll = 0.0, sqVoc = 0.0;
            for (int i = start; i < end; i++) {
                double x = buf[i];
                lp300 += a300 * (x - lp300);
                lp3500 += a3500 * (x - lp3500);
                double voc = lp3500 - lp300;
                sqAll += x * x;
                sqVoc += voc * voc;
            }
            int len = Math.max(1, end - start);
            double rms = Math.sqrt(sqAll / len);
            vadRms[w] = rms;
            if (rms < 0.01) {
                vadProb[w] = 0.0;
                continue;
            }
            double fRatio = Math.sqrt(sqVoc / len) / Math.max(1e-6, rms);
            double logSum = 0.0, ariSum = 0.0;
            for (double hz : VOCAL_FREQS) {
                double p = goertzelPower(buf, start, end - start, sr, hz, gStep) + 1e-12;
                logSum += Math.log(p);
                ariSum += p;
            }
            double flatness = Math.max(0.0, Math.min(1.0, Math.exp(logSum / VOCAL_FREQS.length) / Math.max(1e-12, ariSum / VOCAL_FREQS.length)));
            double tonality = Math.max(0.0, Math.min(1.0, 1.0 - flatness * 1.45));
            double trans = w < onsetEnv.length ? onsetEnv[w] : 0.0;
            double hpr = Math.max(0.0, Math.min(1.0, rms / (rms + trans * 0.08 + 1e-4)));
            double formantScore = Math.max(0.0, Math.min(1.0, (fRatio - 0.32) / 0.42));
            vadProb[w] = Math.max(0.0, Math.min(1.0,
                formantScore * (0.55 + 0.25 * tonality + 0.20 * hpr)));
        }

        double firstAudibleSec = seg.segmentStartSec;
        for (int w = 0; w < numVad; w++) {
            if (vadRms[w] >= SILENCE_MINUS_50_DBFS) {
                firstAudibleSec = seg.segmentStartSec + w * VAD_HOP_SEC;
                break;
            }
        }
        int lastAud = numVad - 1;
        while (lastAud > 0 && vadRms[lastAud] < SILENCE_MINUS_50_DBFS) lastAud--;
        double rawSilentEndSec = seg.segmentStartSec + (lastAud + 1) * VAD_HOP_SEC;
        List<Double> bodyVals = new ArrayList<>();
        for (int w = 0; w <= lastAud; w++) {
            if (vadRms[w] >= 0.015) bodyVals.add(vadRms[w]);
        }
        java.util.Collections.sort(bodyVals);
        double bodyRms = !bodyVals.isEmpty() ? bodyVals.get(bodyVals.size() / 2) : 0.10;
        double fadeTailFloor = Math.max(0.012, bodyRms * 0.09);
        int perceptualLast = lastAud;
        while (perceptualLast > 0 && vadRms[perceptualLast] < fadeTailFloor) perceptualLast--;
        double perceptualEndSec = seg.segmentStartSec + (perceptualLast + 1) * VAD_HOP_SEC + 0.8;
        double effectiveEndSec = Math.min(
            rawSilentEndSec,
            Math.max(Math.min(rawSilentEndSec, seg.segmentStartSec + 4.0), perceptualEndSec)
        );

        double tVocalStart = effectiveEndSec;
        double tVocalEnd = seg.segmentStartSec;
        if (!outro) {
            int streak = 0;
            for (int w = 0; w < numVad; w++) {
                if (vadProb[w] >= 0.5) {
                    if (++streak >= 3) {
                        tVocalStart = seg.segmentStartSec + (w - 2) * VAD_HOP_SEC;
                        break;
                    }
                } else {
                    streak = 0;
                }
            }
        } else {
            int streak = 0;
            boolean found = false;
            for (int w = numVad - 1; w >= 0; w--) {
                if (vadProb[w] >= 0.5) {
                    if (++streak >= 3) {
                        tVocalEnd = seg.segmentStartSec + (w + 3) * VAD_HOP_SEC;
                        found = true;
                        break;
                    }
                } else {
                    streak = 0;
                }
            }
            if (!found) tVocalEnd = Math.max(seg.segmentStartSec, effectiveEndSec - 10.0);
        }

        // Phrase boundaries (4-bar downbeats + structural novelty)
        List<Double> phraseBounds = new ArrayList<>();
        for (int b = 0; b < downbeatsSec.size(); b++) {
            if (b % 4 == 0) {
                phraseBounds.add(downbeatsSec.get(b));
            }
        }
        if (phraseBounds.isEmpty()) phraseBounds.addAll(downbeatsSec);

        // Harmonic Key (Camelot) via 12-bin Goertzel Chromagram
        double[] chroma = new double[12];
        int frameLen = Math.min(buf.length, (int) Math.round(sr * 0.25));
        if (frameLen >= 256) {
            int nWin = Math.min(16, Math.max(1, buf.length / frameLen));
            int stride = Math.max(frameLen, buf.length / nWin);
            for (int f = 0; f < nWin; f++) {
                int off = f * stride;
                if (off + frameLen > buf.length) break;
                for (int pc = 0; pc < 12; pc++) {
                    double base = 130.81278265 * Math.pow(2.0, pc / 12.0);
                    chroma[pc] += goertzelPower(buf, off, frameLen, sr, base, gStep)
                        + goertzelPower(buf, off, frameLen, sr, base * 2.0, gStep) * 0.9
                        + goertzelPower(buf, off, frameLen, sr, base * 4.0, gStep) * 0.6;
                }
            }
        }
        double bestCorr = -1e18;
        int bestPc = 0;
        boolean bestMaj = true;
        for (int tonic = 0; tonic < 12; tonic++) {
            double[] rot = new double[12];
            for (int i = 0; i < 12; i++) rot[i] = chroma[(tonic + i) % 12];
            double cm = pearson(rot, KS_MAJOR);
            if (cm > bestCorr) { bestCorr = cm; bestPc = tonic; bestMaj = true; }
            double cn = pearson(rot, KS_MINOR);
            if (cn > bestCorr) { bestCorr = cn; bestPc = tonic; bestMaj = false; }
        }
        int camNum = bestMaj ? MAJOR_CAMELOT[bestPc] : MINOR_CAMELOT[bestPc];
        char camLet = bestMaj ? 'B' : 'A';

        // Integrated LUFS
        int blockS = Math.max(256, (int) Math.round(sr * 0.4));
        int hopS = Math.max(128, (int) Math.round(sr * 0.1));
        double sumLin = 0.0;
        int blocks = 0;
        for (int st = 0; st + blockS <= buf.length; st += hopS) {
            double sq = 0.0;
            int cnt = 0;
            for (int i = st; i < st + blockS; i += 2) { sq += buf[i] * buf[i]; cnt++; }
            double l = -0.691 + 10.0 * Math.log10(Math.max(1e-10, sq / Math.max(1, cnt)));
            if (l > -70.0) {
                sumLin += Math.pow(10.0, (l + 0.691) / 10.0);
                blocks++;
            }
        }
        double lufs = blocks > 0 ? (-0.691 + 10.0 * Math.log10(Math.max(1e-10, sumLin / blocks))) : -14.0;

        // Compute 6-band log-frequency spectral fingerprint every 0.5s
        int specHopSamples = Math.max(256, (int) Math.round(sr * 0.5));
        int specCount = Math.max(1, buf.length / specHopSamples);
        double[][] spectralFrames = new double[specCount][6];
        double[] frameRms = new double[specCount];
        double a90 = 1.0 - Math.exp((-2.0 * Math.PI * 90.0) / sr);
        double a220 = 1.0 - Math.exp((-2.0 * Math.PI * 220.0) / sr);
        double a600s = 1.0 - Math.exp((-2.0 * Math.PI * 600.0) / sr);
        double a1600 = 1.0 - Math.exp((-2.0 * Math.PI * 1600.0) / sr);
        double a4000 = 1.0 - Math.exp((-2.0 * Math.PI * 4000.0) / sr);
        double s90 = 0.0, s220 = 0.0, s600 = 0.0, s1600 = 0.0, s4000 = 0.0;
        for (int w = 0; w < specCount; w++) {
            int st = w * specHopSamples;
            int en = Math.min(buf.length, st + specHopSamples);
            double e0 = 0.0, e1 = 0.0, e2 = 0.0, e3 = 0.0, e4 = 0.0, e5 = 0.0, sq = 0.0;
            for (int i = st; i < en; i++) {
                double x = buf[i];
                s90 += a90 * (x - s90);
                s220 += a220 * (x - s220);
                s600 += a600s * (x - s600);
                s1600 += a1600 * (x - s1600);
                s4000 += a4000 * (x - s4000);
                double b0 = s90, b1 = s220 - s90, b2 = s600 - s220, b3 = s1600 - s600, b4 = s4000 - s1600, b5 = x - s4000;
                e0 += b0 * b0; e1 += b1 * b1; e2 += b2 * b2; e3 += b3 * b3; e4 += b4 * b4; e5 += b5 * b5;
                sq += x * x;
            }
            int len = Math.max(1, en - st);
            spectralFrames[w][0] = Math.sqrt(e0 / len);
            spectralFrames[w][1] = Math.sqrt(e1 / len);
            spectralFrames[w][2] = Math.sqrt(e2 / len);
            spectralFrames[w][3] = Math.sqrt(e3 / len);
            spectralFrames[w][4] = Math.sqrt(e4 / len);
            spectralFrames[w][5] = Math.sqrt(e5 / len);
            frameRms[w] = Math.sqrt(sq / len);
        }

        return new SegmentStats(
            bestBpm,
            beatsSec,
            downbeatsSec,
            phraseBounds,
            tVocalEnd,
            tVocalStart,
            firstAudibleSec,
            effectiveEndSec,
            seg.segmentStartSec,
            camNum,
            camLet,
            Math.max(-40.0, Math.min(-1.0, lufs)),
            spectralFrames,
            frameRms,
            vadProb
        );
    }

    private static double nearestBeatDist(List<Double> beats, double t) {
        double minD = 1.0;
        for (int i = 0; i < beats.size(); i++) {
            double d = Math.abs(beats.get(i) - t);
            if (d < minD) minD = d;
        }
        return minD;
    }

    private static double[] findFrequencyMatchPair(SegmentStats segA, SegmentStats segB) {
        double minOutA = Math.max(segA.segmentStartSec, segA.effectiveEndSec - 7.0);
        double maxOutA = Math.max(minOutA, segA.effectiveEndSec - 2.6);
        double minInB = Math.max(0.0, segB.firstAudibleSec);
        double maxInB = Math.max(minInB, Math.min(minInB + 5.5, 6.0));

        List<Double> nonSilentA = new ArrayList<>();
        for (int i = 0; i < segA.frameRms.length; i++) {
            if (segA.frameRms[i] >= SILENCE_MINUS_50_DBFS) {
                nonSilentA.add(segA.frameRms[i]);
            }
        }
        java.util.Collections.sort(nonSilentA);
        double bodyRmsA = !nonSilentA.isEmpty() ? nonSilentA.get(nonSilentA.size() / 2) : 0.12;

        // Allow up to 12s lookback ONLY when Track A has a contiguous non-vocal fade-out tail reaching effectiveEndSec
        double maxExtendedStartA = Math.max(segA.segmentStartSec, segA.effectiveEndSec - 12.0);
        double anchorEndA = Math.max(maxExtendedStartA, segA.effectiveEndSec - 2.5);
        int tailFramesQuiet = 0;
        for (double t = anchorEndA; t >= segA.effectiveEndSec - 7.0; t -= 0.5) {
            int idx = (int) Math.round((t - segA.segmentStartSec) / 0.5);
            int vIdx = Math.max(0, Math.min(segA.vadProb.length - 1, (int) Math.round((t - segA.segmentStartSec) / VAD_HOP_SEC)));
            double voc = segA.vadProb.length > 0 ? segA.vadProb[vIdx] : 0.0;
            if (idx >= 0 && idx < segA.frameRms.length && segA.frameRms[idx] < bodyRmsA * 0.45 && voc < 0.48) {
                tailFramesQuiet++;
            } else {
                tailFramesQuiet = 0;
                break;
            }
        }
        if (tailFramesQuiet >= 3) {
            for (double t = segA.effectiveEndSec - 7.5; t >= maxExtendedStartA; t -= 0.5) {
                int idx = (int) Math.round((t - segA.segmentStartSec) / 0.5);
                int vIdx = Math.max(0, Math.min(segA.vadProb.length - 1, (int) Math.round((t - segA.segmentStartSec) / VAD_HOP_SEC)));
                double voc = segA.vadProb.length > 0 ? segA.vadProb[vIdx] : 0.0;
                if (idx >= 0 && idx < segA.frameRms.length && segA.frameRms[idx] < bodyRmsA * 0.45 && voc < 0.48) {
                    minOutA = t;
                } else {
                    break;
                }
            }
        }

        double bestScore = -1e18;
        double bestOutA = Math.max(minOutA, segA.effectiveEndSec - 5.2);
        double bestInB = minInB;

        for (double tA = minOutA; tA <= maxOutA + 0.01; tA += 0.5) {
            int idxA = (int) Math.round((tA - segA.segmentStartSec) / 0.5);
            if (idxA < 0 || idxA >= segA.spectralFrames.length) continue;
            if (segA.frameRms[idxA] < SILENCE_MINUS_50_DBFS) continue;
            int vIdxA = Math.max(0, Math.min(segA.vadProb.length - 1, (int) Math.round((tA - segA.segmentStartSec) / VAD_HOP_SEC)));
            double vocA = segA.vadProb.length > 0 ? segA.vadProb[vIdxA] : 0.0;

            int idxAEnd = Math.min(segA.frameRms.length - 1, idxA + 2);
            double rmsAStart = segA.frameRms[idxA];
            double rmsAEnd = segA.frameRms[idxAEnd];
            double declA = rmsAEnd <= rmsAStart * 1.02 ? 1.0 : Math.max(0.0, 1.0 - (rmsAEnd - rmsAStart) / Math.max(0.02, rmsAStart));
            double dropBonus = Math.max(0.0, Math.min(1.0, (bodyRmsA - rmsAStart) / Math.max(0.02, bodyRmsA)));

            for (double tB = minInB; tB <= maxInB + 0.01; tB += 0.5) {
                int idxB = (int) Math.round(tB / 0.5);
                if (idxB < 0 || idxB >= segB.spectralFrames.length) continue;
                if (segB.frameRms[idxB] < SILENCE_MINUS_50_DBFS) continue;

                double[] vecA = new double[6];
                double[] vecB = new double[6];
                double rmsA = 0.0, rmsB = 0.0;
                int cA = 0, cB = 0;
                for (int k = 0; k < 3; k++) {
                    int ia = Math.max(0, Math.min(segA.spectralFrames.length - 1, idxA + k));
                    int ib = Math.max(0, Math.min(segB.spectralFrames.length - 1, idxB + k));
                    for (int b = 0; b < 6; b++) {
                        vecA[b] += segA.spectralFrames[ia][b];
                        vecB[b] += segB.spectralFrames[ib][b];
                    }
                    rmsA += segA.frameRms[ia];
                    rmsB += segB.frameRms[ib];
                    cA++;
                    cB++;
                }
                double dot = 0.0, nA = 0.0, nB = 0.0;
                for (int b = 0; b < 6; b++) {
                    double va = vecA[b] / cA;
                    double vb = vecB[b] / cB;
                    dot += va * vb;
                    nA += va * va;
                    nB += vb * vb;
                }
                double cosSim = Math.sqrt(nA * nB) > 1e-8 ? Math.max(0.0, Math.min(1.0, dot / Math.sqrt(nA * nB))) : 0.0;
                double avgA = rmsA / cA;
                double avgB = rmsB / cB;
                double eSim = Math.max(0.0, Math.min(1.0, 1.0 - Math.abs(avgA - avgB) / Math.max(avgA, Math.max(avgB, 1e-5))));

                int vIdxB = Math.max(0, Math.min(segB.vadProb.length - 1, (int) Math.round(tB / VAD_HOP_SEC)));
                double vocB = segB.vadProb.length > 0 ? segB.vadProb[vIdxB] : 0.0;
                int idxBEnd = Math.min(segB.frameRms.length - 1, idxB + 2);
                double rmsBStart = segB.frameRms[idxB];
                double rmsBEnd = segB.frameRms[idxBEnd];
                double riseB = rmsBEnd >= rmsBStart * 0.90 ? 1.0 : Math.max(0.0, 1.0 - (rmsBStart - rmsBEnd) / Math.max(0.02, rmsBStart));
                double slopeAlign = (declA + riseB) * 0.5;

                double beatBonus = Math.max(0.0, 1.0 - nearestBeatDist(segA.beatsSec, tA) * 4.0) * 0.5
                    + Math.max(0.0, 1.0 - nearestBeatDist(segB.beatsSec, tB) * 4.0) * 0.5;
                double vocalCutPenalty = (vocA > 0.48 ? 0.65 : 0.0) + (vocA > 0.48 && vocB > 0.48 ? 0.35 : 0.0);
                double delayPen = ((tB - minInB) / 5.5) * 0.06;

                double sc = cosSim * 0.42 + eSim * 0.22 + slopeAlign * 0.10 + dropBonus * 0.14 + beatBonus * 0.12 - vocalCutPenalty - delayPen;
                if (sc > bestScore) {
                    bestScore = sc;
                    bestOutA = tA;
                    bestInB = tB;
                }
            }
        }
        if (segA.tVocalEndSec > minOutA && segA.tVocalEndSec <= segA.effectiveEndSec - 2.6) {
            bestOutA = Math.max(bestOutA, segA.tVocalEndSec);
        }
        bestOutA = Math.max(minOutA, Math.min(maxOutA, bestOutA));
        return new double[]{bestOutA, bestInB};
    }

    private static AutoMixPlanNative solvePlan(
        String trackAId,
        String trackBId,
        SegmentStats segA,
        SegmentStats segB,
        int sr
    ) {
        double bpmDiff = Math.abs(segA.bpm - segB.bpm) / Math.max(1.0, segA.bpm);
        int rawStep = Math.abs(segA.camelotNum - segB.camelotNum) % 12;
        int step = Math.min(rawStep, 12 - rawStep);
        int camDist = segA.camelotLetter == segB.camelotLetter ? step : (step == 0 ? 1 : step + 1);
        double gainCompDb = Math.max(-6.0, Math.min(6.0, segA.lufs - segB.lufs));
        double[] freqPair = findFrequencyMatchPair(segA, segB);
        double freqOutA = freqPair[0];
        double freqInB = freqPair[1];
        double minCueOutA = Math.max(segA.segmentStartSec, Math.min(segA.effectiveEndSec - 7.0, freqOutA));
        double defaultRoom = Math.max(2.8, Math.min(5.2, segA.effectiveEndSec - freqOutA - 0.15));

        if (bpmDiff > 0.08 || (bpmDiff > 0.04 && camDist > 2)) {
            double fadeSec = defaultRoom;
            double startA = Math.max(minCueOutA, Math.min(Math.max(minCueOutA, segA.effectiveEndSec - 2.5), Math.min(freqOutA, segA.effectiveEndSec - fadeSec)));
            double startB = Math.max(0.0, Math.max(segB.firstAudibleSec, Math.min(freqInB, Math.min(segB.firstAudibleSec + 5.0, 6.0))));
            return new AutoMixPlanNative(
                "SILENCE_TRIMMED_FADE",
                trackAId,
                trackBId,
                sr,
                Math.round(startA * sr),
                Math.round(startB * sr),
                Math.round(fadeSec * sr),
                1.0f,
                1.0f,
                0.75,
                0.50,
                gainCompDb
            );
        }

        double barSecA = (60.0 / segA.bpm) * 4.0;
        int[] tryBars = new int[]{3, 2, 1};

        List<Double> candsB = new ArrayList<>();
        List<Double> srcB = !segB.phraseBoundariesSec.isEmpty() ? segB.phraseBoundariesSec : segB.downbeatsSec;
        for (double b : srcB) {
            if (b >= Math.max(0.0, segB.firstAudibleSec - 0.15) && b <= Math.min(segB.firstAudibleSec + 5.5, 6.0)) {
                candsB.add(b);
            }
        }
        if (candsB.isEmpty()) candsB.add(freqInB);
        List<Double> srcA = !segA.phraseBoundariesSec.isEmpty() ? segA.phraseBoundariesSec : segA.downbeatsSec;

        for (int bars : tryBars) {
            double mixDurSec = bars * barSecA;
            if (mixDurSec < 2.6 || mixDurSec > 6.8) continue;

            Double cueInB = null;
            for (double b : candsB) {
                if (b + mixDurSec <= segB.tVocalStartSec + 0.08) {
                    if (cueInB == null || Math.abs(b - freqInB) < Math.abs(cueInB - freqInB)) {
                        cueInB = b;
                    }
                }
            }
            if (cueInB == null) continue;

            double maxCueOutA = segA.effectiveEndSec - mixDurSec - 0.15;
            if (maxCueOutA < minCueOutA) continue;

            Double cueOutA = null;
            double vocalMinA = Math.max(minCueOutA, segA.tVocalEndSec - 0.12);
            for (double b : srcA) {
                if (b >= vocalMinA && b <= maxCueOutA + 0.12) {
                    if (cueOutA == null || Math.abs(b - freqOutA) < Math.abs(cueOutA - freqOutA)) {
                        cueOutA = b;
                    }
                }
            }
            if (cueOutA == null) {
                for (double b : srcA) {
                    if (b >= minCueOutA && b <= maxCueOutA + 0.12) {
                        if (cueOutA == null || Math.abs(b - freqOutA) < Math.abs(cueOutA - freqOutA)) {
                            cueOutA = b;
                        }
                    }
                }
            }
            if (cueOutA == null) cueOutA = freqOutA;
            cueOutA = Math.max(minCueOutA, Math.min(Math.max(minCueOutA, maxCueOutA), cueOutA));

            float ratio = bpmDiff <= 0.06 ? (float) Math.max(0.94, Math.min(1.06, segB.bpm / segA.bpm)) : 1.0f;
            return new AutoMixPlanNative(
                "BEAT_SYNC_PHRASE",
                trackAId,
                trackBId,
                sr,
                Math.round(Math.max(0.0, cueOutA) * sr),
                Math.round(Math.max(0.0, cueInB) * sr),
                Math.round(mixDurSec * sr),
                1.0f / ratio,
                ratio,
                0.75,
                0.50,
                gainCompDb
            );
        }

        double fadeSec = defaultRoom;
        double startA = Math.max(minCueOutA, Math.min(Math.max(minCueOutA, segA.effectiveEndSec - 2.5), Math.min(freqOutA, segA.effectiveEndSec - fadeSec)));
        double startB = Math.max(0.0, Math.max(segB.firstAudibleSec, Math.min(freqInB, Math.min(segB.firstAudibleSec + 5.0, 6.0))));
        return new AutoMixPlanNative(
            "SILENCE_TRIMMED_FADE",
            trackAId,
            trackBId,
            sr,
            Math.round(startA * sr),
            Math.round(startB * sr),
            Math.round(fadeSec * sr),
            1.0f,
            1.0f,
            0.75,
            0.50,
            gainCompDb
        );
    }

    private static double goertzelPower(float[] buf, int start, int length, int sr, double hz, int step) {
        double effRate = (double) sr / step;
        if (hz >= effRate * 0.48 || length <= 4) return 0.0;
        double w = (2.0 * Math.PI * hz) / effRate;
        double coeff = 2.0 * Math.cos(w);
        double s1 = 0.0, s2 = 0.0;
        int cnt = 0;
        int end = Math.min(buf.length, start + length);
        for (int i = start; i < end; i += step) {
            double s0 = buf[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
            cnt++;
        }
        return Math.max(0.0, s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, cnt * cnt);
    }

    private static double pearson(double[] x, double[] y) {
        double mx = 0.0, my = 0.0;
        for (int i = 0; i < x.length; i++) { mx += x[i]; my += y[i]; }
        mx /= x.length; my /= y.length;
        double num = 0.0, dx2 = 0.0, dy2 = 0.0;
        for (int i = 0; i < x.length; i++) {
            double dx = x[i] - mx, dy = y[i] - my;
            num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
        }
        double denom = Math.sqrt(dx2 * dy2);
        return denom > 1e-12 ? num / denom : 0.0;
    }
}
