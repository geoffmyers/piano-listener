// sweep.js — Parameter sweep: grid search across all scenarios
import { runDetectionOnly, precomputeScenario, precomputeMagnitudes } from './runner.js';

/**
 * Run a full parameter sweep across all scenarios.
 * Three-level pre-computation for maximum speed:
 *   1. FFT frames computed once per scenario
 *   2. Smoothing + HPS magnitudes computed once per (scenario, smoothing, hpsFactors) triple
 *   3. Detection loop runs per (sensitivity, noiseGate, holdTime, hysteresisRatio) combo
 *
 * @param {Array} scenarios - From getAllScenarios()
 * @param {object} [grid] - Optional custom grid; defaults to full sweep
 * @returns {Array<{params, scores, aggregateF1}>} - Sorted by aggregateF1 descending
 */
export function runSweep(scenarios, grid) {
  if (!grid) {
    grid = {
      sensitivity: [10, 30, 50, 70, 90],
      noiseGate: [0, 10, 20, 40, 60],
      holdTime: [50, 80, 120, 180, 300],
      hpsFactors: [[2, 3], [2, 3, 4], [2, 3, 4, 5]],
      smoothingTimeConstant: [0.2, 0.4, 0.6, 0.8],
      hysteresisRatio: [0.2, 0.3, 0.4, 0.5, 0.6]
    };
  }

  // Calculate total combinations
  var totalCombinations = 1;
  var keys = Object.keys(grid);
  for (var k = 0; k < keys.length; k++) {
    totalCombinations *= grid[keys[k]].length;
  }

  // Detection-only combinations (without smoothing and hpsFactors)
  var detectionGrid = {
    sensitivity: grid.sensitivity,
    noiseGate: grid.noiseGate,
    holdTime: grid.holdTime,
    hysteresisRatio: grid.hysteresisRatio
  };
  var detectionCombos = generateCombinations(detectionGrid);
  var signalCombos = grid.smoothingTimeConstant.length * grid.hpsFactors.length;

  console.log('Total parameter combinations: ' + totalCombinations);
  console.log('  Signal paths (smoothing x hps): ' + signalCombos);
  console.log('  Detection combos per signal path: ' + detectionCombos.length);
  console.log('Scenarios: ' + scenarios.length);
  console.log('');

  // Level 1: Pre-compute FFT frames for all scenarios
  console.log('Level 1: Pre-computing FFT frames...');
  var precomputed = [];
  for (var s = 0; s < scenarios.length; s++) {
    var preStart = Date.now();
    precomputed.push({
      name: scenarios[s].name,
      data: precomputeScenario(scenarios[s])
    });
    var preElapsed = ((Date.now() - preStart) / 1000).toFixed(1);
    console.log('  ' + scenarios[s].name + ': ' + precomputed[s].data.totalFrames + ' frames (' + preElapsed + 's)');
  }
  console.log('');

  // Level 2: Pre-compute magnitudes for each (scenario, smoothing, hps) triple
  console.log('Level 2: Pre-computing smoothing + HPS magnitudes...');
  var magStart = Date.now();
  // magCache[smoothIdx][hpsIdx][scenarioIdx] = magData
  var magCache = [];
  for (var si = 0; si < grid.smoothingTimeConstant.length; si++) {
    magCache[si] = [];
    for (var hi = 0; hi < grid.hpsFactors.length; hi++) {
      magCache[si][hi] = [];
      for (var sc = 0; sc < precomputed.length; sc++) {
        magCache[si][hi][sc] = precomputeMagnitudes(
          precomputed[sc].data,
          grid.smoothingTimeConstant[si],
          grid.hpsFactors[hi]
        );
      }
    }
  }
  var magElapsed = ((Date.now() - magStart) / 1000).toFixed(1);
  var totalMagComputations = grid.smoothingTimeConstant.length * grid.hpsFactors.length * precomputed.length;
  console.log('  ' + totalMagComputations + ' magnitude sequences computed (' + magElapsed + 's)');
  console.log('');

  // Level 3: Run detection for each full parameter combination
  console.log('Level 3: Running detection sweep...');
  var results = [];
  var completed = 0;
  var startTime = Date.now();

  for (var si = 0; si < grid.smoothingTimeConstant.length; si++) {
    for (var hi = 0; hi < grid.hpsFactors.length; hi++) {
      for (var d = 0; d < detectionCombos.length; d++) {
        var dp = detectionCombos[d];
        var params = {
          sensitivity: dp.sensitivity,
          noiseGate: dp.noiseGate,
          holdTime: dp.holdTime,
          hpsFactors: grid.hpsFactors[hi],
          smoothingTimeConstant: grid.smoothingTimeConstant[si],
          hysteresisRatio: dp.hysteresisRatio
        };

        var scores = {};
        var totalTP = 0, totalFP = 0, totalFN = 0;

        for (var sc = 0; sc < precomputed.length; sc++) {
          var result = runDetectionOnly(magCache[si][hi][sc], dp);
          scores[precomputed[sc].name] = result;
          totalTP += result.truePositives;
          totalFP += result.falsePositives;
          totalFN += result.falseNegatives;
        }

        var aggP = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
        var aggR = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
        var aggF1 = aggP + aggR > 0 ? 2 * aggP * aggR / (aggP + aggR) : 0;

        results.push({
          params: params,
          scores: scores,
          aggregateF1: aggF1,
          aggregatePrecision: aggP,
          aggregateRecall: aggR
        });

        completed++;
        if (completed % 500 === 0 || completed === totalCombinations) {
          var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          var pct = ((completed / totalCombinations) * 100).toFixed(1);
          process.stdout.write('\rProgress: ' + completed + '/' + totalCombinations + ' (' + pct + '%) - ' + elapsed + 's');
        }
      }
    }
  }

  console.log(''); // newline after progress

  // Sort by aggregate F1 descending
  results.sort(function(a, b) { return b.aggregateF1 - a.aggregateF1; });

  return results;
}

