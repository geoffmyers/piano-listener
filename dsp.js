// dsp.js — Piano Listener DSP functions (ES module)
// Shared by browser (index.html) and Node.js tests

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const MIDI_MIN = 21; // A0
export const MIDI_MAX = 108; // C8

// Pre-compute MIDI note frequencies
export const midiFrequencies = new Array(MIDI_MAX + 1);
for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
  midiFrequencies[m] = 440 * Math.pow(2, (m - 69) / 12);
}

export function isBlack(noteIndex) {
  return noteIndex === 1 || noteIndex === 3 || noteIndex === 6 || noteIndex === 8 || noteIndex === 10;
}

// Default parameters (calibrated by tests/run-sweep.js parameter sweep)
export const DEFAULTS = {
  sensitivity: 10,
  noiseGate: 0,
  holdTime: 300,
  // A grid search over [2,3], [2,3,4] and [2,3,4,5] (tests/dsp-tune scripts,
  // not committed — see the Detection tests table in README.md) found [2,3]
  // still wins: the extra downsample passes sharpen octave/octave-fifth
  // harmonics more than they sharpen the fundamental, so aggregate F1 got
  // *worse* (0.40 -> ~0.30) every time a factor was added. Keep it at [2,3]
  // unless a future change to suppressHarmonics() revisits this.
  hpsFactors: [2, 3],
  smoothingTimeConstant: 0.8,
  hysteresisRatio: 0.2,
  // How much of an accepted note's magnitude a candidate at one of its
  // harmonic positions must reach to survive suppressHarmonics() below.
  // Tuned against tests/run-tests.js: values from 0.4-0.8 all land within
  // 0.01 F1 of each other, so 0.5 is picked as the middle of that plateau
  // rather than over-fitting a specific value to synthetic audio.
  harmonicSuppressionRatio: 0.5,
  // A candidate note below this fraction of the loudest note magnitude in
  // the same frame is treated as noise floor / harmonic residue rather than
  // a played note. 0 disables it. This is the dominant lever of the two —
  // sweeping it from 0 to 0.5 at a fixed harmonicSuppressionRatio moves
  // aggregate F1 from 0.35 to ~0.40 and back down, peaking in the 0.3-0.4
  // range; 0.35 is picked there. Above ~0.4 it starts trading away recall
  // (quiet simultaneous notes look like harmonic residue of a louder one).
  minRelativeEnergy: 0.35
};

/**
 * Map a sensitivity slider value (1-100) to a multiplier.
 * 1 -> 0.1, 50 -> 1.0, 100 -> 5.0
 */
export function mapSensitivity(val) {
  if (val <= 50) {
    return 0.1 + (val - 1) * (0.9 / 49);
  }
  return 1.0 + (val - 50) * (4.0 / 50);
}

/**
 * Map a noise gate slider value (0-100) to an absolute magnitude threshold.
 */
export function mapNoiseGate(val) {
  return val * 0.0001;
}

/**
 * Compute Harmonic Product Spectrum from dB frequency data.
 *
 * @param {Float32Array} frequencyDataDB - FFT frequency data in dB
 * @param {number} fftSize - FFT size (e.g. 8192)
 * @param {number} sampleRate - Audio sample rate (e.g. 44100)
 * @param {number[]} hpsFactors - Downsampling factors (e.g. [2, 3])
 * @returns {Array<{midi: number, magnitude: number}>}
 */
export function computeHPS(frequencyDataDB, fftSize, sampleRate, hpsFactors) {
  var binCount = frequencyDataDB.length;

  // Convert dB to linear magnitude
  var magnitude = new Float32Array(binCount);
  for (var i = 0; i < binCount; i++) {
    if (frequencyDataDB[i] < -100) {
      magnitude[i] = 0;
    } else {
      magnitude[i] = Math.pow(10, frequencyDataDB[i] / 20);
    }
  }

  // Harmonic Product Spectrum
  var hps = new Float32Array(magnitude);
  for (var f = 0; f < hpsFactors.length; f++) {
    var factor = hpsFactors[f];
    for (var i = 0; i < binCount; i++) {
      var idx = i * factor;
      if (idx < binCount) {
        hps[i] *= magnitude[idx];
      } else {
        hps[i] = 0;
      }
    }
  }

  // Map bins to MIDI notes
  var results = [];
  for (var midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    var freq = midiFrequencies[midi];
    var bin = Math.round(freq * fftSize / sampleRate);
    var maxMag = 0;
    for (var offset = -2; offset <= 2; offset++) {
      var b = bin + offset;
      if (b >= 0 && b < binCount && hps[b] > maxMag) {
        maxMag = hps[b];
      }
    }
    results.push({ midi: midi, magnitude: maxMag });
  }

  results = suppressHarmonics(results, DEFAULTS.harmonicSuppressionRatio);
  results = applyMinRelativeEnergy(results, DEFAULTS.minRelativeEnergy);

  return results;
}

// Semitone offsets of integer harmonics 2..8 above a fundamental
// (12 * log2(h)): an octave, an octave and a fifth, two octaves, ...
var HARMONIC_SEMITONE_OFFSETS = [12, 19.02, 24, 27.86, 31.02, 33.69, 36];

