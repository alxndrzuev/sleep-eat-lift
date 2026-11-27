// Журнал работы SEL: что делало приложение и что пошло не так — для разбора сбоев (пользователем, LLM или разработчиком).
// Папка logs — рядом с папкой данных (Документы/SEL/logs), файл на день: sel-ГГГГ-ММ-ДД.log, хранится keepDays дней.
// В журнал — события, числа и тексты ошибок; не данные (вес, еда, сон) и не ключи: токены, коды и секреты вырезаются (redact).
// Журнал никогда не ломает приложение: не пишется — молчит. До выбора папки данных строки копятся в памяти (setDir пишет их).
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = {info: 'INFO ', warn: 'WARN ', error: 'ERROR'};
const MAX_LINE = 2000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = d => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

/** Папка журнала для папки данных: рядом с ней. */
const dir = dataDir => path.join(path.dirname(dataDir), 'logs');

// ключи OAuth и сервисов: в адресах и формах (name=value), в JSON ("name":"value"), заголовок Authorization
const SECRET = 'oauth_token|oauth_verifier|oauth_signature|oauth_token_secret|oauth_consumer_key|access_token|refresh_token|' +
  'id_token|client_secret|client_id|consumer_secret|code|state|secret|password|token';
const RE_PAIR = new RegExp(`\\b(${SECRET})=[^&\\s"',;)]+`, 'gi');
const RE_JSON = new RegExp(`"(${SECRET})"\\s*:\\s*"[^"]*"`, 'gi');
const RE_BEARER = /\b(Bearer|OAuth)\s+[^\s"',]+/g;
/** Вырезать ключи доступа из текста. */
const redact = s => String(s).replace(RE_PAIR, '$1=…').replace(RE_JSON, '"$1":"…"').replace(RE_BEARER, '$1 …');

function value(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return /^[^\s"=]+$/.test(v) ? v : JSON.stringify(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

/** Одна строка журнала: время, уровень, событие, текст ошибки, поля name=value. */
function format(at, level, msg, fields = {}, err = null) {
  let s = `${stamp(at)} ${LEVELS[level] || LEVELS.info} ${msg}`;
  if (err) s += ': ' + (err.message || String(err));
  for (const [k, v] of Object.entries(fields || {})) if (v !== undefined && v !== null && v !== '') s += ` ${k}=${value(v)}`;
  s = redact(s.replace(/[\r\n]+/g, ' '));
  return s.length > MAX_LINE ? s.slice(0, MAX_LINE) + '…' : s;
}

/** Журнал: {setDir(папка), info/warn/error(событие, [ошибка], [поля]), crash(событие, ошибка) — со стеком, dir()}. */
function create({now = () => new Date(), keepDays = 30, maxBytes = 5 * 1024 * 1024} = {}) {
  let folder = null, curDay = null, size = 0, full = false;
  const early = [];                                        // строки до setDir: [день, текст]

  function prune() {
    const cut = new Date(now()); cut.setDate(cut.getDate() - keepDays);
    const min = `sel-${day(cut)}.log`;
    for (const f of fs.readdirSync(folder)) if (/^sel-\d{4}-\d{2}-\d{2}\.log$/.test(f) && f < min) fs.rmSync(path.join(folder, f), {force: true});
  }

  function write(d, text) {
    if (!folder) { if (early.length < 1000) early.push([d, text]); return; }
    try {
      const file = path.join(folder, `sel-${d}.log`);
      if (d !== curDay) {
        curDay = d; full = false;
        size = fs.existsSync(file) ? fs.statSync(file).size : 0;
        prune();
      }
      if (full) return;
      if (size + text.length > maxBytes) {
        full = true;
        text = `${stamp(now())} WARN  журнал за день слишком большой — дальше до завтра не пишется\n`;
      }
      fs.appendFileSync(file, text);
      size += Buffer.byteLength(text);
    } catch (e) {}                                       // журнал не пишется — приложение работает дальше
  }

  function line(level, msg, a, b) {
    const err = a instanceof Error ? a : null, fields = err ? b : a;
    const t = now();
    write(day(t), format(t, level, msg, fields, err) + '\n');
  }

  return {
    setDir(d) {
      try { fs.mkdirSync(d, {recursive: true}); folder = d; curDay = null; }
      catch (e) { folder = null; early.length = 0; return; }
      for (const [dd, text] of early.splice(0)) write(dd, text);
    },
    dir: () => folder,
    info: (msg, a, b) => line('info', msg, a, b),
    warn: (msg, a, b) => line('warn', msg, a, b),
    error: (msg, a, b) => line('error', msg, a, b),
    /** Необработанная ошибка — со стеком (первые строки). */
    crash(msg, err) {
      const t = now(), stack = String((err && err.stack) || err).split('\n').slice(1, 9).map(s => '    ' + redact(s.trim())).join('\n');
      write(day(t), format(t, 'error', msg, {}, err instanceof Error ? err : new Error(String(err))) + (stack ? '\n' + stack : '') + '\n');
    },
  };
}

module.exports = {create, dir, redact, format};
