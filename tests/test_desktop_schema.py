"""desktop/schema.json — копия схемы CSV из scripts/lib.py для приложения; расхождение — ошибка."""
import json, unittest
from helpers import lib, ROOT


class DesktopSchemaTest(unittest.TestCase):
    def test_same_as_lib(self):
        s = json.loads((ROOT / "desktop" / "schema.json").read_text(encoding="utf-8"))
        self.assertEqual(s["schema"], lib.SCHEMA)
        self.assertEqual(s["key"], lib.KEY)
        self.assertEqual(s["sort"], lib.SORT)
        self.assertEqual(s["text"], sorted(lib.TEXT))
        self.assertEqual(s["full_day_kcal"], lib.FULL_DAY_KCAL)


if __name__ == "__main__":
    unittest.main()
