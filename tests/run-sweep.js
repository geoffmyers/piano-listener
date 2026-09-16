// run-sweep.js — Run full parameter sweep and print optimal configurations
import { runSweep, formatReport } from './sweep.js';
import { getAllScenarios } from './scenarios.js';
import { writeFileSync } from 'fs';

console.log('=== Piano Listener Parameter Sweep ===');
console.log('Starting full sweep...');
console.log('');

var scenarios = getAllScenarios();
var results = runSweep(scenarios);

console.log('');
var report = formatReport(results, 10);
console.log(report);

// Save full results as JSON
var jsonPath = 'sweep-results.json';
var topResults = results.slice(0, 100).map(function(r) {
  return { params: r.params, aggregateF1: r.aggregateF1, aggregatePrecision: r.aggregatePrecision, aggregateRecall: r.aggregateRecall, scores: r.scores };
});
writeFileSync(jsonPath, JSON.stringify(topResults, null, 2));
console.log('');
console.log('Top 100 results saved to ' + jsonPath);
