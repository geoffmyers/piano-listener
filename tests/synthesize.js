// synthesize.js — Synthesize piano-like audio from MIDI events
import { midiFrequencies } from '../dsp.js';

const SAMPLE_RATE = 44100;

// Harmonic amplitudes (piano-like: fundamental strongest, overtones decay)
const HARMONIC_AMPLITUDES = [1.0, 0.5, 0.25, 0.15, 0.1];

/**
 * Generate a PCM audio buffer from a list of MIDI events.
 *
 * @param {Array<{midi: number, startTime: number, duration: number, velocity: number}>} events
 *   - midi: MIDI note number (21-108)
 *   - startTime: start time in seconds
 *   - duration: duration in seconds
 *   - velocity: amplitude 0.0-1.0
 * @param {number} [totalDuration] - Total buffer duration in seconds (auto-calculated if omitted)
 * @returns {{buffer: Float32Array, sampleRate: number, duration: number}}
 */
export function synthesize(events, totalDuration) {
  if (!totalDuration) {
    var maxEnd = 0;
    for (var i = 0; i < events.length; i++) {
      var end = events[i].startTime + events[i].duration;
      if (end > maxEnd) maxEnd = end;
    }
    totalDuration = maxEnd + 0.5; // 500ms padding after last event
  }

  var numSamples = Math.ceil(totalDuration * SAMPLE_RATE);
  var buffer = new Float32Array(numSamples);

  for (var e = 0; e < events.length; e++) {
    var event = events[e];
    var freq = midiFrequencies[event.midi];
    var startSample = Math.floor(event.startTime * SAMPLE_RATE);
    var endSample = Math.min(startSample + Math.floor(event.duration * SAMPLE_RATE), numSamples);
    var velocity = event.velocity;

    for (var s = startSample; s < endSample; s++) {
      var t = (s - startSample) / SAMPLE_RATE;
      var relativeT = t / event.duration;

      // Exponential decay envelope (piano-like: fast initial decay, slow sustain)
      var envelope = Math.exp(-3 * relativeT);

      var sample = 0;
      // Fundamental + harmonics
      for (var h = 0; h < HARMONIC_AMPLITUDES.length; h++) {
        var harmonicFreq = freq * (h + 1);
        // Skip harmonics above Nyquist
        if (harmonicFreq >= SAMPLE_RATE / 2) break;
        sample += HARMONIC_AMPLITUDES[h] * Math.sin(2 * Math.PI * harmonicFreq * t);
      }

      buffer[s] += sample * envelope * velocity * 0.3; // 0.3 scaling to avoid clipping when summing
    }
  }

  return { buffer: buffer, sampleRate: SAMPLE_RATE, duration: totalDuration };
}

export { SAMPLE_RATE };
