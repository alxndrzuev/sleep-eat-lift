"""portal/whatsnew.js — вёрстка заметок «Что нового» (jsc; без него — пропуск) и подключение на всех страницах."""
import json, subprocess, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "portal" / "whatsnew.js"
NAV = ROOT / "portal" / "nav.js"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
PAGES = ("dashboard.html", "nutrition.html", "training.html", "recovery.html", "photos.html", "settings.html", "whatsnew.html")


def run(expr):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(f"print(JSON.stringify({expr}));\n")
    r = subprocess.run([str(JSC), str(NAV), str(JS), f.name], capture_output=True, text=True, timeout=20)
    Path(f.name).unlink()
    if r.returncode or not r.stdout.strip():
        raise AssertionError(f"jsc: {r.stdout}{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


@unittest.skipUnless(JSC.exists(), "нет jsc (JavaScriptCore)")
class WhatsNewHtmlTest(unittest.TestCase):
    REL = [{"version": "1.1.0", "date": "2026-12-01", "sections": [{"title": "Новое", "items": ["**Сон** <b>не тег</b> & ко"]}]},
           {"version": "1.0.0", "date": "2026-11-22", "sections": [{"title": "Исправлено", "items": ["Ошибка"]}]}]

    def test_escapes_text_and_keeps_bold(self):
        h = run(f"WhatsNew.html({json.dumps(self.REL)})")
        self.assertIn("<li><b>Сон</b> &lt;b&gt;не тег&lt;/b&gt; &amp; ко</li>", h)

    def test_versions_in_given_order_with_dates(self):
        h = run(f"WhatsNew.html({json.dumps(self.REL)})")
        self.assertLess(h.index("Версия 1.1.0"), h.index("Версия 1.0.0"))
        self.assertIn("1 декабря 2026", h)
        self.assertIn("22 ноября 2026", h)
        self.assertIn("<h4>Исправлено</h4>", h)

    def test_draft_without_date(self):
        h = run('WhatsNew.html([{"version": "Не выпущено", "date": null, "sections": [{"title": "Новое", "items": ["А"]}]}])')
        self.assertIn("Не выпущено (черновик)", h)
        self.assertEqual(run('WhatsNew.date("2026-01-05")'), "5 января 2026")
        self.assertEqual(run("WhatsNew.html([])"), "")


@unittest.skipUnless(JSC.exists(), "нет jsc (JavaScriptCore)")
class WhatsNewBackTest(unittest.TestCase):
    """Крестик страницы истории: назад, туда, откуда пришли."""
    def back(self, last):
        return run(f"WhatsNew.back({json.dumps(last)})")

    def test_back_to_page_we_came_from(self):
        self.assertEqual(self.back("settings.html"), {"href": "settings.html", "title": "Настройки", "history": True})
        self.assertEqual(self.back("recovery.html")["title"], "Восстановление")

    def test_unknown_goes_to_dashboard(self):
        home = {"href": "dashboard.html", "title": "Сводка", "history": False}
        for last in (None, "", "whatsnew.html", "x.html", "https://evil.example/settings.html"):
            with self.subTest(last=last):
                self.assertEqual(self.back(last), home)

    def test_nav_title(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write('print(JSON.stringify([Nav.title("photos.html"), Nav.title("whatsnew.html")]));\n')
        r = subprocess.run([str(JSC), str(NAV), f.name], capture_output=True, text=True, timeout=20)
        Path(f.name).unlink()
        self.assertEqual(json.loads(r.stdout.strip().splitlines()[-1]), ["Фото", None])


class WhatsNewPagesTest(unittest.TestCase):
    def test_history_page_has_close_and_esc(self):
        h = (ROOT / "portal" / "whatsnew.html").read_text(encoding="utf-8")
        self.assertIn('class="close" id="back"', h)
        self.assertIn('aria-label="Закрыть"', h)
        self.assertNotIn('id="nav"', h)                     # только крестик: меню разделов на этой странице нет
        self.assertIn("WhatsNew.back(last)", h)
        self.assertIn('sessionStorage.setItem("navLast", cur)', (ROOT / "portal" / "nav.js").read_text(encoding="utf-8"))
        self.assertIn("'Escape'", h)


    def test_every_page_loads_whatsnew_after_nav(self):
        for p in PAGES:
            with self.subTest(page=p):
                h = (ROOT / "portal" / p).read_text(encoding="utf-8")
                self.assertIn('<script src="whatsnew.js"></script>', h)
                self.assertLess(h.index('<script src="nav.js"></script>'), h.index('<script src="whatsnew.js"></script>'))

    def test_settings_links_history(self):
        self.assertIn('href="whatsnew.html"', (ROOT / "portal" / "settings.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
