const test = require('node:test');
const assert = require('node:assert');
const {pyRound} = require('../pyround');

test('like Python round', () => {
  // значения сверены с Python 3: round(8.05,1)=8.1, round(96.25,1)=96.2, round(0.125,2)=0.12, round(2.675,2)=2.67,
  // round(67.5)=68, round(48.5)=48, round(33.456,2)=33.46, round(120.25,1)=120.2, round(250.55,1)=250.6
  const cases = [[8.05, 1, 8.1], [96.25, 1, 96.2], [0.125, 2, 0.12], [2.675, 2, 2.67], [67.5, 0, 68], [48.5, 0, 48],
                 [33.456, 2, 33.46], [120.25, 1, 120.2], [250.55, 1, 250.6], [3.5, 2, 3.5], [-2.5, 0, -2]];
  for (const [x, k, want] of cases) assert.strictEqual(pyRound(x, k), want, `${x}, ${k}`);
});
