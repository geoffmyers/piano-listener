# Architecture

## Audio input

**Start Listening** calls `initAudio()`, which asks for the microphone with echo
cancellation, noise suppression and automatic gain control all **off** (each
would distort a piano's spectrum). The stream feeds an `AnalyserNode` with an
FFT size of 8192 and smoothing of 0.8. Nothing is connected to the speakers.

`renderLoop()` runs once per animation frame, and does nothing while the audio
context's clock is standing still (a backgrounded tab). Each frame it:

1. reads the time-domain samples for the level meter (RMS, 0–0.5 mapped to
   0–100 %; yellow from 70 %, red above 90 %);
2. reads the spectrum in dB and calls `computeHPS()`;
3. calls `computeNoteStates()` with the slider values;
4. updates the keyboard, the list of active notes, the spectrum and the piano
   roll, and scrolls them to keep active notes in view.

## Detection (`dsp.js`)

`dsp.js` is an ES module with no browser dependencies, so the page and the Node
tests run exactly the same code.

**`computeHPS(dB, fftSize, sampleRate, factors)`**

1. Converts each bin from dB to linear magnitude (bins below −100 dB become 0).
2. Harmonic product spectrum: multiplies each bin by the bins at 2× and 3× its
   frequency (`DEFAULTS.hpsFactors`). A note whose overtones are present is
   reinforced, and a lone overtone is suppressed.
3. For each MIDI note 21–108 (A0–C8), takes the largest product within ±2 bins
   of the note's frequency. At 44.1 kHz and 8192 bins, a bin is 5.4 Hz wide,
   wider than the gap between the lowest notes.

**`computeNoteStates(magnitudes, states, noiseFloor, params, now)`**

- The noise floor follows the median of the 88 magnitudes (an exponential
  moving average, 5 % per frame).
- A note turns **on** above `noiseFloor × 10 / sensitivity`, where the
  Sensitivity slider (1–100) maps to a multiplier from 0.1 to 5.
- A note turns **off** below a fifth of that (hysteresis ratio 0.2), but not
  before *Hold Time* has passed since it turned on.
- The Noise Gate zeroes any magnitude under `gate × 0.0001` first.

`DEFAULTS` holds the parameters the page uses and the sliders' starting values;
they are the best combination found by the test sweep.

## Rendering

- **Keyboard:** 52 white and 36 black keys built as DOM elements. Only keys
  whose state changed are touched each frame.
- **Spectrum:** a canvas bar per key, drawn over the key it belongs to.
- **Piano roll:** a canvas redrawn each frame from recent snapshots of the
  active notes.
- **Zoom:** *Fit Width* sizes white keys to the window width; *Fit Height* sizes
  them to the keyboard area's height and lets the row scroll. The keyboard,
  spectrum and piano roll share one horizontal scroll position. The mode is
  kept in `localStorage`.
- Canvases are drawn at the device pixel ratio.

The page also builds a web app manifest and a service worker from `blob:` URLs.
Browsers only register service workers served over HTTP(S), so the worker
never installs; see *Known limitations* in the README.

## Tests (`tests/`)

| File | Role |
|---|---|
| `synthesize.js` | Renders note events at 44.1 kHz: a fundamental plus four harmonics (1, ½, ¼, 0.15, 0.1) under an exponential decay |
| `fft-utils.js` | Hann-windowed FFT in dB with the analyser's smoothing, using `fft.js`, to match `AnalyserNode.getFloatFrequencyData()` |
| `scenarios.js` | Seven scenarios, each a list of note events and the windows in which each note should be detected |
| `runner.js` | Steps through a scenario at about 60 frames per second, runs `dsp.js`, and counts true positives, false positives and false negatives |
| `run-tests.js` | `npm test`: scores every scenario with `DEFAULTS` |
| `sweep.js`, `run-sweep.js` | `npm run sweep`: 7,500 parameter combinations, reusing FFT and HPS work across them; writes `sweep-results.json` (gitignored) |

## Deployment files

| File | Purpose |
|---|---|
| `_headers` | `Content-Security-Policy` allowing only same-origin, inline and `blob:` sources, plus `nosniff`, `DENY` framing and a referrer policy |
| `wrangler.toml` | Worker `piano-listener`, custom domain, `assets.directory = "./"` |
| `.assetsignore` | Keeps `tests/`, `package.json`, `wrangler.toml` and the repository docs off the site |
| `package.json` | Only `"type": "module"`, so Node treats `dsp.js` as an ES module when the tests import it |
