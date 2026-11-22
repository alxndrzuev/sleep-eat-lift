"""Отрисовка страниц портала в headless Chrome (file://) — только при RENDER=1 и если есть Chrome.

Временная папка: portal → симлинк на настоящий portal/, data/data.js — собирает приложение (desktop/store.js) из CSV.
"""
import json, os, re, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import TempData, lib, ROOT  # noqa: E402
NODE = shutil.which("node") or "/opt/homebrew/bin/node"

CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def data_js(data_dir, today="2026-11-21"):
    """data.js, как его пишет приложение: RAW из CSV папки data_dir (desktop/store.js)."""
    js = "process.stdout.write(JSON.stringify(require(process.argv[1] + '/desktop/store').raw(process.argv[2], process.argv[3])))"
    raw = subprocess.run([NODE, "-e", js, str(ROOT), str(data_dir), today], capture_output=True, text=True, check=True, timeout=60).stdout
    return "const RAW = " + raw + ";\n"


def render(base, page):
    r = subprocess.run([str(CHROME), "--headless=new", "--disable-gpu", "--virtual-time-budget=4000", "--dump-dom",
                        (base / "portal" / page).as_uri()], capture_output=True, text=True, timeout=60)
    return re.sub(r"<(script|style)\b.*?</\1>", "", r.stdout, flags=re.S)   # только отрисованное, без кода страницы


