"""portal/dataset.js — расчёт DATA из сырых таблиц RAW (общий для портала и приложения).

Запускается в JavaScriptCore macOS (jsc); если его нет — пропуск.
"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
DATASET = ROOT / "portal" / "dataset.js"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def build(raw):
    """Dataset.build(raw) через jsc → DATA (после JSON-круга)."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(f"print(JSON.stringify(Dataset.build({json.dumps(raw, ensure_ascii=False)})));\n")
    r = subprocess.run([str(JSC), str(DATASET), f.name], capture_output=True, text=True, timeout=30)
    Path(f.name).unlink()
    if r.returncode or not r.stdout.strip():
        raise AssertionError(f"jsc: {r.stdout}{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def js(expr):
    """Значение выражения на dataset.js через jsc (после JSON-круга)."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(f"print(JSON.stringify({expr}));\n")
    r = subprocess.run([str(JSC), str(DATASET), f.name], capture_output=True, text=True, timeout=30)
    Path(f.name).unlink()
    if r.returncode or not r.stdout.strip():
        raise AssertionError(f"jsc: {r.stdout}{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def raw(**tables):
    """RAW с пустыми таблицами, кроме переданных (имя без .csv)."""
    import lib
    t = {name: [] for name in lib.SCHEMA}
    t.update({k + ".csv": v for k, v in tables.items()})
    return {"tables": t, "meta": {"plan": {"targets": {}}, "journal": [], "photos_summary": "", "priorities": []},
            "modules": ["photos"], "updated": "2026-11-21"}


@unittest.skipUnless(JSC.exists(), "нет jsc (JavaScriptCore)")
class DatasetTest(unittest.TestCase):
    def test_macros_month_full_days_only(self):
        d = build(raw(nutrition_daily=[
            {"date": "2026-11-01", "kcal": 2000, "protein": 100, "fat": 60, "carbs": 250, "fiber": None},
            {"date": "2026-11-02", "kcal": 900, "protein": 10, "fat": 5, "carbs": 100, "fiber": None},
            {"date": "2026-11-03", "kcal": 2200, "protein": 121, "fat": 70, "carbs": 260, "fiber": None}]))
        self.assertEqual(d["macros_month"], {"2026-11": [110.5, 65.0, 255.0]})
        self.assertEqual(d["kcal"], [["2026-11-01", 2000], ["2026-11-02", 900], ["2026-11-03", 2200]])
        self.assertEqual(d["nutrition"][1], ["2026-11-02", 900, 10, 5, 100])

    def test_workouts_label_overrides_and_walk_dropped(self):
        w = lambda i, sport, start: {"id": i, "date": start[:10], "start": start, "sport": sport, "duration_min": 60,
                                     "strain": None, "avg_hr": None, "max_hr": None, "kcal": 400,
                                     "z0_min": None, "z1_min": None, "z2_min": None, "z3_min": None, "z4_min": None, "z5_min": None}
        r = raw(whoop_workouts=[w("1", "activity", "2026-11-10 20:00"), w("2", "squash", "2026-11-11 20:00"),
                                      w("3", "activity", "2026-11-12 20:00"), w("4", "walking", "2026-11-09 12:00"),
                                      w("5", "weightlifting_msk", "2026-11-08 20:00")],
                      workout_labels=[{"id": "1", "date": "2026-11-10", "start": "2026-11-10 20:00", "label": "strength", "note": None},
                                      {"id": "3", "date": "2026-11-12", "start": "2026-11-12 20:00", "label": "none", "note": None}])
        r["meta"]["plan"]["workouts"] = {"strength": 2, "squash": 2}          # режим «сквош» — сквош в плане
        d = build(r)
        self.assertEqual(d["workouts"], [["2026-11-08 20:00", "strength", 60, 400], ["2026-11-10 20:00", "strength", 60, 400],
                                         ["2026-11-11 20:00", "squash", 60, 400]])
        self.assertEqual([x["kind"] for x in d["whoop_workouts"]], ["strength", "squash", "walk", "walk", "strength"])

    def test_series_skip_empty(self):
        d = build(raw(body=[{"date": "2026-11-01", "weight_kg": 72.5, "waist_cm": None, "bodyfat_pct": None, "note": None},
                            {"date": "2026-11-02", "weight_kg": None, "waist_cm": 81, "bodyfat_pct": None, "note": None}]))
        self.assertEqual(d["weight"], [["2026-11-01", 72.5]])
        self.assertEqual(d["waist"], [["2026-11-02", 81]])

    def test_photo_notes_map_and_meta(self):
        r = raw(photo_notes=[{"date": "2026-07-12", "note": "x"}])
        r["meta"]["priorities"] = [["Самочувствие", "главное"]]
        d = build(r)
        self.assertEqual(d["photo_notes"], {"2026-07-12": "x"})
        self.assertEqual(d["priorities"], [["Самочувствие", "главное"]])
        self.assertEqual(d["modules"], ["photos"])
        self.assertEqual(d["updated"], "2026-11-21")

    def _w(self, i, sport, z=None, start="2026-11-10 20:00"):
        r = {"id": i, "date": start[:10], "start": start, "sport": sport, "duration_min": 60, "strain": None,
             "avg_hr": None, "max_hr": None, "kcal": 400}
        for k in range(6):
            r[f"z{k}_min"] = (z or [None] * 6)[k]
        return r

    def test_cardio_mode_without_squash_plan(self):
        """Без сквоша в плане: вторая категория — кардио; activity — по пульсовым зонам."""
        ws = [self._w("1", "running"), self._w("2", "cycling"), self._w("3", "squash"), self._w("4", "weightlifting_msk"),
              self._w("5", "walking"), self._w("6", "activity", [5, 10, 20, 15, 5, 5]),      # зоны 2–5: 45 из 60 → кардио
              self._w("7", "activity", [30, 20, 5, 5, 0, 0]),                                  # 10 из 60 → другое
              self._w("8", "activity"), self._w("9", "yoga"), self._w("10", "hiit"), self._w("11", "tennis")]
        d = build(raw(whoop_workouts=ws, workout_labels=[{"id": "9", "date": None, "start": None, "label": "squash", "note": None}]))
        kinds = {w["id"]: w["kind"] for w in d["whoop_workouts"]}
        self.assertEqual(kinds, {"1": "cardio", "2": "cardio", "3": "cardio", "4": "strength", "5": "walk", "6": "cardio",
                                 "7": "other", "8": "other", "9": "cardio", "10": "cardio", "11": "cardio"})
        self.assertEqual(d["k2"], {"key": "cardio", "lab": "Кардио", "many": "кардио"})

    def test_squash_mode_with_squash_plan(self):
        """Сквош в плане: категории как раньше."""
        r = raw(whoop_workouts=[self._w("1", "squash"), self._w("2", "running"), self._w("3", "activity", [0, 0, 30, 30, 0, 0])])
        r["meta"]["plan"]["workouts"] = {"strength": 2, "squash": 2}
        d = build(r)
        self.assertEqual({w["id"]: w["kind"] for w in d["whoop_workouts"]}, {"1": "squash", "2": "other", "3": "other"})
        self.assertEqual(d["k2"], {"key": "squash", "lab": "Сквош", "many": "сквоша"})


    def test_food_day_by_macros_deviation(self):
        """День питания — по самому далёкому от цели из Б, Ж, У: зелёный — все в пределах ±15 %, жёлтый — до ±30 %,
        красный — дальше; калории на цвет не влияют. Меньше 1200 ккал — неполный, нет записи — не записал, цели нет — полный."""
        g = {"kcal": 2200, "protein": 120, "fat": 60, "carbs": 270}
        day = lambda k=2200, p=120, f=60, c=270: {"k": k, "p": p, "f": f, "c": c}
        cases = [("ровно", day(), g, "hit"),
                 ("ккал мимо, БЖУ ровно", day(k=3500), g, "hit"),
                 ("Б +15 %", day(p=138), g, "hit"), ("Б −15 %", day(p=102), g, "hit"),
                 ("Б +15,8 %", day(p=139), g, "near"),
                 ("Ж +30 %", day(f=78), g, "near"), ("Ж +31,7 %", day(f=79), g, "miss"),
                 ("У −30 %", day(c=189), g, "near"), ("У −30,4 %", day(c=188), g, "miss"),
                 ("худший решает", day(p=125, f=70, c=150), g, "miss"),
                 ("белка нет в дневнике", day(p=None, f=62), g, "hit"),
                 ("неполный", day(k=1199, p=10), g, "partial"), ("ноль", day(k=0), g, "empty"), ("нет записи", None, g, "empty"),
                 ("цели нет", day(), {"kcal": None, "protein": None, "fat": None, "carbs": None}, "full")]
        got = js("[" + ",".join(f"Dataset.foodDay({json.dumps(d)}, {json.dumps(t)})" for _, d, t, _ in cases) + "]")
        self.assertEqual(dict(zip([n for n, *_ in cases], got)), {n: want for n, _, _, want in cases})

if __name__ == "__main__":
    unittest.main()
