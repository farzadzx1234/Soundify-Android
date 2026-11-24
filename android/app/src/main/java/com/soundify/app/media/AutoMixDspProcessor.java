package com.soundify.app.media;

import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;

/**
 * Sample-accurate real-time Media3 PCM AudioProcessor providing:
 * 1) 4th-order Linkwitz-Riley (LR4) 3-Band Crossover (Low < 140 Hz, Mid 140 Hz - 2.8 kHz, High > 2.8 kHz).
 * 2) Sample-counter-driven Equal-Power gain automation, Downbeat Sub-Bass Swap (-24 dB <-> 0 dB in 120 ms),
 *    Outgoing Mid-Range Vocal Dip (-3 dB over 0.50 -> 1.0), and Master Soft Limiter (-0.5 dBFS ceiling).
 * 3) Legacy 2-pole Butterworth High-Pass Biquad fallback for ad-hoc transitions.
 * 4) Lightweight sampled multi-band RMS telemetry + bit-exact pass-through when bypassed.
 */
public final class AutoMixDspProcessor extends BaseAudioProcessor {

    private static final int MAX_CHANNELS = 8;
    private static final float BUTTERWORTH_Q = 0.70710678f;
    private static final double LOW_CROSSOVER_HZ = 140.0;
    private static final double HIGH_CROSSOVER_HZ = 2800.0;
    private static final double MINUS_24_DB_GAIN = 0.06309573445; // 10^(-24/20)
    private static final double MINUS_3_DB_GAIN = 0.70794578438;  // 10^(-3/20)
    private static final double LIMITER_CEILING = 0.94406087629;  // -0.5 dBFS
    private static final double LIMITER_KNEE_START = 0.86;

    // Legacy HPF biquad state
    private final double[] z1 = new double[MAX_CHANNELS];
    private final double[] z2 = new double[MAX_CHANNELS];

    // LR4 3-band crossover biquad states per channel (cascaded 2-pole Butterworth LP/HP stages)
    private final double[] lp140A_z1 = new double[MAX_CHANNELS];
    private final double[] lp140A_z2 = new double[MAX_CHANNELS];
    private final double[] lp140B_z1 = new double[MAX_CHANNELS];
    private final double[] lp140B_z2 = new double[MAX_CHANNELS];
    private final double[] hp140A_z1 = new double[MAX_CHANNELS];
    private final double[] hp140A_z2 = new double[MAX_CHANNELS];
    private final double[] hp140B_z1 = new double[MAX_CHANNELS];
    private final double[] hp140B_z2 = new double[MAX_CHANNELS];

    private final double[] lp2800A_z1 = new double[MAX_CHANNELS];
    private final double[] lp2800A_z2 = new double[MAX_CHANNELS];
    private final double[] lp2800B_z1 = new double[MAX_CHANNELS];
    private final double[] lp2800B_z2 = new double[MAX_CHANNELS];
    private final double[] hp2800A_z1 = new double[MAX_CHANNELS];
    private final double[] hp2800A_z2 = new double[MAX_CHANNELS];
    private final double[] hp2800B_z1 = new double[MAX_CHANNELS];
    private final double[] hp2800B_z2 = new double[MAX_CHANNELS];

    private double bassLp = 0.0;
    private double midLowLp = 0.0;
    private double midHighLp = 0.0;

    private volatile float targetHighPassHz = 0.0f;
    private volatile float liveRms = 0.0f;
    private volatile float bodyRms = 0.0f;
    private volatile float bassRms = 0.0f;
    private volatile float bodyBassRms = 0.0f;
    private volatile float vocalMidRms = 0.0f;
    private volatile float bodyVocalRms = 0.0f;
    private volatile int processedBlocks = 0;

    // Sample-accurate AutoMix automation parameters
    private volatile boolean autoMixActive = false;
    private volatile boolean autoMixOutgoing = false;
    private volatile boolean autoMix3BandEq = true;
    private volatile long autoMixDurationSamples = 0L;
    private volatile long autoMixFrameIndex = 0L;
    private volatile double autoMixBassSwapProgress = 0.50;
    private volatile double autoMixGainCompLinear = 1.0;

    private float smoothedHighPassHz = 0.0f;
    private float hpWet = 0.0f;
    private double lastCoeffHz = -1.0;
    private double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;

