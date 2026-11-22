"""Настоящие данные в data/: формат файлов (только чтение, ничего не меняет)."""
import re, unittest
from helpers import lib, ROOT


class RealDataTest(unittest.TestCase):
    def test_every_csv_matches_schema(self):
        files = {p.name for p in lib.DATA.glob("*.csv")}
        self.assertEqual(files - set(lib.SCHEMA), set(), "CSV без схемы в lib.SCHEMA")
        for name in files:
            with self.subTest(name=name):
                lib.read(name)   # SystemExit, если заголовок не совпал

    def test_no_crlf_and_valid_dates(self):
        for p in lib.DATA.glob("*.csv"):
            with self.subTest(name=p.name):
                self.assertNotIn(b"\r", p.read_bytes())
                key = "start" if "start" in lib.SCHEMA[p.name] else "date"
                for r in lib.read(p.name):
                    self.assertRegex(r[key], r"^\d{4}-\d{2}-\d{2}")

    def test_numbers_parse(self):
        """Числовые колонки (все, кроме lib.TEXT) — числа: иначе data.js приложения не соберётся."""
        for name in lib.SCHEMA:
            for i, r in enumerate(lib.read(name), start=2):
                for c, v in r.items():
                    if c not in lib.TEXT and (v or "").strip():
                        with self.subTest(name=name, line=i, col=c):
                            float(v.replace(",", "."))

    def test_unique_keys(self):
        for name in ("nutrition_daily.csv", "whoop_daily.csv", "body.csv", "alcohol_check.csv", "checkins.csv", "whoop_workouts.csv"):
            with self.subTest(name=name):
                k = lib.KEY.get(name, "date")
                keys = [r[k] for r in lib.read(name)]
                self.assertEqual(len(keys), len(set(keys)))

    def test_alcohol_statuses(self):
        for r in lib.read("alcohol_check.csv"):
            self.assertIn(r["status"], ("?", "да", "нет"))

    def test_targets_sane(self):
        for r in lib.read("targets.csv"):
            k, p, f, c = (float(r[x]) for x in ("kcal", "protein", "fat", "carbs"))
            self.assertLess(abs(p * 4 + f * 9 + c * 4 - k), 150, f"цель {r['start']}: БЖУ не сходятся с ккал")


if __name__ == "__main__":
    unittest.main()
