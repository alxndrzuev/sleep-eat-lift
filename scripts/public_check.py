"""Проверка перед коммитом в публичный репозиторий: в файлах проекта нет личного из папки данных.

Ищет в каждом файле, который попадёт в git (отслеживаемые и новые, не игнорируемые; кроме portal/vendor — сторонние
библиотеки с хэшами), строки CSV, id тренировок Whoop, значения из secrets/*.json, текст из meta.json и строки личных
документов data/docs/*.md. Почта автора коммитов — только noreply GitHub.

    python3 scripts/public_check.py            # код выхода 1 — нашлось личное (что и где; значения секретов не печатаются)
"""
import json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib  # noqa: E402

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$")
SKIP = ("portal/vendor/",)


def _strings(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)
    elif isinstance(obj, (str, int, float)) and not isinstance(obj, bool):
        yield str(obj)


def needles(data):
    """{байты: вид} — что не должно встречаться в публичных файлах."""
    out = {}
    data = Path(data)
    for f in sorted(data.glob("*.csv")):
        rows = f.read_text(encoding="utf-8").splitlines()[1:]
        for r in rows:
            if len(r) >= 25:
                out[r.encode()] = f"строка {f.name}"
        if f.name == "whoop_workouts.csv":
            for r in rows:
                i = r.split(",")[0]
                if len(i) >= 12:
                    out[i.encode()] = "id тренировки Whoop"
    for f in sorted((data / "secrets").glob("*.json")):
        try:
            for s in _strings(json.loads(f.read_text(encoding="utf-8"))):
                if len(s) >= 8 and not DATE.match(s) and not s.startswith("http"):
                    out[s.encode()] = f"значение из secrets/{f.name}"
        except ValueError:
            pass
    meta = data / "meta.json"
    if meta.exists():
        for s in _strings(json.loads(meta.read_text(encoding="utf-8"))):
            if len(s) >= 30:
                out[s.encode()] = "текст из meta.json"
    for f in sorted((data / "docs").glob("*.md")):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if len(line) >= 40 and not line.startswith(("|---", "---")):
                out[line.encode()] = f"строка личного документа {f.name}"
    return out


def public_files(root):
    """Файлы, которые попадут в git: отслеживаемые и новые не игнорируемые (кроме сторонних библиотек)."""
    ls = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root,
                        capture_output=True, check=True).stdout.decode().split("\0")
    return [p for p in ls if p and not p.startswith(SKIP) and (Path(root) / p).is_file()]


def leaks(root, files, data):
    """[(файл, вид)] — что из папки данных нашлось в файлах."""
    ns = needles(data)
    out = []
    for p in files:
        buf = (Path(root) / p).read_bytes()
        out += [(p, kind) for n, kind in ns.items() if n in buf]
    return out


def author_ok(root):
    """Почта для коммитов в этом репозитории — noreply GitHub."""
    r = subprocess.run(["git", "config", "user.email"], cwd=root, capture_output=True, text=True)
    return r.stdout.strip().endswith("@users.noreply.github.com")


def main():
    root = lib.ROOT
    if not (lib.DATA / "secrets").exists() and not list(lib.DATA.glob("*.csv")):
        print(f"Папка данных не найдена ({lib.DATA}) — сверять не с чем")
        return 0
    found = leaks(root, public_files(root), lib.DATA)
    for p, kind in found:
        print(f"ЛИЧНОЕ: {p} — {kind}")
    if not author_ok(root):
        print("ЛИЧНОЕ: почта автора коммитов не noreply GitHub — git config user.email <id>+<логин>@users.noreply.github.com")
        found.append(("git config", "почта"))
    if not found:
        print(f"Чисто: {len(public_files(root))} файлов проверено")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