    // Cached LR4 biquad coefficients for current sampleRate
    private double lrSampleRate = -1.0;
    private double lp140_b0, lp140_b1, lp140_b2, lp140_a1, lp140_a2;
    private double hp140_b0, hp140_b1, hp140_b2, hp140_a1, hp140_a2;
    private double lp2800_b0, lp2800_b1, lp2800_b2, lp2800_a1, lp2800_a2;
    private double hp2800_b0, hp2800_b1, hp2800_b2, hp2800_a1, hp2800_a2;

    public void setHighPassHz(float hz) {
        if (!Float.isFinite(hz) || hz <= 25.0f) {
            this.targetHighPassHz = 0.0f;
        } else {
            this.targetHighPassHz = Math.min(900.0f, hz);
        }
    }

    public void startSampleAccurateAutoMix(
        boolean isOutgoing,
        long durationSamples,
        double bassSwapProgress,
        double gainCompensationDb,
        boolean enable3BandEq
    ) {
        clearLr4State();
        this.autoMixOutgoing = isOutgoing;
        this.autoMixDurationSamples = Math.max(4096L, durationSamples);
        this.autoMixBassSwapProgress = Math.max(0.25, Math.min(0.75, bassSwapProgress));
        double clampedDb = Math.max(-6.0, Math.min(6.0, gainCompensationDb));
        this.autoMixGainCompLinear = isOutgoing ? 1.0 : Math.pow(10.0, clampedDb / 20.0);
        this.autoMix3BandEq = enable3BandEq;
        this.autoMixFrameIndex = 0L;
        this.targetHighPassHz = 0.0f;
        this.hpWet = 0.0f;
        this.autoMixActive = true;
    }

    public void stopSampleAccurateAutoMix() {
        this.autoMixActive = false;
        this.autoMixFrameIndex = 0L;
        clearLr4State();
    }

    public boolean isSampleAccurateAutoMixActive() {
        return autoMixActive;
    }

    public void resetTrackStats() {
        this.targetHighPassHz = 0.0f;
        this.smoothedHighPassHz = 0.0f;
        this.hpWet = 0.0f;
        this.autoMixActive = false;
        this.autoMixFrameIndex = 0L;
        this.liveRms = 0.0f;
        this.bodyRms = 0.0f;
        this.bassRms = 0.0f;
        this.bodyBassRms = 0.0f;
        this.vocalMidRms = 0.0f;
        this.bodyVocalRms = 0.0f;
        this.processedBlocks = 0;
        this.lastCoeffHz = -1.0;
        clearBiquadState();
        clearLr4State();
    }

    public int getProcessedBlocks() {
        return processedBlocks;
    }

    public float getLiveRms() {
        return liveRms;
    }

    public float getBodyRms() {
        return bodyRms;
    }

    public float getBassRms() {
        return bassRms;
    }

    public float getBodyBassRms() {
        return bodyBassRms;
    }

    public float getVocalMidRms() {
        return vocalMidRms;
    }

    public float getBodyVocalRms() {
        return bodyVocalRms;
    }

    private void clearBiquadState() {
        for (int i = 0; i < MAX_CHANNELS; i++) {
            z1[i] = 0.0;
            z2[i] = 0.0;
        }
        bassLp = 0.0;
        midLowLp = 0.0;
        midHighLp = 0.0;
    }

    private void clearLr4State() {
        for (int i = 0; i < MAX_CHANNELS; i++) {
            lp140A_z1[i] = 0.0;
            lp140A_z2[i] = 0.0;
            lp140B_z1[i] = 0.0;
            lp140B_z2[i] = 0.0;
            hp140A_z1[i] = 0.0;
            hp140A_z2[i] = 0.0;
            hp140B_z1[i] = 0.0;
            hp140B_z2[i] = 0.0;
            lp2800A_z1[i] = 0.0;
            lp2800A_z2[i] = 0.0;
            lp2800B_z1[i] = 0.0;
            lp2800B_z2[i] = 0.0;
            hp2800A_z1[i] = 0.0;
            hp2800A_z2[i] = 0.0;
            hp2800B_z1[i] = 0.0;
            hp2800B_z2[i] = 0.0;
        }
    }