/**
 * Remove HPS "ghost" peaks that are really the overtones of a louder note.
 *
 * A real piano note's spectrum has energy at 2x, 3x, 4x... its fundamental
 * frequency, and the Harmonic Product Spectrum only *attenuates* that energy
 * relative to the fundamental — it does not zero it out, so a strong note
 * still leaves smaller HPS peaks sitting at its own harmonic MIDI notes
 * (an octave up, an octave and a fifth up, ...), which computeNoteStates()
 * would otherwise report as separately played notes.
 *
 * This picks notes from loudest to quietest (the same order a listener would
 * "hear out" a chord) and, for each one accepted as a peak, zeroes any
 * quieter candidate sitting at one of its harmonic positions — the quieter
 * one is far more likely to be that peak's overtone than an independent
 * note. A candidate at a harmonic position that is comparably loud (>= the
 * ratio) is left alone, since a real note at that pitch would produce HPS
 * energy at least that strong on its own.
 *
 * @param {Array<{midi: number, magnitude: number}>} results - From the HPS/MIDI mapping above
 * @param {number} ratio - 0-1; a candidate below peak.magnitude * ratio at a
 *   harmonic position is suppressed
 * @returns {Array<{midi: number, magnitude: number}>}
 */
export function suppressHarmonics(results, ratio) {
  if (!ratio) return results;

  var n = results.length;
  var baseMidi = results[0].midi;
  var mags = new Float32Array(n);
  for (var i = 0; i < n; i++) mags[i] = results[i].magnitude;

  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  order.sort(function(a, b) { return mags[b] - mags[a]; });

  for (var oi = 0; oi < order.length; oi++) {
    var pi = order[oi];
    var peakMag = mags[pi];
    if (peakMag <= 0) continue; // already suppressed, or silent to begin with
    var peakMidi = baseMidi + pi;

    for (var h = 0; h < HARMONIC_SEMITONE_OFFSETS.length; h++) {
      var targetMidi = Math.round(peakMidi + HARMONIC_SEMITONE_OFFSETS[h]);
      var ti = targetMidi - baseMidi;
      if (ti < 0 || ti >= n) continue;
      if (mags[ti] > 0 && mags[ti] < peakMag * ratio) {
        mags[ti] = 0;
      }
    }
  }

  var out = new Array(n);
  for (var i = 0; i < n; i++) out[i] = { midi: results[i].midi, magnitude: mags[i] };
  return out;
}

/**
 * Zero out any candidate note far quieter than the loudest note in the same
 * frame. A note genuinely being played is either the loudest thing in the
 * spectrum or comparable to it; something far below that is noise floor or
 * harmonic residue that survived suppressHarmonics() (e.g. a harmonic
 * position that happened to fall close enough to an unrelated, louder note
 * to be skipped above).
 *
 * @param {Array<{midi: number, magnitude: number}>} results
 * @param {number} minRatio - 0 disables this; otherwise 0-1 fraction of the
 *   frame's loudest candidate
 * @returns {Array<{midi: number, magnitude: number}>}
 */
export function applyMinRelativeEnergy(results, minRatio) {
  if (!minRatio) return results;

  var maxMag = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].magnitude > maxMag) maxMag = results[i].magnitude;
  }
  if (maxMag <= 0) return results;

  var threshold = maxMag * minRatio;
  var out = new Array(results.length);
  for (var i = 0; i < results.length; i++) {
    var mag = results[i].magnitude;
    out[i] = { midi: results[i].midi, magnitude: mag < threshold ? 0 : mag };
  }
  return out;
}

/**
 * Update note on/off states using adaptive threshold with hysteresis.
 *
 * @param {Array<{midi: number, magnitude: number}>} noteMagnitudes - From computeHPS
 * @param {Map} noteStates - Map<midi, {active, magnitude, onsetTime}>
 * @param {number} noiseFloor - Current noise floor estimate
 * @param {object} params - {sensitivity, noiseGate, holdTime, hysteresisRatio}
 * @param {number} now - Current timestamp in ms
 * @returns {{noteStates: Map, noiseFloor: number}}
 */
export function computeNoteStates(noteMagnitudes, noteStates, noiseFloor, params, now) {
  // Sort magnitudes to find median
  var mags = [];
  for (var i = 0; i < noteMagnitudes.length; i++) {
    mags.push(noteMagnitudes[i].magnitude);
  }
  mags.sort(function(a, b) { return a - b; });
  var median = mags[Math.floor(mags.length / 2)];

  // Update noise floor (exponential moving average)
  noiseFloor = noiseFloor * 0.95 + median * 0.05;

  var sensitivityMult = mapSensitivity(params.sensitivity);
  var gateLevel = mapNoiseGate(params.noiseGate);
  var holdTime = params.holdTime;
  var hysteresisRatio = params.hysteresisRatio;

  // Calculate thresholds
  var onThreshold = noiseFloor * (10 / sensitivityMult);
  var offThreshold = onThreshold * hysteresisRatio;

  // Update each note
  for (var i = 0; i < noteMagnitudes.length; i++) {
    var note = noteMagnitudes[i];
    var mag = note.magnitude;

    if (mag < gateLevel) {
      mag = 0;
    }

    var state = noteStates.get(note.midi);
    if (!state.active) {
      if (mag > onThreshold) {
        state.active = true;
        state.onsetTime = now;
        state.magnitude = mag;
      }
    } else {
      if (mag < offThreshold && (now - state.onsetTime) > holdTime) {
        state.active = false;
        state.magnitude = 0;
      } else {
        state.magnitude = mag;
      }
    }
  }

  return { noteStates: noteStates, noiseFloor: noiseFloor };
}

/**
 * Create a fresh noteStates Map for all 88 notes.
 */
export function createNoteStates() {
  var states = new Map();
  for (var m = MIDI_MIN; m <= MIDI_MAX; m++) {
    states.set(m, { active: false, magnitude: 0, onsetTime: 0 });
  }
  return states;
}
