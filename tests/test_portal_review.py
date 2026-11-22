"""weekly_review.py (черновик разбора) и страницы портала (общие с приложением desktop/). Ничего не пишет в данные."""
import io, re, json, shutil, subprocess, contextlib, tempfile, unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock
from helpers import TempData, lib, day, whoop_rows, ROOT

import weekly_review


class WeeklyTest(unittest.TestCase):
    def test_runs_on_real_data(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch("sys.argv", ["weekly_review.py", "2026-11-14"]):
            weekly_review.main()
        t = out.getvalue()
        self.assertIn("## Неделя 07.11–13.11", t)
        self.assertIn("```json", t)


from test_dataset_js import build as dataset_build, JSC  # noqa: E402

PAGES = ("dashboard.html", "nutrition.html", "training.html", "recovery.html", "photos.html")
# минимальный data.js для проверки синтаксиса страниц: пустые таблицы по схеме
RAW_JS = "const RAW = " + json.dumps({"tables": {n: [] for n in lib.SCHEMA}, "meta": lib.meta(), "modules": [], "updated": "2026-11-21"}) + ";\n"


class WeeklyUnlabeledTest(TempData):
    """Субботний черновик: неразмеченные тренировки (тип activity) за 2 недели попадают в список."""
    def run_review(self, review):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch("sys.argv", ["weekly_review.py", review]):
            weekly_review.main()
        return out.getvalue()

    def test_lists_activity_in_two_weeks(self):
        self.put("targets.csv", [{"start": "2025-01-01", "kcal": "2100", "protein": "120", "fat": "60", "carbs": "270"}])
        self.put("whoop_workouts.csv", [
            {"id": "a", "date": "2026-11-10", "start": "2026-11-10 20:05", "sport": "activity", "duration_min": "58"},
            {"id": "b", "date": "2026-11-03", "start": "2026-11-03 20:00", "sport": "activity", "duration_min": "40"},
            {"id": "c", "date": "2026-10-20", "start": "2026-10-20 20:00", "sport": "activity", "duration_min": "50"},   # раньше 2 недель
            {"id": "d", "date": "2026-11-12", "start": "2026-11-12 20:00", "sport": "squash", "duration_min": "60"}])
        t = self.run_review("2026-11-14")
        self.assertIn("Неразмеченные тренировки за 2 недели: 2", t)
        self.assertIn("вт 10.11 20:05 (58 мин)", t)
        self.assertNotIn("20.10", t)

    def test_labeled_not_listed_and_counted(self):
        self.put("targets.csv", [{"start": "2025-01-01", "kcal": "2100", "protein": "120", "fat": "60", "carbs": "270"}])
        self.put("whoop_workouts.csv", [{"id": "a", "date": "2026-11-10", "start": "2026-11-10 20:05", "sport": "activity", "duration_min": "58"}])
        self.put("workout_labels.csv", [{"id": "a", "label": "strength"}])
        t = self.run_review("2026-11-14")
        self.assertIn("Неразмеченных тренировок за 2 недели нет", t)
        self.assertIn("Силовые: **1/2**", t)

    def test_none(self):
        self.put("targets.csv", [{"start": "2025-01-01", "kcal": "2100", "protein": "120", "fat": "60", "carbs": "270"}])
        self.assertIn("Неразмеченных тренировок за 2 недели нет", self.run_review("2026-11-14"))


    def test_goal_hit_by_macros_within_15_percent(self):
        """«Цель выполнена» — Б, Ж и У в пределах ±15 % от цели (как зелёный день на «Питании»), калории не влияют."""
        self.put("targets.csv", [{"start": "2025-01-01", "kcal": "2000", "protein": "120", "fat": "60", "carbs": "270"}])
        days = {"07": (2000, 120, 60, 270), "08": (3000, 138, 60, 270), "09": (1500, 120, 51, 230),     # выполнены
                "10": (2000, 139, 60, 270), "11": (2000, 120, 60, 180), "12": (2000, 120, 70, 270),     # мимо
                "13": (1000, 120, 60, 270)}                                                              # неполный
        self.put("nutrition_daily.csv", [{"date": f"2026-11-{d}", "kcal": str(k), "protein": str(p), "fat": str(f),
                                          "carbs": str(c)} for d, (k, p, f, c) in days.items()])
        self.assertIn("цель выполнена: 3 дн.", self.run_review("2026-11-14"))

class PortalTest(unittest.TestCase):
    def page(self, name):
        return (ROOT / "portal" / name).read_text(encoding="utf-8")

    def test_pages_load_assets_in_order(self):
        for p in PAGES[:-1]:
            with self.subTest(page=p):
                h = self.page(p)
                self.assertIn('<link rel="stylesheet" href="common.css">', h)
                order = ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>',
                         '<script src="common.js"></script>']
                self.assertEqual([h.index(x) for x in order], sorted(h.index(x) for x in order))
                self.assertNotRegex(h, r"/\*(COMMON_CSS|COMMON_JS|DATA)\*/")

    def test_photos_page_scripts(self):
        """«Фото»: данные портала, индекс из ../data/photos (пишет сама страница), логика, обработка — по порядку."""
        h = self.page("photos.html")
        order = ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>',
                 '<script src="../data/photos/photos.js"></script>',
                 '<script src="photos_core.js"></script>', '<script src="photos_app.js"></script>']
        self.assertEqual([h.index(s) for s in order], sorted(h.index(s) for s in order))
        self.assertNotIn("photos_data.js", h)

    def test_nav_links_point_to_existing_pages(self):
        """Меню строит nav.js: все страницы подключают его и оставляют пустой <nav id="nav">; ссылки ведут на файлы."""
        for p in PAGES:
            with self.subTest(page=p):
                h = self.page(p)
                self.assertIn('<nav class="nav" id="nav"></nav>', h)
                self.assertLess(h.index('<script src="dataset.js"></script>'), h.index('<script src="nav.js"></script>'))
        for href in re.findall(r'\["([a-z]+\.html)"', self.page("nav.js")):
            with self.subTest(link=href):
                self.assertTrue((ROOT / "portal" / href).exists() or href == "settings.html")

    def test_empty_period_shows_last_workouts(self):
        """«Тренировки за период» не пустеет: при пустом периоде — последняя тренировка и 5 последних."""
        h = self.page("training.html")
        self.assertIn("За период тренировок нет. Последняя —", h)
        self.assertIn("table(all.slice(0,5))", h)

    def test_training_only_on_training_page(self):
        """Тренировки — на отдельной странице; на «Восстановлении» их больше нет, в меню есть ссылка."""
        self.assertNotIn("Тренировки за период", self.page("recovery.html"))
        self.assertNotIn("whoop_workouts", self.page("recovery.html"))
        self.assertIn('"training.html"', self.page("nav.js"))

    def test_page_javascript_parses(self):
        """data.js + common.js + код страницы — синтаксис через JavaScriptCore macOS (osascript); без него — пропуск."""
        if not shutil.which("osascript"):
            self.skipTest("нет osascript")
        data = RAW_JS + "\n" + self.page("dataset.js")
        common = self.page("common.js")
        tmp = Path(tempfile.mkdtemp())
        try:
            for p in PAGES:
                inline = "\n".join(re.findall(r"<script>(.*?)</script>", self.page(p), re.S))
                js = ("" if p == "photos.html" else data + "\n" + common) + "\n" + inline
                f = tmp / "page.js"
                f.write_text(js, encoding="utf-8")
                r = subprocess.run(["osascript", "-l", "JavaScript", "-e",
                                    f'ObjC.import("Foundation"); var s=$.NSString.stringWithContentsOfFileEncodingError("{f}",4,null).js;'
                                    'try{ new Function(s); "ok" } catch(e){ "ERR "+e }'], capture_output=True, text=True, timeout=60)
                with self.subTest(page=p):
                    self.assertEqual(r.stdout.strip(), "ok", r.stdout + r.stderr)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()


class SettingsPageTest(unittest.TestCase):
    def test_settings_page_scripts(self):
        """«Настройки» (только в приложении): данные, расчёт, меню — по порядку; без common.js."""
        h = (ROOT / "portal" / "settings.html").read_text(encoding="utf-8")
        order = ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>', '<script src="nav.js"></script>']
        self.assertEqual([h.index(x) for x in order], sorted(h.index(x) for x in order))
        self.assertIn('<nav class="nav" id="nav"></nav>', h)