    private void updateLr4Coefficients(double sampleRate) {
        double safeRate = Math.max(8000.0, sampleRate);
        if (Math.abs(safeRate - lrSampleRate) < 1.0) {
            return;
        }
        lrSampleRate = safeRate;

        // 140 Hz Butterworth Low-Pass & High-Pass
        double wLow = 2.0 * Math.PI * Math.min(safeRate * 0.42, LOW_CROSSOVER_HZ) / safeRate;
        double cosLow = Math.cos(wLow);
        double sinLow = Math.sin(wLow);
        double alphaLow = sinLow / (2.0 * BUTTERWORTH_Q);
        double a0Low = 1.0 + alphaLow;
        lp140_b0 = ((1.0 - cosLow) * 0.5) / a0Low;
        lp140_b1 = (1.0 - cosLow) / a0Low;
        lp140_b2 = lp140_b0;
        lp140_a1 = (-2.0 * cosLow) / a0Low;
        lp140_a2 = (1.0 - alphaLow) / a0Low;

        hp140_b0 = ((1.0 + cosLow) * 0.5) / a0Low;
        hp140_b1 = -(1.0 + cosLow) / a0Low;
        hp140_b2 = hp140_b0;
        hp140_a1 = lp140_a1;
        hp140_a2 = lp140_a2;

        // 2800 Hz Butterworth Low-Pass & High-Pass
        double wHigh = 2.0 * Math.PI * Math.min(safeRate * 0.42, HIGH_CROSSOVER_HZ) / safeRate;
        double cosHigh = Math.cos(wHigh);
        double sinHigh = Math.sin(wHigh);
        double alphaHigh = sinHigh / (2.0 * BUTTERWORTH_Q);
        double a0High = 1.0 + alphaHigh;
        lp2800_b0 = ((1.0 - cosHigh) * 0.5) / a0High;
        lp2800_b1 = (1.0 - cosHigh) / a0High;
        lp2800_b2 = lp2800_b0;
        lp2800_a1 = (-2.0 * cosHigh) / a0High;
        lp2800_a2 = (1.0 - alphaHigh) / a0High;

        hp2800_b0 = ((1.0 + cosHigh) * 0.5) / a0High;
        hp2800_b1 = -(1.0 + cosHigh) / a0High;
        hp2800_b2 = hp2800_b0;
        hp2800_a1 = lp2800_a1;
        hp2800_a2 = lp2800_a2;
    }

    private void updateCoefficients(double cutoffHz, double sampleRate) {
        double safeRate = Math.max(8000.0, sampleRate);
        double clampedHz = Math.max(20.0, Math.min(safeRate * 0.42, cutoffHz));
        if (Math.abs(clampedHz - lastCoeffHz) < 0.75) {
            return;
        }
        double omega = 2.0 * Math.PI * clampedHz / safeRate;
        double cosW = Math.cos(omega);
        double sinW = Math.sin(omega);
        double alpha = sinW / (2.0 * BUTTERWORTH_Q);
        double a0 = 1.0 + alpha;

        b0 = ((1.0 + cosW) * 0.5) / a0;
        b1 = (-(1.0 + cosW)) / a0;
        b2 = ((1.0 + cosW) * 0.5) / a0;
        a1 = (-2.0 * cosW) / a0;
        a2 = (1.0 - alpha) / a0;
        lastCoeffHz = clampedHz;
    }

    private static double smoothstep(double x) {
        double t = Math.max(0.0, Math.min(1.0, x));
        return t * t * (3.0 - 2.0 * t);
    }

    private static double softLimit(double x) {
        double absX = Math.abs(x);
        if (absX <= LIMITER_KNEE_START) {
            return x;
        }
        double excess = absX - LIMITER_KNEE_START;
        double headroom = LIMITER_CEILING - LIMITER_KNEE_START;
        double compressed = LIMITER_KNEE_START + headroom * Math.tanh(excess / headroom);
        return x >= 0.0 ? compressed : -compressed;
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            return AudioFormat.NOT_SET;
        }
        return inputAudioFormat;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        int remaining = inputBuffer.remaining();
        if (remaining <= 0) {
            return;
        }

        boolean isFloat = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT;
        int channels = Math.max(1, Math.min(MAX_CHANNELS, inputAudioFormat.channelCount));
        int sampleRate = Math.max(8000, inputAudioFormat.sampleRate);
        int defaultBpf = isFloat ? channels * 4 : channels * 2;
        int bytesPerFrame = Math.max(defaultBpf, inputAudioFormat.bytesPerFrame);
        int sampleStrideBytes = isFloat ? 4 : 2;
        int frameCount = remaining / bytesPerFrame;
        int startPos = inputBuffer.position();

