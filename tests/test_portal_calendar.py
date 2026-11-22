"""Календари портала (.hm) — типовой элемент: подсказка у ячейки только через calTips из common.js.

Своя подсказка внутри прокручиваемого .hm обрезается снизу (нижние ячейки) — так было до 22.11.2026.
"""
import re, unittest
from pathlib import Path

PORTAL = Path(__file__).resolve().parent.parent / "portal"


class CalendarTipsTest(unittest.TestCase):
    def test_common_js_defines_cal_tips(self):
        js = (PORTAL / "common.js").read_text(encoding="utf-8")
        self.assertIn("function calTips(el, html)", js)
        body = js.split("function calTips(el, html)", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("el.parentElement", body)          # подсказка — вне прокрутки
        self.assertIn("rb.top-bb.top-th-g", body)        # над ячейкой, если не влезает снизу

    def test_every_calendar_uses_cal_tips(self):
        pages = {}
        for p in sorted(PORTAL.glob("*.html")):
            html = p.read_text(encoding="utf-8")
            n = len(re.findall(r'class="hm\b', html))
            if n:
                pages[p.name] = n
                self.assertEqual(html.count("calTips("), n, f"{p.name}: календарей {n} — столько же calTips(…)")
                self.assertNotIn("tip.cloneNode", html, f"{p.name}: своя подсказка календаря — только calTips")
        self.assertEqual(pages, {"nutrition.html": 1, "recovery.html": 2, "training.html": 1})


if __name__ == "__main__":
    unittest.main()
