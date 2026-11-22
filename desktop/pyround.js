// round(x, k) как в Python: по точному двоичному значению числа; ровно половина — к чётному.
// toFixed тоже считает по точному значению, но на ровной половине берёт большее — это и поправляем.
function pyRound(x, k = 0) {
  if (x == null || !Number.isFinite(x)) return x;
  let r = Number(x.toFixed(k));
  const s = Math.abs(x).toFixed(Math.min(100, k + 60));
  const tail = s.slice(s.indexOf('.') + 1 + k);
  if (/^50*$/.test(tail)) {                                 // ровно половина: оставить чётную последнюю цифру
    const last = Math.round(Math.abs(r) * 10 ** k);
    if (last % 2 !== 0) r = Number((r - Math.sign(x) * 10 ** -k).toFixed(k));
  }
  return r;
}

module.exports = {pyRound};
