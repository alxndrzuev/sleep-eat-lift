"""Общее для тестов: временная папка данных вместо data/.

Тесты не трогают настоящие данные: lib.DATA подменяется на временную папку.
"""
import sys, shutil, tempfile, unittest
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
