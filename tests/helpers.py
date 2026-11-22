"""Общее для тестов: временная папка данных вместо data/ и генераторы синтетических строк.

Тесты не трогают настоящие данные: lib.DATA подменяется на временную папку.
"""
import sys, shutil, tempfile, unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import lib  # noqa: E402


class TempData(unittest.TestCase):
    """Тест с пустыми CSV (только заголовки) во временной папке; lib.DATA указывает туда."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="health-test-"))
        self._data = lib.DATA
        lib.DATA = self.tmp
        for name, cols in lib.SCHEMA.items():
            (self.tmp / name).write_text(",".join(cols) + "\n", encoding="utf-8")

    def tearDown(self):
        lib.DATA = self._data
        shutil.rmtree(self.tmp, ignore_errors=True)

    def put(self, name, rows):
        lib.write(name, rows)


def day(offset, base=None):
    """Дата (ISO) со сдвигом от base (по умолчанию — сегодня)."""
    return ((base or date.today()) + timedelta(days=offset)).isoformat()


def whoop_rows(n=40, end=None, hrv=100, rhr=50, sleep=7.5, rec=70, override=None):
    """n дней ровных данных Whoop до end включительно; override: {дата: {поле: значение}}."""
    end = end or date.today()
    out = []
    for i in range(n - 1, -1, -1):
        d = (end - timedelta(days=i)).isoformat()
        r = {"date": d, "recovery": rec, "hrv": hrv, "rhr": rhr, "skin_temp": 34.0, "sleep_h": sleep, "bed": "23:30"}
        r.update((override or {}).get(d, {}))
        out.append({k: str(v) for k, v in r.items()})
    return out
