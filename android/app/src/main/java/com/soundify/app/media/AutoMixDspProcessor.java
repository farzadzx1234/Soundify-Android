package com.soundify.app.media;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;

/**
 * Zero-allocation real-time Media3 PCM AudioProcessor providing:
 * 1) 2-pole Butterworth High-Pass Biquad DSP for Apple Music / Club-DJ Bass-Swap crossfades.
 * 2) Lightweight sampled RMS loudness tracking (liveRms / bodyRms) for acoustic outro detection.
 * 3) Bit-exact audiophile pass-through when bypassed (targetHighPassHz <= 25 Hz and hpWet ~ 0).
 */
public final class AutoMixDspProcessor extends BaseAudioProcessor {

    private static final int MAX_CHANNELS = 8;
    private static final float BUTTERWORTH_Q = 0.70710678f;

    private final double[] z1 = new double[MAX_CHANNELS];
    private final double[] z2 = new double[MAX_CHANNELS];

    private volatile float targetHighPassHz = 0.0f;
    private volatile float liveRms = 0.0f;
    private volatile float bodyRms = 0.0f;

    private float smoothedHighPassHz = 0.0f;
    private float hpWet = 0.0f;
    private double lastCoeffHz = -1.0;
    private double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;

    public void setHighPassHz(float hz) {
        if (!Float.isFinite(hz) || hz <= 25.0f) {
            this.targetHighPassHz = 0.0f;
        } else {
            this.targetHighPassHz = Math.min(900.0f, hz);
        }
    }

    public void resetTrackStats() {
        this.targetHighPassHz = 0.0f;
        this.smoothedHighPassHz = 0.0f;
        this.hpWet = 0.0f;
        this.liveRms = 0.0f;
        this.bodyRms = 0.0f;
        this.lastCoeffHz = -1.0;
        clearBiquadState();
    }

    public float getLiveRms() {
        return liveRms;
    }

    public float getBodyRms() {
        return bodyRms;
    }

    private void clearBiquadState() {
        for (int i = 0; i < MAX_CHANNELS; i++) {
            z1[i] = 0.0;
            z2[i] = 0.0;
        }
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

    @Override
    protected AudioFormat onConfigure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
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

        int channels = Math.max(1, Math.min(MAX_CHANNELS, inputAudioFormat.channelCount));
        int sampleRate = Math.max(8000, inputAudioFormat.sampleRate);
        int bytesPerFrame = Math.max(2, inputAudioFormat.bytesPerFrame);
        int frameCount = remaining / bytesPerFrame;
        int startPos = inputBuffer.position();

        // Sample every 8th frame (~0.05% CPU) to measure live acoustic energy and sustained track loudness
        if (frameCount > 0) {
            double sumSq = 0.0;
            int counted = 0;
            for (int f = 0; f < frameCount; f += 8) {
                int byteOffset = startPos + f * bytesPerFrame;
                double frameMono = 0.0;
                for (int c = 0; c < channels; c++) {
                    short s = inputBuffer.getShort(byteOffset + c * 2);
                    frameMono += s / 32768.0;
                }
                frameMono /= channels;
                sumSq += frameMono * frameMono;
                counted++;
            }
            if (counted > 0) {
                float blockRms = (float) Math.sqrt(sumSq / counted);
                float nextLive = liveRms * 0.65f + blockRms * 0.35f;
                liveRms = nextLive;
                if (blockRms > 0.03f) {
                    if (bodyRms <= 0.001f) {
                        bodyRms = blockRms;
                    } else if (blockRms > bodyRms) {
                        bodyRms = bodyRms * 0.96f + blockRms * 0.04f;
                    } else {
                        bodyRms = bodyRms * 0.996f + blockRms * 0.004f;
                    }
                }
            }
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
        int strideFrames = frameCount;
        for (int f = 0; f < strideFrames; f++) {
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
        while (inputBuffer.position() < limit && out.hasRemaining()) {
            out.put(inputBuffer.get());
        }
        out.flip();
    }

    @Override
    protected void onFlush() {
        clearBiquadState();
    }

    @Override
    protected void onReset() {
        clearBiquadState();
        targetHighPassHz = 0.0f;
        smoothedHighPassHz = 0.0f;
        hpWet = 0.0f;
        liveRms = 0.0f;
        bodyRms = 0.0f;
        lastCoeffHz = -1.0;
    }
}
