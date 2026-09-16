// scenarios.js — Test scenario definitions
import { MIDI_MIN, MIDI_MAX } from '../dsp.js';

/**
 * Each scenario returns:
 * {
 *   name: string,
 *   description: string,
 *   events: Array<{midi, startTime, duration, velocity}>,
 *   expected: Array<{midi, startTime, endTime}> // when each note should be detected
 * }
 */

export function scenario1_singleNotes() {
  var events = [];
  var expected = [];
  var t = 0.2; // start with 200ms lead-in

  for (var midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    events.push({ midi: midi, startTime: t, duration: 0.5, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.5 });
    t += 0.7; // 500ms note + 200ms silence
  }

  return {
    name: 'Single Notes',
    description: 'Each of 88 notes played individually, 500ms each, 200ms gaps',
    events: events,
    expected: expected
  };
}

export function scenario2_chords() {
  var events = [];
  var expected = [];
  var t = 0.2;

  // Major triads in every octave (C2-C7)
  var majorRoots = [36, 48, 60, 72, 84, 96]; // C2, C3, C4, C5, C6, C7
  for (var i = 0; i < majorRoots.length; i++) {
    var root = majorRoots[i];
    var notes = [root, root + 4, root + 7]; // major triad
    for (var n = 0; n < notes.length; n++) {
      if (notes[n] <= MIDI_MAX) {
        events.push({ midi: notes[n], startTime: t, duration: 0.8, velocity: 0.8 });
        expected.push({ midi: notes[n], startTime: t, endTime: t + 0.8 });
      }
    }
    t += 1.1;
  }

  // Minor triads (A minor in every octave A2-A6)
  var minorRoots = [45, 57, 69, 81, 93]; // A2, A3, A4, A5, A6
  for (var i = 0; i < minorRoots.length; i++) {
    var root = minorRoots[i];
    var notes = [root, root + 3, root + 7];
    for (var n = 0; n < notes.length; n++) {
      if (notes[n] <= MIDI_MAX) {
        events.push({ midi: notes[n], startTime: t, duration: 0.8, velocity: 0.8 });
        expected.push({ midi: notes[n], startTime: t, endTime: t + 0.8 });
      }
    }
    t += 1.1;
  }

  // 7th chords: Cmaj7 at C3, Dm7 at D3, G7 at G3
  var sevenths = [
    [48, 52, 55, 59], // Cmaj7
    [50, 53, 57, 60], // Dm7
    [55, 59, 62, 65]  // G7
  ];
  for (var i = 0; i < sevenths.length; i++) {
    for (var n = 0; n < sevenths[i].length; n++) {
      events.push({ midi: sevenths[i][n], startTime: t, duration: 0.8, velocity: 0.8 });
      expected.push({ midi: sevenths[i][n], startTime: t, endTime: t + 0.8 });
    }
    t += 1.1;
  }

  return {
    name: 'Chords',
    description: 'Major/minor triads across octaves, plus 7th chords',
    events: events,
    expected: expected
  };
}

export function scenario3_fastPassages() {
  var events = [];
  var expected = [];
  var t = 0.2;

  // Chromatic run C4 to C5 and back (100ms per note)
  for (var midi = 60; midi <= 72; midi++) {
    events.push({ midi: midi, startTime: t, duration: 0.1, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.1 });
    t += 0.1;
  }
  for (var midi = 71; midi >= 60; midi--) {
    events.push({ midi: midi, startTime: t, duration: 0.1, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.1 });
    t += 0.1;
  }

  t += 0.3; // gap

  // C major scale ascending/descending (80ms per note)
  var cMajor = [60, 62, 64, 65, 67, 69, 71, 72];
  for (var i = 0; i < cMajor.length; i++) {
    events.push({ midi: cMajor[i], startTime: t, duration: 0.08, velocity: 0.8 });
    expected.push({ midi: cMajor[i], startTime: t, endTime: t + 0.08 });
    t += 0.08;
  }
  for (var i = cMajor.length - 2; i >= 0; i--) {
    events.push({ midi: cMajor[i], startTime: t, duration: 0.08, velocity: 0.8 });
    expected.push({ midi: cMajor[i], startTime: t, endTime: t + 0.08 });
    t += 0.08;
  }

  t += 0.3;

  // Trill between C4 and D4 (60ms each, 10 alternations)
  for (var i = 0; i < 10; i++) {
    var midi = i % 2 === 0 ? 60 : 62;
    events.push({ midi: midi, startTime: t, duration: 0.06, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.06 });
    t += 0.06;
  }

  return {
    name: 'Fast Passages',
    description: 'Chromatic run, C major scale, and trill at high speed',
    events: events,
    expected: expected
  };
}