@unittest.skipUnless(os.environ.get("RENDER") == "1" and CHROME.exists() and Path(NODE).exists(), "RENDER=1, Chrome и node")
class PagesRenderTest(TempData):
    def setUp(self):
        super().setUp()
        self.base = Path(tempfile.mkdtemp(prefix="portal-render-"))
        (self.base / "portal").symlink_to(ROOT / "portal")
        (self.base / "data").mkdir()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)
        super().tearDown()

    def page(self, name):
        (self.base / "data" / "data.js").write_text(data_js(self.tmp), encoding="utf-8")
        return render(self.base, name)

    def fatsecret(self):
        self.put("nutrition_daily.csv", [{"date": f"2026-11-{d:02d}", "kcal": "2100", "protein": "120", "fat": "60",
                                          "carbs": "250"} for d in range(1, 21)])
        self.put("body.csv", [{"date": "2026-11-10", "weight_kg": "75.5"}, {"date": "2026-11-20", "weight_kg": "75.8"}])
        self.put("goal_weight.csv", [{"date": "2026-11-01", "goal_weight_kg": "80"}])
        self.put("targets.csv", [{"start": "2026-11-01", "kcal": "2200", "protein": "130", "fat": "70", "carbs": "260"}])

    def test_fatsecret_only_dashboard(self):
        self.fatsecret()
        dom = self.page("dashboard.html")
        self.assertIn('href="nutrition.html"', dom)
        self.assertNotIn('href="training.html"', dom)
        self.assertNotIn("Recovery", dom)
        self.assertNotIn('class="chip"', dom)     # приоритеты — только из meta.json, а его нет
        self.assertNotIn("/ 8", dom)
        for card in ("supps", "events", "labs", "journal", "plan", "good"):       # пустые блоки скрыты
            self.assertRegex(dom, rf'id="card-{card}"[^>]*hidden', card)
        self.assertRegex(dom, r'id="prio"[^>]*hidden')
        self.assertIn("цель 80", dom)
        self.assertIn("цель 2", dom)          # калории: «цель 2 200» из targets.csv

    def test_whoop_only_dashboard(self):
        self.put("whoop_daily.csv", [{"date": f"2026-11-{d:02d}", "recovery": "60", "hrv": "70", "rhr": "55",
                                      "sleep_h": "7.5", "steps": "8000"} for d in range(1, 21)])
        dom = self.page("dashboard.html")
        self.assertIn('href="training.html"', dom)
        self.assertNotIn('href="nutrition.html"', dom)
        self.assertNotIn("Калории", dom)
        self.assertNotIn("Подключите", dom)

    def test_cardio_on_training_page_without_squash_plan(self):
        """Знакомые (в плане нет сквоша): на «Тренировках» — «Кардио», сквоша нет."""
        self.put("whoop_daily.csv", [{"date": f"2026-11-{d:02d}", "recovery": "60", "hrv": "70", "rhr": "55"} for d in range(1, 21)])
        self.put("whoop_workouts.csv", [{"id": "1", "date": "2026-11-10", "start": "2026-11-10 19:00", "sport": "running", "duration_min": "45"},
                                        {"id": "2", "date": "2026-11-12", "start": "2026-11-12 19:00", "sport": "weightlifting_msk", "duration_min": "60"}])
        dom = self.page("training.html")
        self.assertIn("Кардио", dom)
        self.assertNotIn("Сквош", dom)
        self.assertNotIn("план 2", dom)

    def test_empty_dashboard(self):
        dom = self.page("dashboard.html")
        self.assertIn("Подключите FatSecret или Whoop", dom)
        self.assertIn("[hidden]{display:none!important}", (ROOT / "portal" / "common.css").read_text(encoding="utf-8"))

    def test_nutrition_without_targets(self):
        """У нового пользователя целей поначалу нет (targets.csv пуст) — «Питание» всё равно рисуется и не падает."""
        self.fatsecret()
        self.put("targets.csv", [])
        dom = self.page("nutrition.html")
        self.assertGreaterEqual(dom.count("<svg"), 3)
        self.assertNotIn("цель null", dom)
        self.assertIn("ккал", dom)
        for lab in ("Выполнил", "Рядом с целью", "Мимо цели"):      # без целей не с чем сравнивать
            self.assertNotIn(lab, dom)
        self.assertNotIn("смена цели", dom)

    def test_nutrition_with_target_set_today(self):
        """Цель задана сегодня, а дневник ведётся давно — история не обрезается по дате первой цели."""
        self.fatsecret()
        self.put("targets.csv", [{"start": "2026-11-21", "kcal": "2100", "protein": "120", "fat": "60", "carbs": "270"}])
        dom = self.page("nutrition.html")
        self.assertNotIn("0 дней", dom)
        self.assertNotIn("NaN", dom)
        self.assertIn("14 дней", dom)

    def test_goals_under_calendar(self):
        """Под календарём — цели последних 2 недель (9–22 нояб при «сегодня» 21.11): смена — две строки, одинаковые — одна."""
        self.fatsecret()
        t = lambda d, k, p: {"start": d, "kcal": str(k), "protein": str(p), "fat": "60", "carbs": "270"}
        self.put("targets.csv", [t("2026-10-01", 2100, 120), t("2026-11-18", 2300, 140)])
        dom = self.page("nutrition.html")
        self.assertIn("Цели за эти 2 недели", dom)
        self.assertIn("2&nbsp;300", dom)
        self.assertNotIn("История целей", dom)
        self.put("targets.csv", [t("2026-10-01", 2100, 120), t("2026-11-18", 2100, 120)])
        dom = self.page("nutrition.html")
        self.assertIn("Цель по питанию", dom)
        self.assertIn("с 1 окт", dom)

    def test_dashboard_without_targets(self):
        self.fatsecret()
        self.put("targets.csv", [])
        self.assertGreaterEqual(self.page("dashboard.html").count("<svg"), 2)

    def test_empty_nutrition(self):
        self.assertIn("Подключите FatSecret или Whoop", self.page("nutrition.html"))

    # текст из CSV и от сервисов (заметки, вид спорта) выводится как текст, а не как разметка
    TAG = '<img src="x" id="injected">'

    def test_escaped_dashboard_events_and_supplements(self):
        self.put("events.csv", [{"start": "2026-11-15", "end": "2026-11-15", "type": "болезнь", "description": self.TAG}])
        self.put("supplements.csv", [{"name": self.TAG, "start": "2026-11-01"}])
        self.put("body.csv", [{"date": "2026-11-10", "weight_kg": "75.5"}])
        dom = self.page("dashboard.html")
        self.assertNotIn(self.TAG, dom)
        self.assertIn("&lt;img", dom)

    def test_escaped_training_sport_name(self):
        self.put("whoop_daily.csv", [{"date": f"2026-11-{d:02d}", "recovery": "60", "hrv": "70", "rhr": "55"} for d in range(1, 21)])
        self.put("whoop_workouts.csv", [{"id": "1", "date": "2026-11-18", "start": "2026-11-18 19:00", "sport": self.TAG,
                                         "duration_min": "45"}])
        dom = self.page("training.html")
        self.assertNotIn(self.TAG, dom)
        self.assertIn("&lt;img", dom)


@unittest.skipUnless(os.environ.get("RENDER") == "1" and CHROME.exists(), "RENDER=1 и Chrome")
class OwnerRenderTest(unittest.TestCase):
    def test_owner_unchanged(self):
        """Настоящая папка данных владельца: приоритеты, цель по тренировкам, все пункты меню на месте."""
        meta_file = Path(lib.DATA) / "meta.json"
        if not meta_file.exists():
            self.skipTest("нет папки данных с meta.json")
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        base = Path(tempfile.mkdtemp(prefix="portal-owner-"))       # настоящие данные — только читаем (lib.DATA)
        (base / "portal").symlink_to(ROOT / "portal")
        (base / "data").mkdir()
        (base / "data" / "data.js").write_text(data_js(lib.DATA), encoding="utf-8")
        dom = render(base, "dashboard.html")
        shutil.rmtree(base, ignore_errors=True)
        for title, _ in meta.get("priorities", []):
            self.assertIn(title, dom)
        if meta.get("plan", {}).get("workouts", {}).get("strength"):
            self.assertIn(f"/ {meta['plan']['workouts']['strength'] * 4}", dom)
        self.assertIn('href="training.html"', dom)
        self.assertIn("<h2>Текущий план", dom)


if __name__ == "__main__":
    unittest.main()