        // Sample every 8th frame (~0.08% CPU) for 3-band acoustic RMS (full, bass <= 160Hz, vocal-mid 300-3000Hz)
        if (frameCount > 0) {
            double dt = 8.0 / sampleRate;
            double omegaBass = 2.0 * Math.PI * 160.0 * dt;
            double alphaBass = Math.max(0.04, Math.min(0.85, omegaBass / (1.0 + omegaBass)));
            double omegaMidLow = 2.0 * Math.PI * 300.0 * dt;
            double alphaMidLow = Math.max(0.05, Math.min(0.90, omegaMidLow / (1.0 + omegaMidLow)));
            double omegaMidHigh = 2.0 * Math.PI * 3000.0 * dt;
            double alphaMidHigh = Math.max(0.10, Math.min(0.96, omegaMidHigh / (1.0 + omegaMidHigh)));

            double sumSq = 0.0;
            double sumBassSq = 0.0;
            double sumVocalSq = 0.0;
            int counted = 0;
            for (int f = 0; f < frameCount; f += 8) {
                int byteOffset = startPos + f * bytesPerFrame;
                double frameMono = 0.0;
                for (int c = 0; c < channels; c++) {
                    if (isFloat) {
                        double val = inputBuffer.getFloat(byteOffset + c * sampleStrideBytes);
                        if (Double.isFinite(val)) frameMono += val;
                    } else {
                        short s = inputBuffer.getShort(byteOffset + c * sampleStrideBytes);
                        frameMono += s / 32768.0;
                    }
                }
                frameMono /= channels;
                sumSq += frameMono * frameMono;

                bassLp += alphaBass * (frameMono - bassLp);
                sumBassSq += bassLp * bassLp;

                midLowLp += alphaMidLow * (frameMono - midLowLp);
                midHighLp += alphaMidHigh * (frameMono - midHighLp);
                double vocalSample = midHighLp - midLowLp;
                sumVocalSq += vocalSample * vocalSample;

                counted++;
            }
            if (counted > 0) {
                processedBlocks++;
                float blockRms = (float) Math.sqrt(sumSq / counted);
                liveRms = liveRms * 0.65f + blockRms * 0.35f;
                if (blockRms > 0.02f) {
                    if (bodyRms <= 0.001f) {
                        bodyRms = blockRms;
                    } else if (blockRms > bodyRms) {
                        bodyRms = bodyRms * 0.96f + blockRms * 0.04f;
                    } else if (blockRms >= bodyRms * 0.55f) {
                        bodyRms = bodyRms * 0.9992f + blockRms * 0.0008f;
                    }
                }

                float blockBass = (float) Math.sqrt(sumBassSq / counted);
                bassRms = bassRms * 0.65f + blockBass * 0.35f;
                if (blockBass > 0.015f) {
                    if (bodyBassRms <= 0.001f) {
                        bodyBassRms = blockBass;
                    } else if (blockBass > bodyBassRms) {
                        bodyBassRms = bodyBassRms * 0.96f + blockBass * 0.04f;
                    } else if (blockBass >= bodyBassRms * 0.55f) {
                        bodyBassRms = bodyBassRms * 0.9992f + blockBass * 0.0008f;
                    }
                }

                float blockVocal = (float) Math.sqrt(sumVocalSq / counted);
                vocalMidRms = vocalMidRms * 0.65f + blockVocal * 0.35f;
                if (blockVocal > 0.015f) {
                    if (bodyVocalRms <= 0.001f) {
                        bodyVocalRms = blockVocal;
                    } else if (blockVocal > bodyVocalRms) {
                        bodyVocalRms = bodyVocalRms * 0.96f + blockVocal * 0.04f;
                    } else if (blockVocal >= bodyVocalRms * 0.55f) {
                        bodyVocalRms = bodyVocalRms * 0.9992f + blockVocal * 0.0008f;
                    }
                }
            }
        }

