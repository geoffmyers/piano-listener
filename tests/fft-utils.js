// fft-utils.js — FFT frame computation for Node.js testing
import FFT from 'fft.js';

/**
 * Compute a single FFT frame from a PCM audio buffer.
 * Produces output identical to AnalyserNode.getFloatFrequencyData().
 *
 * @param {Float32Array} buffer - Full PCM audio buffer
 * @param {number} frameOffset - Sample index to start the frame at
 * @param {number} fftSize - FFT size (e.g. 8192)
 * @returns {Float32Array} - Frequency data in dB (length = fftSize/2)
 */
export function computeFFTFrame(buffer, frameOffset, fftSize) {
  var fft = new FFT(fftSize);
  var input = new Array(fftSize);

  // Extract frame and apply Hann window
  for (var i = 0; i < fftSize; i++) {
    var sampleIdx = frameOffset + i;
    var sample = sampleIdx < buffer.length ? buffer[sampleIdx] : 0;
    // Hann window: 0.5 * (1 - cos(2 * PI * i / (N - 1)))
    var window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    input[i] = sample * window;
  }

  // Run FFT
  var output = fft.createComplexArray();
  fft.realTransform(output, input);
  fft.completeSpectrum(output);

  // Convert to dB magnitude (matching getFloatFrequencyData format)
  var binCount = fftSize / 2;
  var result = new Float32Array(binCount);

  for (var i = 0; i < binCount; i++) {
    var real = output[2 * i];
    var imag = output[2 * i + 1];
    var magnitude = Math.sqrt(real * real + imag * imag) / fftSize;
    // Convert to dB, floor at -100
    if (magnitude > 0) {
      result[i] = 20 * Math.log10(magnitude);
    } else {
      result[i] = -100;
    }
  }

  return result;
}

/**
 * Apply smoothing between frames (matching AnalyserNode.smoothingTimeConstant).
 *
 * @param {Float32Array} currentFrame - Current FFT frame in dB
 * @param {Float32Array|null} previousFrame - Previous smoothed frame (null for first frame)
 * @param {number} smoothing - Smoothing constant (0-1, e.g. 0.4)
 * @returns {Float32Array} - Smoothed frame in dB
 */
export function applySmoothingDB(currentFrame, previousFrame, smoothing) {
  if (!previousFrame) return new Float32Array(currentFrame);

  var result = new Float32Array(currentFrame.length);
  for (var i = 0; i < currentFrame.length; i++) {
    // AnalyserNode smooths in the linear magnitude domain, not dB
    var currentLin = Math.pow(10, currentFrame[i] / 20);
    var prevLin = Math.pow(10, previousFrame[i] / 20);
    var smoothedLin = smoothing * prevLin + (1 - smoothing) * currentLin;
    result[i] = smoothedLin > 0 ? 20 * Math.log10(smoothedLin) : -100;
  }
  return result;
}
