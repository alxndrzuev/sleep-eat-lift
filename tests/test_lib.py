"""lib.py: чтение/запись CSV, upsert, форматирование чисел, meta.json, папка данных."""
import json, unittest
from pathlib import Path
from helpers import TempData, lib


class CsvTest(TempData):
    def test_write_sorts_orders_columns_and_uses_lf(self):
        lib.write("body.csv", [{"note": "b", "date": "2026-02-01", "weight_kg": "71"}, {"date": "2026-01-01", "waist_cm": "80"}])
        raw = (self.tmp / "body.csv").read_bytes()
        self.assertNotIn(b"\r", raw)
        lines = raw.decode().splitlines()
        self.assertEqual(lines[0], "date,weight_kg,waist_cm,bodyfat_pct,note")
        self.assertEqual(lines[1], "2026-01-01,,80,,")
        self.assertEqual(lines[2], "2026-02-01,71,,,b")

    def test_read_rejects_wrong_header(self):
        (self.tmp / "body.csv").write_text("date,weight\n2026-01-01,70\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            lib.read("body.csv")

    def test_upsert_counts_and_keeps_other_columns(self):
        lib.write("body.csv", [{"date": "2026-01-01", "weight_kg": "70", "waist_cm": "80", "note": "x"}])
        added, updated, total = lib.upsert("body.csv", {"2026-01-01": {"weight_kg": 70.5, "waist_cm": None},
                                                        "2026-01-02": {"weight_kg": 71.0}})
        self.assertEqual((added, updated, total), (1, 1, 2))
        rows = lib.by("body.csv")
        self.assertEqual(rows["2026-01-01"]["waist_cm"], "80")       # None не затирает
        self.assertEqual(rows["2026-01-01"]["note"], "x")
        self.assertEqual(rows["2026-01-02"]["weight_kg"], "71")      # 71.0 → 71

    def test_upsert_unchanged_is_not_counted(self):
        lib.write("nutrition_daily.csv", [{"date": "2026-01-01", "kcal": "2000"}])
        self.assertEqual(lib.upsert("nutrition_daily.csv", {"2026-01-01": {"kcal": 2000.0}}), (0, 0, 1))

    def test_workouts_keyed_by_id_sorted_by_start(self):
        lib.upsert("whoop_workouts.csv", {"b": {"start": "2026-01-02 20:00"}, "a": {"start": "2026-01-03 20:00"}})
        self.assertEqual([r["id"] for r in lib.read("whoop_workouts.csv")], ["b", "a"])


class FormatTest(unittest.TestCase):
    def test_fmt_num(self):
        self.assertEqual(lib.fmt_num(72.0), "72")
        self.assertEqual(lib.fmt_num(107.66), "107.66")


class PersonalDataTest(TempData):
    """Всё личное — в data/; программа (portal/, scripts/) его не содержит — её можно отдать другому человеку."""

    def test_program_folders_have_no_personal_files(self):
        for rel in ("secrets", "logs", "inbox", "portal/meta.json"):
            self.assertFalse((lib.ROOT / rel).exists(), f"{rel} должно лежать в data/")

    def test_meta_read_from_data(self):
        (self.tmp / "meta.json").write_text('{"plan": {"targets": {"sleep": 8}}, "journal": [{"week": "x"}]}', encoding="utf-8")
        m = lib.meta()
        self.assertEqual(m["plan"]["targets"]["sleep"], 8)
        self.assertEqual(m["journal"], [{"week": "x"}])

    def test_meta_missing_gives_empty_plan(self):
        m = lib.meta()                                   # во временной data/ meta.json нет
        self.assertEqual(m["plan"]["targets"], {})
        self.assertEqual(m["plan"]["rows"], [])
        self.assertEqual(m["journal"], [])


if __name__ == "__main__":
    unittest.main()


class SchemaEvolutionTest(TempData):
    """Новые колонки добавляются только в конец: старый файл без них читается, при записи колонка появляется."""

    def test_old_events_without_level(self):
        (self.tmp / "events.csv").write_text("start,end,type,description\n2026-11-10,2026-11-10,алкоголь,вино\n", encoding="utf-8")
        rows = lib.read("events.csv")
        self.assertEqual(rows, [{"start": "2026-11-10", "end": "2026-11-10", "type": "алкоголь", "description": "вино", "level": ""}])
        lib.write("events.csv", rows)
        self.assertTrue((self.tmp / "events.csv").read_text(encoding="utf-8").startswith("start,end,type,description,level\n"))

    def test_other_header_still_rejected(self):
        (self.tmp / "events.csv").write_text("start,type\n2026-11-10,алкоголь\n", encoding="utf-8")
        with self.assertRaises(SystemExit):
            lib.read("events.csv")


class DataLocationTest(unittest.TestCase):
    """Папка данных: HEALTH_DATA → папка из настроек приложения SEL → data/ проекта."""

    def test_env_first(self):
        self.assertEqual(lib.find_data(env={"HEALTH_DATA": "/x/data"}, config=Path("/nope.json")), Path("/x/data"))

    def test_app_config(self):
        import tempfile
        d = Path(tempfile.mkdtemp())
        (d / "data").mkdir()
        cfg = d / "config.json"
        cfg.write_text(json.dumps({"dataDir": str(d / "data")}), encoding="utf-8")
        self.assertEqual(lib.find_data(env={}, config=cfg), d / "data")
        cfg.write_text(json.dumps({"dataDir": str(d / "пропала")}), encoding="utf-8")
        self.assertEqual(lib.find_data(env={}, config=cfg), lib.ROOT / "data")

    def test_secrets_inside_data(self):
        self.assertEqual(lib.SECRETS, lib.DATA / "secrets")