function generateCombinations(grid) {
  var keys = Object.keys(grid);
  var combos = [{}];

  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var values = grid[key];
    var newCombos = [];

    for (var c = 0; c < combos.length; c++) {
      for (var v = 0; v < values.length; v++) {
        var combo = Object.assign({}, combos[c]);
        combo[key] = values[v];
        newCombos.push(combo);
      }
    }

    combos = newCombos;
  }

  return combos;
}

/**
 * Format sweep results as a human-readable report string.
 */
export function formatReport(results, topN) {
  topN = topN || 10;
  var lines = [];

  lines.push('=== Parameter Sweep Results ===');
  lines.push('Total configurations tested: ' + results.length);
  lines.push('');
  lines.push('Top ' + topN + ' by aggregate F1:');
  lines.push('');

  for (var i = 0; i < Math.min(topN, results.length); i++) {
    var r = results[i];
    var p = r.params;
    lines.push(
      '#' + String(i + 1).padStart(2) +
      '  F1=' + r.aggregateF1.toFixed(3) +
      '  P=' + r.aggregatePrecision.toFixed(3) +
      '  R=' + r.aggregateRecall.toFixed(3) +
      '  sens=' + p.sensitivity +
      ' gate=' + p.noiseGate +
      ' hold=' + p.holdTime +
      ' hps=[' + p.hpsFactors.join(',') + ']' +
      ' smooth=' + p.smoothingTimeConstant +
      ' hyst=' + p.hysteresisRatio
    );
  }

  // Per-scenario breakdown for #1
  if (results.length > 0) {
    lines.push('');
    lines.push('Per-scenario breakdown for #1:');
    var best = results[0];
    var scenarioNames = Object.keys(best.scores);
    for (var s = 0; s < scenarioNames.length; s++) {
      var name = scenarioNames[s];
      var score = best.scores[name];
      lines.push(
        '  ' + name.padEnd(22) +
        ' F1=' + score.f1.toFixed(3) +
        '  P=' + score.precision.toFixed(3) +
        '  R=' + score.recall.toFixed(3)
      );
    }

    lines.push('');
    lines.push('Recommended defaults for dsp.js:');
    var bp = best.params;
    lines.push('  sensitivity=' + bp.sensitivity);
    lines.push('  noiseGate=' + bp.noiseGate);
    lines.push('  holdTime=' + bp.holdTime);
    lines.push('  hpsFactors=[' + bp.hpsFactors.join(',') + ']');
    lines.push('  smoothingTimeConstant=' + bp.smoothingTimeConstant);
    lines.push('  hysteresisRatio=' + bp.hysteresisRatio);
  }

  return lines.join('\n');
}
