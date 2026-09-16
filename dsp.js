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
  hpsFactors: [2, 3],
  smoothingTimeConstant: 0.8,
  hysteresisRatio: 0.2
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

  return results;
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
