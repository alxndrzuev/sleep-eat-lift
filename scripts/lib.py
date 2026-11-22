"""Общее для скриптов и тестов: папка данных, схема CSV, чтение/запись, meta.json.

Только стандартная библиотека Python. Импорт из скрипта в scripts/:  `from lib import read, write, ...`
"""
import csv, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_CONFIG = Path.home() / "Library" / "Application Support" / "SEL" / "config.json"   # настройки приложения desktop/


def find_data(env=os.environ, config=APP_CONFIG):
    """Папка данных: HEALTH_DATA → папка, выбранная в приложении SEL (config.json → dataDir) → data/ проекта."""
    if env.get("HEALTH_DATA"):
        return Path(env["HEALTH_DATA"])
    try:
        d = Path(json.loads(Path(config).read_text(encoding="utf-8"))["dataDir"])
        if d.exists():
            return d
    except (OSError, ValueError, KeyError):
        pass
    return ROOT / "data"


DATA = find_data()              # всё личное: CSV, meta.json, photos/, secrets/, logs/, inbox/ (docs/07_формат_данных.md)
SECRETS = DATA / "secrets"

# Схема всех CSV в data/ — единственное место, где перечислены колонки (описание — docs/07_формат_данных.md)
SCHEMA = {
    "nutrition_daily.csv": ["date", "kcal", "protein", "fat", "carbs", "fiber"],
    "body.csv": ["date", "weight_kg", "waist_cm", "bodyfat_pct", "note"],
    "whoop_daily.csv": ["date", "recovery", "hrv", "rhr", "spo2", "skin_temp", "strain", "kcal", "steps", "sleep_h", "deep_h",
                        "rem_h", "light_h", "awake_h", "sleep_perf", "sleep_eff", "resp_rate", "bed", "wake", "note"],
    "whoop_workouts.csv": ["id", "date", "start", "sport", "duration_min", "strain", "avg_hr", "max_hr", "kcal",
                           "z0_min", "z1_min", "z2_min", "z3_min", "z4_min", "z5_min"],
    "alcohol_check.csv": ["date", "hrv_dev_pct", "rhr_dev", "temp_dev", "strength", "kind", "status", "note"],
    "targets.csv": ["start", "kcal", "protein", "fat", "carbs", "note"],
    "goal_weight.csv": ["date", "goal_weight_kg", "note"],
    "checkins.csv": ["date", "feel", "energy", "stress", "sleep_quality", "note"],
    "events.csv": ["start", "end", "type", "description", "level"],   # level — алкоголь: мало / умеренно / много
    "supplements.csv": ["start", "end", "name", "dose", "timing", "purpose", "note"],
    "labs.csv": ["date", "marker", "value", "unit", "ref_low", "ref_high", "note"],
    "photo_notes.csv": ["date", "note"],
    "workout_labels.csv": ["id", "date", "start", "label", "note"],
}
# ключ уникальности (по умолчанию date) и сортировки (по умолчанию = ключ)
KEY = {"whoop_workouts.csv": "id", "workout_labels.csv": "id", "targets.csv": "start", "events.csv": "start", "supplements.csv": "start"}
SORT = {"whoop_workouts.csv": "start", "workout_labels.csv": "start"}

# текстовые колонки CSV (остальные — числа); копия — desktop/schema.json → text
TEXT = {"date", "start", "end", "note", "bed", "wake", "id", "sport", "strength", "kind", "status", "name",
        "dose", "timing", "purpose", "marker", "unit", "type", "description", "label", "level"}
FULL_DAY_KCAL = 1200        # дни в FatSecret меньше — «не заполнен», в средние не идут


# ---------- CSV ----------

def read(name):
    """CSV из data/ → список словарей (пустой список, если файла нет). Проверяет заголовок."""
    p = DATA / name
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        cols = SCHEMA.get(name)
        if cols and r.fieldnames != cols:
            # новые колонки добавляются только в конец: старый файл без них читается (пустыми), при записи они появятся
            if not r.fieldnames or r.fieldnames != cols[:len(r.fieldnames)]:
                raise SystemExit(f"ОШИБКА: {name}: заголовок {r.fieldnames}, ожидался {cols}")
            return [dict(row, **{c: "" for c in cols[len(r.fieldnames):]}) for row in r]
        return list(r)


def by(name):
    """CSV → {ключ: строка} (ключ — KEY[name] или date)."""
    k = KEY.get(name, "date")
    return {r[k]: r for r in read(name)}


def write(name, rows):
    """Перезаписать CSV: колонки по схеме, сортировка (SORT/KEY/date), переводы строк LF."""
    k = SORT.get(name) or KEY.get(name, "date")
    cols = SCHEMA[name]
    rows = sorted(rows, key=lambda r: (r.get(k) or ""))
    with open(DATA / name, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: "" if r.get(c) is None else r.get(c) for c in cols})


def upsert(name, new):
    """new: {ключ: {колонка: значение}} → обновить/добавить строки (None не затирает). → (добавлено, обновлено, всего)."""
    k = KEY.get(name, "date")
    cur = by(name)
    added = updated = 0
    for kv, vals in new.items():
        row = cur.get(kv)
        fresh = row is None
        if fresh:
            row = cur[kv] = {c: "" for c in SCHEMA[name]} | {k: kv}
            added += 1
        changed = False
        for c, v in vals.items():
            if v is None or c not in SCHEMA[name]:
                continue
            v = fmt_num(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v)
            if row.get(c) != v:
                row[c], changed = v, True
        updated += changed and not fresh
    write(name, cur.values())
    return added, updated, len(cur)


def fmt_num(x, dg=2):
    """Число для CSV: без лишних нулей (72.0 → 72, 72.50 → 72.5)."""
    x = round(float(x), dg)
    return str(int(x)) if x.is_integer() else f"{x:g}"


META_EMPTY = {"plan": {"version": "", "targets": {}, "rows": [], "notes": [], "goodWeek": []},
              "journal": [], "photos_summary": "", "priorities": []}


def meta():
    """data/meta.json — план, «хорошая неделя», журнал, вывод по фото (для портала); нет файла → пустые значения."""
    p = DATA / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else json.loads(json.dumps(META_EMPTY))
