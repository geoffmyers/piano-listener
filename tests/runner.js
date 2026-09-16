// runner.js — Test runner: synthesize, detect, score
import { computeHPS, computeNoteStates, createNoteStates, MIDI_MIN, MIDI_MAX } from '../dsp.js';
import { synthesize, SAMPLE_RATE } from './synthesize.js';
import { computeFFTFrame, applySmoothingDB } from './fft-utils.js';

const FFT_SIZE = 8192;
const FRAME_STEP = Math.round(SAMPLE_RATE / 60); // ~735 samples per frame (~60fps)

/**
 * Pre-compute raw FFT frames for a scenario.
 * Call once per scenario, then pass to runScenarioFast for each parameter set.
 *
 * @param {object} scenario - {name, events, expected}
 * @returns {object} - {rawFrames: Float32Array[], frameTime: number, totalFrames: number, expected: Array}
 */
export function precomputeScenario(scenario) {
  var audio = synthesize(scenario.events);
  var buffer = audio.buffer;

  var totalFrames = Math.floor((buffer.length - FFT_SIZE) / FRAME_STEP);
  var frameTime = FRAME_STEP / SAMPLE_RATE;

  var rawFrames = new Array(totalFrames);
  for (var frame = 0; frame < totalFrames; frame++) {
    var offset = frame * FRAME_STEP;
    rawFrames[frame] = computeFFTFrame(buffer, offset, FFT_SIZE);
  }

  return {
    rawFrames: rawFrames,
    frameTime: frameTime,
    totalFrames: totalFrames,
    expected: scenario.expected
  };
}

/**
 * Pre-compute HPS magnitudes for a scenario with given smoothing + hpsFactors.
 * Call once per (scenario, smoothingTimeConstant, hpsFactors) combination.
 *
 * @param {object} precomputed - From precomputeScenario
 * @param {number} smoothingTimeConstant
 * @param {number[]} hpsFactors
 * @returns {object} - {magnitudesPerFrame: Array, frameTime, totalFrames, expected}
 */
export function precomputeMagnitudes(precomputed, smoothingTimeConstant, hpsFactors) {
  var rawFrames = precomputed.rawFrames;
  var totalFrames = precomputed.totalFrames;
  var previousFrame = null;
  var magnitudesPerFrame = new Array(totalFrames);

  for (var frame = 0; frame < totalFrames; frame++) {
    var fftData = applySmoothingDB(rawFrames[frame], previousFrame, smoothingTimeConstant);
    previousFrame = fftData;
    magnitudesPerFrame[frame] = computeHPS(fftData, FFT_SIZE, SAMPLE_RATE, hpsFactors);
  }

  return {
    magnitudesPerFrame: magnitudesPerFrame,
    frameTime: precomputed.frameTime,
    totalFrames: totalFrames,
    expected: precomputed.expected
  };
}

/**
 * Run detection on pre-computed HPS magnitudes with given threshold parameters.
 * Cheapest level: only runs noteState detection loop.
 *
 * @param {object} magData - From precomputeMagnitudes
 * @param {object} params - {sensitivity, noiseGate, holdTime, hysteresisRatio}
 * @returns {object} - {precision, recall, f1, truePositives, falsePositives, falseNegatives}
 */
export function runDetectionOnly(magData, params) {
  var magnitudesPerFrame = magData.magnitudesPerFrame;
  var totalFrames = magData.totalFrames;
  var frameTime = magData.frameTime;

  var noteStates = createNoteStates();
  var noiseFloor = 0;

  var detectedRanges = new Map();
  for (var m = MIDI_MIN; m <= MIDI_MAX; m++) {
    detectedRanges.set(m, []);
  }
  var wasActive = new Map();
  for (var m = MIDI_MIN; m <= MIDI_MAX; m++) {
    wasActive.set(m, false);
  }

  for (var frame = 0; frame < totalFrames; frame++) {
    var now = frame * frameTime * 1000; // ms

    var result = computeNoteStates(magnitudesPerFrame[frame], noteStates, noiseFloor, {
      sensitivity: params.sensitivity,
      noiseGate: params.noiseGate,
      holdTime: params.holdTime,
      hysteresisRatio: params.hysteresisRatio
    }, now);
    noiseFloor = result.noiseFloor;

    // Record state transitions
    for (var m = MIDI_MIN; m <= MIDI_MAX; m++) {
      var state = noteStates.get(m);
      var was = wasActive.get(m);

      if (state.active && !was) {
        detectedRanges.get(m).push({ startFrame: frame, endFrame: frame });
      } else if (state.active && was) {
        var ranges = detectedRanges.get(m);
        ranges[ranges.length - 1].endFrame = frame;
      }
      wasActive.set(m, state.active);
    }
  }

  return scoreResults(magData.expected, detectedRanges, frameTime, totalFrames);
}

/**
 * Run detection on pre-computed FFT frames with given parameters.
 * Applies smoothing + HPS + detection in one pass.
 *
 * @param {object} precomputed - From precomputeScenario
 * @param {object} params - {sensitivity, noiseGate, holdTime, hpsFactors, smoothingTimeConstant, hysteresisRatio}
 * @returns {object} - {precision, recall, f1, truePositives, falsePositives, falseNegatives}
 */
export function runScenarioFast(precomputed, params) {
  var magData = precomputeMagnitudes(precomputed, params.smoothingTimeConstant, params.hpsFactors);
  return runDetectionOnly(magData, params);
}

/**
 * Run a single scenario with given parameters (non-optimized, for run-tests.js).
 *
 * @param {object} scenario - {name, events, expected}
 * @param {object} params - {sensitivity, noiseGate, holdTime, hpsFactors, smoothingTimeConstant, hysteresisRatio}
 * @returns {object} - {precision, recall, f1, truePositives, falsePositives, falseNegatives}
 */
export function runScenario(scenario, params) {
  var precomputed = precomputeScenario(scenario);
  return runScenarioFast(precomputed, params);
}

/**
 * Score detected notes against expected events.
 * Uses a 2-frame tolerance on onset/offset.
 */
function scoreResults(expected, detectedRanges, frameTime, totalFrames) {
  var tp = 0;
  var fn = 0;
  var matchedDetections = new Set();

  for (var i = 0; i < expected.length; i++) {
    var exp = expected[i];
    var startFrame = Math.floor(exp.startTime / frameTime);
    var endFrame = Math.floor(exp.endTime / frameTime);
    var tolerance = 2;

    var ranges = detectedRanges.get(exp.midi);
    var found = false;

    for (var r = 0; r < ranges.length; r++) {
      var det = ranges[r];
      if (det.endFrame >= startFrame - tolerance && det.startFrame <= endFrame + tolerance) {
        found = true;
        matchedDetections.add(exp.midi + ':' + r);
        break;
      }
    }

    if (found) {
      tp++;
    } else {
      fn++;
    }
  }

  var fp = 0;
  for (var m = MIDI_MIN; m <= MIDI_MAX; m++) {
    var ranges = detectedRanges.get(m);
    for (var r = 0; r < ranges.length; r++) {
      if (!matchedDetections.has(m + ':' + r)) {
        fp++;
      }
    }
  }

  var precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  var recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  var f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return {
    precision: precision,
    recall: recall,
    f1: f1,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn
  };
}

export { scoreResults };