export function scenario4_velocityVariations() {
  var events = [];
  var expected = [];
  var t = 0.2;

  var velocities = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
  var testNotes = [60, MIDI_MIN, MIDI_MAX]; // C4, A0, C8

  for (var n = 0; n < testNotes.length; n++) {
    for (var v = 0; v < velocities.length; v++) {
      events.push({ midi: testNotes[n], startTime: t, duration: 0.5, velocity: velocities[v] });
      expected.push({ midi: testNotes[n], startTime: t, endTime: t + 0.5 });
      t += 0.7;
    }
    t += 0.3; // extra gap between different notes
  }

  return {
    name: 'Velocity Variations',
    description: 'C4, A0, and C8 at six different velocities (0.1 to 1.0)',
    events: events,
    expected: expected
  };
}

export function scenario5_lowRegister() {
  var events = [];
  var expected = [];
  var t = 0.2;

  // All notes A0 through B1 (MIDI 21-35)
  for (var midi = 21; midi <= 35; midi++) {
    events.push({ midi: midi, startTime: t, duration: 0.8, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.8 });
    t += 1.1;
  }

  t += 0.3;

  // Low register chords
  var lowChords = [[21, 28], [24, 31]]; // A0+E1, C1+G1
  for (var c = 0; c < lowChords.length; c++) {
    for (var n = 0; n < lowChords[c].length; n++) {
      events.push({ midi: lowChords[c][n], startTime: t, duration: 0.8, velocity: 0.8 });
      expected.push({ midi: lowChords[c][n], startTime: t, endTime: t + 0.8 });
    }
    t += 1.1;
  }

  return {
    name: 'Low Register',
    description: 'A0-B1 individually plus low chords (tests FFT resolution limits)',
    events: events,
    expected: expected
  };
}

export function scenario6_highRegister() {
  var events = [];
  var expected = [];
  var t = 0.2;

  // All notes C6 through C8 (MIDI 84-108)
  for (var midi = 84; midi <= 108; midi++) {
    events.push({ midi: midi, startTime: t, duration: 0.4, velocity: 0.8 });
    expected.push({ midi: midi, startTime: t, endTime: t + 0.4 });
    t += 0.6;
  }

  return {
    name: 'High Register',
    description: 'C6-C8 individually (tests harmonic overlap with adjacent notes)',
    events: events,
    expected: expected
  };
}

export function scenario7_wideIntervals() {
  var events = [];
  var expected = [];
  var t = 0.2;

  var pairs = [
    [MIDI_MIN, MIDI_MAX], // A0 + C8
    [36, 84],             // C2 + C6
    [28, 67]              // E1 + G4
  ];

  for (var p = 0; p < pairs.length; p++) {
    for (var n = 0; n < pairs[p].length; n++) {
      events.push({ midi: pairs[p][n], startTime: t, duration: 0.8, velocity: 0.8 });
      expected.push({ midi: pairs[p][n], startTime: t, endTime: t + 0.8 });
    }
    t += 1.1;
  }

  return {
    name: 'Wide Intervals',
    description: 'Simultaneous notes at extreme intervals (A0+C8, C2+C6, E1+G4)',
    events: events,
    expected: expected
  };
}

export function getAllScenarios() {
  return [
    scenario1_singleNotes(),
    scenario2_chords(),
    scenario3_fastPassages(),
    scenario4_velocityVariations(),
    scenario5_lowRegister(),
    scenario6_highRegister(),
    scenario7_wideIntervals()
  ];
}