        // Stage 4: Sample-Accurate LR4 3-Band Crossover + Equal-Power + Sub-Bass Swap + Mid Vocal Dip + Limiter
        if (autoMixActive && autoMixDurationSamples > 0L) {
            updateLr4Coefficients(sampleRate);
            ByteBuffer out = replaceOutputBuffer(remaining);
            int limit = startPos + remaining;
            long durSamples = autoMixDurationSamples;
            double swapCenter = autoMixBassSwapProgress;
            double swapHalfSpan = Math.max(0.006, (0.060 * sampleRate) / durSamples); // 120ms S-curve swap
            double swapStart = Math.max(0.0, swapCenter - swapHalfSpan);
            double swapLen = Math.max(1e-5, swapHalfSpan * 2.0);
            boolean eqEnabled = autoMix3BandEq;
            boolean outgoing = autoMixOutgoing;
            double gainComp = autoMixGainCompLinear;

            for (int f = 0; f < frameCount; f++) {
                double p = Math.max(0.0, Math.min(1.0, (double) autoMixFrameIndex / durSamples));
                autoMixFrameIndex++;

                double envGain = outgoing
                    ? Math.cos(Math.PI * 0.5 * p)
                    : Math.sin(Math.PI * 0.5 * p) * gainComp;

                double gLow = 1.0;
                double gMid = 1.0;
                double gHigh = 1.0;

                if (eqEnabled) {
                    double swapT = smoothstep((p - swapStart) / swapLen);
                    if (outgoing) {
                        // Cut Deck A Low from 0 dB to -24 dB cleanly on the midpoint downbeat swap
                        gLow = 1.0 - (1.0 - MINUS_24_DB_GAIN) * swapT;
                        // Carve -3 dB mid vocal pocket for emerging Track B across p = 0.50 -> 1.0
                        double midDipT = Math.max(0.0, Math.min(1.0, (p - 0.50) / 0.50));
                        gMid = 1.0 - (1.0 - MINUS_3_DB_GAIN) * midDipT;
                    } else {
                        // Keep Track B Low attenuated (-24 dB) until swap window, then open smoothly to 0 dB
                        gLow = MINUS_24_DB_GAIN + (1.0 - MINUS_24_DB_GAIN) * swapT;
                    }
                }

                for (int c = 0; c < channels; c++) {
                    double x = isFloat
                        ? inputBuffer.getFloat()
                        : (inputBuffer.getShort() / 32768.0);
                    if (!Double.isFinite(x)) x = 0.0;

                    // 140 Hz LR4 Low-Pass (Stage A -> Stage B)
                    double l1 = lp140_b0 * x + lp140A_z1[c];
                    lp140A_z1[c] = lp140_b1 * x - lp140_a1 * l1 + lp140A_z2[c];
                    lp140A_z2[c] = lp140_b2 * x - lp140_a2 * l1;

                    double low = lp140_b0 * l1 + lp140B_z1[c];
                    lp140B_z1[c] = lp140_b1 * l1 - lp140_a1 * low + lp140B_z2[c];
                    lp140B_z2[c] = lp140_b2 * l1 - lp140_a2 * low;

                    // 140 Hz LR4 High-Pass (Stage A -> Stage B)
                    double h1 = hp140_b0 * x + hp140A_z1[c];
                    hp140A_z1[c] = hp140_b1 * x - hp140_a1 * h1 + hp140A_z2[c];
                    hp140A_z2[c] = hp140_b2 * x - hp140_a2 * h1;

                    double midHigh = hp140_b0 * h1 + hp140B_z1[c];
                    hp140B_z1[c] = hp140_b1 * h1 - hp140_a1 * midHigh + hp140B_z2[c];
                    hp140B_z2[c] = hp140_b2 * h1 - hp140_a2 * midHigh;

                    // 2800 Hz LR4 Low-Pass & High-Pass splitting Mid and High
                    double m1 = lp2800_b0 * midHigh + lp2800A_z1[c];
                    lp2800A_z1[c] = lp2800_b1 * midHigh - lp2800_a1 * m1 + lp2800A_z2[c];
                    lp2800A_z2[c] = lp2800_b2 * midHigh - lp2800_a2 * m1;

                    double mid = lp2800_b0 * m1 + lp2800B_z1[c];
                    lp2800B_z1[c] = lp2800_b1 * m1 - lp2800_a1 * mid + lp2800B_z2[c];
                    lp2800B_z2[c] = lp2800_b2 * m1 - lp2800_a2 * mid;

                    double hi1 = hp2800_b0 * midHigh + hp2800A_z1[c];
                    hp2800A_z1[c] = hp2800_b1 * midHigh - hp2800_a1 * hi1 + hp2800A_z2[c];
                    hp2800A_z2[c] = hp2800_b2 * midHigh - hp2800_a2 * hi1;

                    double high = hp2800_b0 * hi1 + hp2800B_z1[c];
                    hp2800B_z1[c] = hp2800_b1 * hi1 - hp2800_a1 * high + hp2800B_z2[c];
                    hp2800B_z2[c] = hp2800_b2 * hi1 - hp2800_a2 * high;

                    double combined = (low * gLow + mid * gMid + high * gHigh) * envGain;
                    double limited = softLimit(combined);

                    if (isFloat) {
                        out.putFloat((float) Math.max(-1.0, Math.min(1.0, limited)));
                    } else {
                        long sOut = Math.round(limited * 32767.0);
                        if (sOut > 32767L) sOut = 32767L;
                        else if (sOut < -32768L) sOut = -32768L;
                        out.putShort((short) sOut);
                    }
                }
            }
            while (inputBuffer.position() < limit && out.hasRemaining()) {
                out.put(inputBuffer.get());
            }
            out.flip();
            return;
        }

