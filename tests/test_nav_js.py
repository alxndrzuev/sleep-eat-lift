"""portal/nav.js — меню портала: пункты по данным (jsc; без него — пропуск)."""
import json, subprocess, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAV = ROOT / "portal" / "nav.js"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def hrefs(data, in_app):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(f"print(JSON.stringify(Nav.items({json.dumps(data)}, {json.dumps(in_app)}).map(x => x[0])));\n")
    r = subprocess.run([str(JSC), str(NAV), f.name], capture_output=True, text=True, timeout=20)
    Path(f.name).unlink()
    if r.returncode or not r.stdout.strip():
        raise AssertionError(f"jsc: {r.stdout}{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


@unittest.skipUnless(JSC.exists(), "нет jsc (JavaScriptCore)")
class NavTest(unittest.TestCase):
    def test_alexander(self):
        self.assertEqual(hrefs({"nutrition": [1], "weight": [], "whoop_daily": [1]}, False),
                         ["dashboard.html", "nutrition.html", "training.html", "recovery.html", "photos.html"])

    def test_fatsecret_only_in_app(self):
        self.assertEqual(hrefs({"nutrition": [], "weight": [1], "whoop_daily": []}, True),
                         ["dashboard.html", "nutrition.html", "photos.html", "settings.html"])

    def test_whoop_only_in_app(self):
        self.assertEqual(hrefs({"nutrition": [], "weight": [], "whoop_daily": [1]}, True),
                         ["dashboard.html", "training.html", "recovery.html", "photos.html", "settings.html"])

    def test_empty_in_app(self):
        self.assertEqual(hrefs({"nutrition": [], "weight": [], "whoop_daily": []}, True),
                         ["dashboard.html", "photos.html", "settings.html"])


if __name__ == "__main__":
    unittest.main()
