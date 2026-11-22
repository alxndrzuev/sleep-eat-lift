"""scripts/public_check.py: личное из папки данных находится в файлах; настоящий проект — чистый."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import lib  # noqa: E402
import public_check as pc  # noqa: E402


class LeaksTest(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp(prefix="pc-data-"))
        self.repo = Path(tempfile.mkdtemp(prefix="pc-repo-"))
        (self.data / "secrets").mkdir()
        (self.data / "docs").mkdir()
        (self.data / "body.csv").write_text("date,weight_kg,waist_cm,bodyfat_pct,note\n2026-11-10,75.5,80.0,,FatSecret утро\n")
        (self.data / "whoop_workouts.csv").write_text("id,date\n7a8e6852-0000-0000-0000-27513f5103cb,2025-05-01\n")
        (self.data / "secrets" / "whoop.json").write_text(json.dumps({"refresh_token": "rt-SECRET-123456", "expires_at": "2026-11-22T10:00:00Z"}))
        (self.data / "meta.json").write_text(json.dumps({"priorities": [["Вес 99 кг", "без срока, медленно и чисто, талия не растёт"]]}, ensure_ascii=False))
        (self.data / "docs" / "01.md").write_text("Исходная точка: рост 199 см, офис, сквош два раза в неделю с тренером\n")

    def tearDown(self):
        shutil.rmtree(self.data, ignore_errors=True)
        shutil.rmtree(self.repo, ignore_errors=True)

    def check(self, text):
        (self.repo / "f.txt").write_text(text, encoding="utf-8")
        return [k for _, k in pc.leaks(self.repo, ["f.txt"], self.data)]

    def test_finds_each_kind(self):
        self.assertEqual(self.check("x 2026-11-10,75.5,80.0,,FatSecret утро y"), ["строка body.csv"])
        self.assertEqual(self.check("id 7a8e6852-0000-0000-0000-27513f5103cb"), ["id тренировки Whoop"])
        self.assertEqual(self.check('{"t": "rt-SECRET-123456"}'), ["значение из secrets/whoop.json"])
        self.assertEqual(self.check("без срока, медленно и чисто, талия не растёт"), ["текст из meta.json"])
        self.assertEqual(self.check("Исходная точка: рост 199 см, офис, сквош два раза в неделю с тренером"),
                         ["строка личного документа 01.md"])

    def test_dates_and_clean_text_pass(self):
        self.assertEqual(self.check("2026-11-22T10:00:00Z · date,weight_kg · обычный код"), [])


class ProjectIsPublicTest(unittest.TestCase):
    @unittest.skipUnless((lib.DATA / "secrets").exists(), "нет папки данных на этом компьютере")
    def test_no_personal_data_in_project(self):
        found = pc.leaks(lib.ROOT, pc.public_files(lib.ROOT), lib.DATA)
        self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main()