        float targetHz = this.targetHighPassHz;
        float wetStep = Math.max(0.05f, Math.min(1.0f, (frameCount / (float) sampleRate) / 0.025f));
        if (targetHz > 25.0f) {
            if (hpWet <= 0.001f) {
                smoothedHighPassHz = targetHz;
                clearBiquadState();
            } else {
                smoothedHighPassHz = smoothedHighPassHz * 0.72f + targetHz * 0.28f;
            }
            hpWet = Math.min(1.0f, hpWet + wetStep);
        } else {
            hpWet = Math.max(0.0f, hpWet - wetStep);
            if (hpWet <= 0.001f) {
                smoothedHighPassHz = 0.0f;
            }
        }

        // Audiophile zero-coloration pass-through when filter is disengaged
        if (hpWet <= 0.001f && targetHz <= 25.0f) {
            ByteBuffer out = replaceOutputBuffer(remaining);
            out.put(inputBuffer);
            out.flip();
            return;
        }

        updateCoefficients(Math.max(25.0f, smoothedHighPassHz), sampleRate);

        ByteBuffer out = replaceOutputBuffer(remaining);
        float wet = hpWet;
        int limit = startPos + remaining;
        if (isFloat) {
            for (int f = 0; f < frameCount; f++) {
                for (int c = 0; c < channels; c++) {
                    double x = inputBuffer.getFloat();
                    if (!Double.isFinite(x)) x = 0.0;
                    double y = b0 * x + z1[c];
                    z1[c] = b1 * x - a1 * y + z2[c];
                    z2[c] = b2 * x - a2 * y;
                    double mixed = x + wet * (y - x);
                    if (mixed > 1.0) mixed = 1.0;
                    else if (mixed < -1.0) mixed = -1.0;
                    out.putFloat((float) mixed);
                }
            }
        } else {
            for (int f = 0; f < frameCount; f++) {
                for (int c = 0; c < channels; c++) {
                    double x = inputBuffer.getShort();
                    double y = b0 * x + z1[c];
                    z1[c] = b1 * x - a1 * y + z2[c];
                    z2[c] = b2 * x - a2 * y;
                    double mixed = x + wet * (y - x);
                    if (mixed > 32767.0) mixed = 32767.0;
                    else if (mixed < -32768.0) mixed = -32768.0;
                    out.putShort((short) Math.round(mixed));
                }
            }
        }
        while (inputBuffer.position() < limit && out.hasRemaining()) {
            out.put(inputBuffer.get());
        }
        out.flip();
    }

    @Override
    protected void onFlush() {
        clearBiquadState();
        clearLr4State();
    }

    @Override
    protected void onReset() {
        clearBiquadState();
        clearLr4State();
        autoMixActive = false;
        autoMixFrameIndex = 0L;
        targetHighPassHz = 0.0f;
        smoothedHighPassHz = 0.0f;
        hpWet = 0.0f;
        liveRms = 0.0f;
        bodyRms = 0.0f;
        bassRms = 0.0f;
        bodyBassRms = 0.0f;
        vocalMidRms = 0.0f;
        bodyVocalRms = 0.0f;
        processedBlocks = 0;
        lastCoeffHz = -1.0;
    }
}
