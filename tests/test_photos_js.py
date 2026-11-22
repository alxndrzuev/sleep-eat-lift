"""portal/photos_core.js — чистая логика страницы «Фото» (разбор имён, позы, медианы, выравнивание, данные страницы).

Запускается во встроенном в macOS JavaScriptCore (jsc); если его нет — тесты пропускаются.
"""
import json, math, subprocess, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "portal" / "photos_core.js"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")

# опорные точки снимка (пиксели, y вниз): силуэт макушка 100 — подошвы 4400 → 4300 px = FRAME.HS → масштаб 1
KP = {"w": 1000, "h": 4600, "head": [520, 300], "neck": [520, 800], "root": [520, 1800], "ankle": [520, 4200],
      "feet": [440, 600], "crown": [520, 100], "sole": [520, 4400], "cx": 530}          # ось тела вертикальна — без поворота
NOSIL = {k: v for k, v in KP.items() if k not in ("crown", "sole", "cx")}
MED = {"rN": {"front": 1.1}, "rT": {"front": 3.3}, "offA": {"front": 0.05}, "offR": {"front": 0.5},
       "all": {"rN": 1.12, "rT": 3.4, "offA": 0.04, "offR": 0.5}}


def mask(w, h, rects):
    """Маска фигуры w×h (0/1) из прямоугольников (x0, y0, x1, y1), границы включительно."""
    m = [0] * (w * h)
    for x0, y0, x1, y1 in rects:
        for y in range(y0, y1 + 1):
            m[y * w + x0:y * w + x1 + 1] = [1] * (x1 - x0 + 1)
    return m


# фигура 100×200: голова, корпус, ноги, стопы; слева — поднятая рука с кулаком выше головы
BODY = [(45, 10, 55, 30), (40, 30, 60, 110), (44, 110, 56, 175), (40, 175, 62, 180), (15, 2, 22, 8), (18, 8, 24, 40)]
MKP = {"head": [50, 20], "neck": [50, 32], "root": [50, 105], "ankle": [50, 172], "feet": [42, 60]}

# шаблон позы в кадре (y): макушка … подошвы = 4300 px; снимок = шаблон × k + o (k — пикселей снимка на пиксель кадра)
TPL = {"crown": 750, "eyes": 1030, "ears": 1060, "neck": 1520, "root": 2780, "knees": 3830, "ankle": 4870, "heels": 4950, "sole": 5050}


def synth(k, o, x=2000, drop=(), shift=None):
    """Опорные точки снимка из шаблона; drop — каких нет, shift — {точка: сдвиг по y в пикселях снимка}."""
    y = {n: k * v + o + (shift or {}).get(n, 0) for n, v in TPL.items()}
    pt = lambda n: None if n in drop else [x, y[n]]
    return {"w": 4000, "h": 7000, "head": [x, k * 1045 + o], "neck": pt("neck"), "root": pt("root"), "ankle": pt("ankle"),
            "feet": [x - 100, x + 100], "crown": pt("crown"), "sole": pt("sole"), "cx": x,
            "pts": {"eyes": pt("eyes"), "ears": pt("ears"), "knees": pt("knees"), "heels": pt("heels")}}


def apply(t, p):
    """Матрица canvas (a…f) к точке снимка → точка кадра."""
    return [t["a"] * p[0] + t["c"] * p[1] + t["e"], t["b"] * p[0] + t["d"] * p[1] + t["f"]]


def js(expr):
    """Вычислить выражение после загрузки photos_core.js → значение из JSON."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(f"print(JSON.stringify({expr}));\n")
    r = subprocess.run([str(JSC), str(CORE), f.name], capture_output=True, text=True, timeout=20)
    Path(f.name).unlink()
    if r.returncode or not r.stdout.strip():
        raise AssertionError(f"jsc: {r.stdout}{r.stderr}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def lm(points, vis=1.0):
    """33 точки MediaPipe (нормированные, все невидимые), кроме points: {индекс: (x, y)}."""
    out = [{"x": 0, "y": 0, "visibility": 0.0} for _ in range(33)]
    for i, (x, y) in points.items():
        out[i] = {"x": x, "y": y, "visibility": vis}
    return json.dumps(out)


@unittest.skipUnless(JSC.exists(), "нет jsc (JavaScriptCore)")
class PhotosCoreTest(unittest.TestCase):
    def test_poses(self):
        self.assertEqual(js("PhotosCore.POSES"), ["front", "side", "side_left", "back", "back_flex", "front_flex"])
        self.assertEqual(js("[PhotosCore.POSE_NAMES.side, PhotosCore.POSE_NAMES.side_left]"), ["Сбоку справа", "Сбоку слева"])
        self.assertEqual(js('PhotosCore.parseName("2026-07-12_side_left.jpg")'), {"date": "2026-07-12", "pose": "side_left"})

    def test_find_already(self):
        """Повторная загрузка: тот же файл (SHA-256) или тот же кадр (время съёмки из EXIF, до секунды) — уже загружен."""
        photos = {"2026-07-12_front": {"sha": "aa", "shot": 1000}, "2026-07-12_side": {"sha": "bb", "shot": 5000},
                  "2025-12-19_front": {}}                                     # старый снимок без отпечатков — не сравнивается
        items = [{"id": 0, "sha": "aa", "time": 1, "fromExif": True}, {"id": 1, "sha": "zz", "time": 5000, "fromExif": True},
                 {"id": 2, "sha": "zz", "time": 5000, "fromExif": False}, {"id": 3, "sha": "cc", "time": 9000, "fromExif": True}]
        self.assertEqual(js(f"PhotosCore.findAlready({json.dumps(items)}, {json.dumps(photos)})"),
                         {"0": "2026-07-12_front", "1": "2026-07-12_side"})

    def test_parse_name(self):
        self.assertEqual(js('PhotosCore.parseName("2026-07-12_back_flex.jpg")'), {"date": "2026-07-12", "pose": "back_flex"})
        self.assertEqual(js('PhotosCore.parseName("2026-07-12_front.HEIC")'), {"date": "2026-07-12", "pose": "front"})
        self.assertIsNone(js('PhotosCore.parseName("2026-07-12_pose1.jpg")'))
        self.assertIsNone(js('PhotosCore.parseName("IMG_0001.HEIC")'))

    def test_exif_date(self):
        self.assertEqual(js('PhotosCore.exifDate(new Date(2026, 6, 12, 10, 58, 8), 0)'),
                         {"date": "2026-07-12", "time": js("new Date(2026, 6, 12, 10, 58, 8).getTime()"), "fromExif": True})
        r = js('PhotosCore.exifDate(null, new Date(2026, 10, 1, 9, 0).getTime())')
        self.assertEqual((r["date"], r["fromExif"]), ("2026-11-01", False))

    def test_plan_five_by_time(self):
        items = [{"id": i, "date": "2026-11-21", "time": t, "name": f"IMG_{i}.HEIC"} for i, t in enumerate([50, 10, 40, 20, 30])]
        s = js(f"PhotosCore.planSeries({json.dumps(items)}, [])")
        self.assertEqual(len(s), 1)
        self.assertEqual([(r["id"], r["pose"]) for r in s[0]["rows"]],
                         [(1, "front"), (3, "side"), (4, "back"), (2, "back_flex"), (0, "front_flex")])

    def test_plan_not_five(self):
        items = [{"id": i, "date": "2026-11-21", "time": i, "name": f"IMG_{i}.HEIC"} for i in range(4)]
        self.assertEqual({r["pose"] for r in js(f"PhotosCore.planSeries({json.dumps(items)}, [])")[0]["rows"]}, {None})

    def test_plan_duplicates_keep_last(self):
        """6 снимков за день: позы по точкам; одна поза дважды — дубли, оставлен последний по времени, первый «не сохранять»."""
        g = ["front", "front", "side", "back", "back_flex", "front_flex"]
        items = [{"id": i, "date": "2026-11-21", "time": 10 * i, "name": f"IMG_{i}.HEIC", "guess": p} for i, p in enumerate(g)]
        rows = js(f"PhotosCore.planSeries({json.dumps(items)}, [])")[0]["rows"]
        self.assertEqual(rows[0], {"id": 0, "pose": "skip", "exists": False, "dup": "front"})
        self.assertEqual(rows[1], {"id": 1, "pose": "front", "exists": False, "dup": "front"})
        self.assertEqual([(r["pose"], "dup" in r) for r in rows[2:]], [("side", False), ("back", False), ("back_flex", False), ("front_flex", False)])

    def test_plan_already_loaded(self):
        """Уже загруженный снимок — «не сохранять» с пометкой, в дубли не идёт."""
        g = ["front", "front", "side"]
        items = [{"id": i, "date": "2026-11-21", "time": i, "name": f"IMG_{i}.HEIC", "guess": p} for i, p in enumerate(g)]
        items[0]["already"] = "2026-11-21_front"
        rows = js(f"PhotosCore.planSeries({json.dumps(items)}, [])")[0]["rows"]
        self.assertEqual(rows[0], {"id": 0, "pose": "skip", "exists": False, "already": "2026-11-21_front"})
        self.assertEqual(rows[1], {"id": 1, "pose": "front", "exists": False})

    def test_dup_group(self):
        rows = [{"id": 0, "pose": "skip", "dup": "front"}, {"id": 1, "pose": "side"}, {"id": 2, "pose": "front", "dup": "front"}]
        self.assertEqual(js(f"PhotosCore.dupGroup({json.dumps(rows)}, 0)"), [0, 2])
        self.assertEqual(js(f"PhotosCore.dupGroup({json.dumps(rows)}, 2)"), [0, 2])
        self.assertEqual(js(f"PhotosCore.dupGroup({json.dumps(rows)}, 1)"), [1])

    def test_keep_dup(self):
        """«Оставить этот»: выбранный дубль получает позу, остальные дубли той же позы — «не сохранять», замена сбрасывается."""
        rows = [{"id": 0, "pose": "skip", "dup": "front"}, {"id": 1, "pose": "side"}, {"id": 2, "pose": "front", "dup": "front", "replace": True}]
        r = js(f"PhotosCore.keepDup({json.dumps(rows)}, 0)")
        self.assertEqual([(x["pose"], x.get("replace", False)) for x in r], [("front", False), ("side", False), ("skip", False)])

    def test_plan_three_duplicates(self):
        items = [{"id": i, "date": "2026-11-21", "time": i, "name": f"IMG_{i}.HEIC", "guess": "side"} for i in range(3)]
        rows = js(f"PhotosCore.planSeries({json.dumps(items)}, [])")[0]["rows"]
        self.assertEqual([r["pose"] for r in rows], ["skip", "skip", "side"])
        self.assertEqual({r["dup"] for r in rows}, {"side"})

    def test_plan_guess_beats_time_order(self):
        """5 снимков сняты не по порядку — позы по точкам, а не по времени."""
        g = ["side", "front", "back", "front_flex", "back_flex"]
        items = [{"id": i, "date": "2026-11-21", "time": i, "name": f"IMG_{i}.HEIC", "guess": p} for i, p in enumerate(g)]
        self.assertEqual([r["pose"] for r in js(f"PhotosCore.planSeries({json.dumps(items)}, [])")[0]["rows"]], g)

    def test_plan_pose_from_name_and_existing(self):
        items = [{"id": 0, "date": "2026-07-12", "time": 0, "name": "2026-07-12_side.jpg"},
                 {"id": 1, "date": "2026-11-21", "time": 0, "name": "IMG_1.HEIC"}]
        s = js(f'PhotosCore.planSeries({json.dumps(items)}, ["2026-07-12_side"])')
        self.assertEqual([x["date"] for x in s], ["2026-07-12", "2026-11-21"])
        self.assertEqual(s[0]["rows"], [{"id": 0, "pose": "side", "exists": True}])
        self.assertEqual(s[1]["rows"], [{"id": 1, "pose": None, "exists": False}])

    def test_validate_plan(self):
        ok = [{"date": "2026-11-21", "rows": [{"id": 0, "pose": "front"}, {"id": 1, "pose": "skip"}, {"id": 2, "pose": "skip"}]}]
        self.assertEqual(js(f"PhotosCore.validatePlan({json.dumps(ok)})"), [])
        dup = [{"date": "2026-11-21", "rows": [{"id": 0, "pose": "front"}, {"id": 1, "pose": "front"}]}]
        self.assertIn("дважды", " ".join(js(f"PhotosCore.validatePlan({json.dumps(dup)})")))
        none = [{"date": "2026-11-21", "rows": [{"id": 0, "pose": None}]}]
        self.assertIn("не выбрана", " ".join(js(f"PhotosCore.validatePlan({json.dumps(none)})")))
        two = [{"date": "2026-11-21", "rows": [{"id": 0, "pose": "front"}]},     # дату второй серии поменяли на ту же
               {"date": "2026-11-21", "rows": [{"id": 1, "pose": "front"}]}]
        self.assertIn("дважды", " ".join(js(f"PhotosCore.validatePlan({json.dumps(two)})")))
        nodate = [{"date": "", "rows": [{"id": 0, "pose": "front"}]}]
        self.assertIn("дата", " ".join(js(f"PhotosCore.validatePlan({json.dumps(nodate)})")))

    def test_project_path(self):
        """Путь папки проекта — из адреса страницы (…/portal/photos.html), для подсказки «куда сохранять»."""
        self.assertEqual(js('PhotosCore.projectPath("/Users/u/Documents/claude/health/portal/photos.html")'),
                         "/Users/u/Documents/claude/health")
        self.assertEqual(js('PhotosCore.projectPath("/Users/a/My%20Docs/%D0%B7%D0%B4%D0%BE%D1%80%D0%BE%D0%B2%D1%8C%D0%B5/portal/photos.html")'),
                         "/Users/a/My Docs/здоровье")
        self.assertIsNone(js('PhotosCore.projectPath("/x/photos.html")'))

    def test_resolve_folder(self):
        """Какую папку выбрали в окне Chrome → куда писать фото (путь внутри неё; папки создаются)."""
        r = lambda name, kids: js(f"PhotosCore.resolveFolder({json.dumps(name)}, {json.dumps(kids)})")
        self.assertEqual(r("health", ["portal", "data", "scripts"]), {"path": ["data", "photos"], "warn": None})   # папка проекта
        self.assertEqual(r("мой-проект", ["data", "portal"]), {"path": ["data", "photos"], "warn": None})         # как бы ни называлась
        self.assertEqual(r("data", ["body.csv", "photos_2"]), {"path": ["photos"], "warn": None})
        self.assertEqual(r("photos", ["originals"]), {"path": [], "warn": None})
        bad = r("Downloads", ["a.jpg"])
        self.assertIsNone(bad["path"])
        self.assertIn("health", bad["warn"])

    def test_keypoints(self):
        pts = {0: (0.5, 0.1), 11: (0.4, 0.2), 12: (0.6, 0.2), 23: (0.45, 0.5), 24: (0.55, 0.5), 27: (0.45, 0.9), 28: (0.55, 0.9)}
        pts.update({2: (0.48, 0.09), 5: (0.52, 0.09), 25: (0.45, 0.7), 26: (0.55, 0.7), 29: (0.45, 0.92), 30: (0.55, 0.92)})
        self.assertEqual(js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)"),
                         {"w": 1000, "h": 2000, "head": [500, 200], "neck": [500, 400], "root": [500, 1000], "ankle": [500, 1800],
                          "feet": [450, 550], "pts": {"eyes": [500, 180], "ears": None, "knees": [500, 1400], "heels": [500, 1840]},
                          "look": {"sw": -0.33, "up": None, "dir": None}})

    def test_keypoints_look(self):
        """Признаки позы: sw — плечи по x (левое минус правое) / корпус, up — кисти выше плеч / корпус."""
        pts = {11: (0.6, 0.2), 12: (0.4, 0.2), 23: (0.45, 0.5), 24: (0.55, 0.5), 15: (0.62, 0.05), 16: (0.38, 0.05)}
        self.assertEqual(js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)")["look"], {"sw": 0.33, "up": 0.5, "dir": None})
        # куда смотрит: (нос − уши) + (носки − пятки) по x / корпус; > 0 — вправо на снимке (правым боком к камере)
        pts.update({0: (0.56, 0.1), 7: (0.5, 0.11), 8: (0.5, 0.11), 29: (0.45, 0.95), 30: (0.45, 0.95), 31: (0.6, 0.96), 32: (0.6, 0.96)})
        self.assertEqual(js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)")["look"]["dir"], 0.35)

    def test_guess_pose(self):
        """Пороги — по 65 снимкам: боком |sw| ≤ 0.12 (остальные ≥ 0.58); лицом sw > 0; бицепс up ≥ 0.35 (иначе ≈ −1)."""
        for look, pose in [({"sw": 0.65, "up": -1.0}, "front"), ({"sw": 0.6, "up": 0.42}, "front_flex"),
                           ({"sw": -0.67, "up": -0.98}, "back"), ({"sw": -0.65, "up": 0.4}, "back_flex"),
                           ({"sw": 0.1, "up": -1.0, "dir": 0.48}, "side"), ({"sw": -0.05, "up": 0.4}, "side"),
                           ({"sw": 0.08, "up": -1.0, "dir": -0.5}, "side_left"), ({"sw": 0.6, "up": None}, "front")]:
            with self.subTest(look=look):
                self.assertEqual(js(f"PhotosCore.guessPose({json.dumps({'look': look})})"), pose)
        self.assertIsNone(js("PhotosCore.guessPose(null)"))
        self.assertIsNone(js('PhotosCore.guessPose({"neck": [1, 1]})'))

    def test_keypoints_feet_from_heels_and_toes(self):
        pts = {11: (0.4, 0.2), 12: (0.6, 0.2), 23: (0.45, 0.5), 24: (0.55, 0.5), 27: (0.45, 0.9), 29: (0.43, 0.92), 32: (0.6, 0.93)}
        self.assertEqual(js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)")["feet"], [430, 600])

    def test_keypoints_none_without_hips(self):
        pts = {0: (0.5, 0.1), 11: (0.4, 0.2), 12: (0.6, 0.2)}
        self.assertIsNone(js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)"))

    def test_keypoints_head_from_ear_no_ankle(self):
        pts = {7: (0.5, 0.12), 11: (0.4, 0.2), 12: (0.6, 0.2), 23: (0.45, 0.5), 24: (0.55, 0.5), 27: (0.45, 0.9)}
        k = js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)")
        self.assertEqual((k["head"], k["ankle"]), ([500, 240], [450, 1800]))
        pts.pop(27)
        k = js(f"PhotosCore.keypointsFromLandmarks({lm(pts)}, 1000, 2000)")
        self.assertEqual((k["ankle"], k["feet"]), (None, None))

    def sil(self, rects, kp=MKP):
        return js(f"PhotosCore.silhouette({json.dumps(mask(100, 200, rects))}, 100, 200, {json.dumps(kp)})")

    def test_silhouette_crown_sole_center(self):
        """Макушка — верх головы, а не кулак поднятой руки; подошвы — низ стоп; центр — середина корпуса без руки."""
        r = self.sil(BODY)
        self.assertEqual((r["crown"][1], r["sole"][1], r["cx"]), (10, 180, 50))

    def test_silhouette_feet_cut(self):
        r = self.sil(BODY[:2] + [(44, 110, 56, 199)])            # ноги уходят за нижний край кадра
        self.assertIsNone(r["sole"])
        self.assertEqual(r["crown"][1], 10)

    def test_silhouette_head_cut(self):
        r = self.sil([(45, 0, 55, 30)] + BODY[1:])               # голова касается верхнего края
        self.assertIsNone(r["crown"])
        self.assertEqual(r["sole"][1], 180)

    def test_silhouette_empty_mask(self):
        self.assertEqual(self.sil([]), {"crown": None, "sole": None, "cx": None})

    def align(self, kp, pose="front"):
        return js(f'PhotosCore.alignTransform({json.dumps(kp)}, "{pose}", {json.dumps(MED)})')

    def test_align_by_silhouette(self):
        t = self.align(KP)                                          # 4300 px → s = 1; подошвы на 5470 − 420, центр корпуса — в центр
        self.assertAlmostEqual(t["s"], 1.0)
        self.assertEqual(apply(t, [530, 4400]), [1665, 5050])
        self.assertEqual(apply(t, KP["crown"])[1], 750)
        self.assertEqual((t["by"], t["feet_cut"], t["th"]), ("силуэт", False, 0))

    def test_align_fallback_nose_ankle(self):
        t = self.align(NOSIL)                                       # рост 3900 × 1.1 = 4290; подошвы = 4200 + 0.05 × 4290
        s = 4300 / 4290
        self.assertAlmostEqual(t["s"], s)
        self.assertAlmostEqual(apply(t, [520, 4200 + 0.05 * 4290])[0], 1665)      # без силуэта — центр по тазу
        self.assertAlmostEqual(apply(t, [520, 4200 + 0.05 * 4290])[1], 5050)
        self.assertEqual((t["by"], t["feet_cut"]), ("рост", True))
        self.assertAlmostEqual(self.align(NOSIL, "side")["s"], 4300 / (3900 * 1.12))   # нет позы в медианах — общие

    def test_align_sole_without_crown(self):
        t = self.align(dict(NOSIL, sole=[520, 4400]))               # масштаб по росту, а пол — по найденным подошвам
        self.assertAlmostEqual(apply(t, [520, 4400])[1], 5050)
        self.assertFalse(t["feet_cut"])

    def test_align_fallback_torso(self):
        kp = dict(NOSIL, head=None)                                 # корпус 1000 × 3.3 = 3300
        t = self.align(kp)
        self.assertAlmostEqual(t["s"], 4300 / 3300)
        self.assertEqual(t["by"], "корпус")
        self.assertAlmostEqual(apply(t, [520, 4200 + 0.05 * 3300])[1], 5050)
        kp["ankle"] = None                                          # подошвы = таз + 0.5 × 3300
        self.assertAlmostEqual(apply(self.align(kp), [520, 1800 + 0.5 * 3300])[1], 5050)

    def test_align_straightens_tilt(self):
        """Ось «щиколотки → плечи» становится вертикальной: шея встаёт ровно над щиколотками."""
        kp = dict(KP, neck=[620, 800])                              # наклон 100 px на 3400 px ≈ 1.7°
        t = self.align(kp)
        self.assertAlmostEqual(t["th"], -math.atan(100 / 3400))
        n, a = apply(t, kp["neck"]), apply(t, kp["ankle"])
        self.assertAlmostEqual(n[0], a[0], places=6)
        self.assertAlmostEqual(math.hypot(n[0] - a[0], n[1] - a[1]), math.hypot(100, 3400) * t["s"], places=6)  # без искажений

    def test_align_tilt_capped(self):
        t = self.align(dict(KP, neck=[1520, 800]))                  # ~16° — скорее ошибка точек: не больше 5°
        self.assertAlmostEqual(t["th"], -math.radians(5))

    def test_all_fits_many_points(self):
        """5+ снимков позы: масштаб по многим точкам — пышная причёска, выброс таза и обрезанные стопы не сбивают."""
        e = [{"name": f"p{i}", "pose": "front", "kp": kp} for i, kp in enumerate([
            synth(1.0, 0), synth(0.9, 300), synth(1.1, -200, shift={"crown": -60}),     # p2: волосы выше на 60 px
            synth(0.95, 100), synth(1.05, 50, shift={"root": 150}), synth(0.85, 400, drop=("crown", "sole")),
            synth(1.0, 30, x=2100)])]
        r = js(f"PhotosCore.alignAll({json.dumps(e)})")
        for x in e:
            t, kp = r[x["name"]], x["kp"]
            with self.subTest(photo=x["name"]):
                self.assertEqual(t["by"], "точки")
                for n, want in (("eyes", 1030), ("knees", 3830), ("heels", 4950)):
                    self.assertAlmostEqual(apply(t, kp["pts"][n])[1], want, delta=6)
                self.assertAlmostEqual(apply(t, [kp["cx"], kp["neck"][1]])[0], 1665, delta=1)
        self.assertTrue(r["p5"]["feet_cut"])
        self.assertFalse(r["p0"]["feet_cut"])

    def test_all_few_photos_silhouette(self):
        e = [{"name": "a", "pose": "side", "kp": KP}, {"name": "b", "pose": "side", "kp": KP}, {"name": "c", "pose": "front", "kp": None}]
        r = js(f"PhotosCore.alignAll({json.dumps(e)})")
        self.assertEqual((r["a"]["by"], r["b"]["by"]), ("силуэт", "силуэт"))
        self.assertNotIn("c", r)

    def test_medians(self):
        self.assertEqual(js("PhotosCore.poseMedians([])"),
                         {"rN": {}, "rT": {}, "offA": {}, "offR": {}, "all": {"rN": 1.12, "rT": 3.4, "offA": 0.04, "offR": 0.5}})
        e = [{"pose": "front", "kp": KP}, {"pose": "front", "kp": NOSIL}]    # без силуэта — не в счёт
        m = js(f"PhotosCore.poseMedians({json.dumps(e)})")
        self.assertAlmostEqual(m["rN"]["front"], 4300 / 3900)
        self.assertAlmostEqual(m["rT"]["front"], 4.3)
        self.assertAlmostEqual(m["offA"]["front"], 200 / 4300)
        self.assertAlmostEqual(m["offR"]["front"], 2600 / 4300)
        self.assertAlmostEqual(m["all"]["rT"], 4.3)

    def test_nearest_weight(self):
        w = json.dumps([["2026-07-01", 72], ["2026-07-20", 73]])
        self.assertEqual(js(f'PhotosCore.nearestWeight({w}, "2026-07-12")'), 73)
        self.assertEqual(js(f'PhotosCore.nearestWeight({w}, "2026-08-03")'), 73)       # ровно 14 дней
        self.assertIsNone(js(f'PhotosCore.nearestWeight({w}, "2026-08-04")'))

    def test_build_view_paths(self):
        idx = {"photos": {"2026-07-12_front": {"date": "2026-07-12", "pose": "front", "kp": KP, "feet_cut": True, "v": 3},
                          "2026-07-12_side": {"date": "2026-07-12", "pose": "side", "kp": None, "feet_cut": False, "v": 3}}}
        data = {"weight": [["2026-07-13", 73]], "photo_notes": {"2026-07-12": "x"}, "photos_summary": "<p>s</p>"}
        v = js(f'PhotosCore.buildView({json.dumps(idx)}, {json.dumps(data)}, "../photos/")')
        self.assertEqual(v["aligned"], {"2026-07-12_front": "../photos/aligned/2026-07-12_front.jpg?v=3"})
        self.assertEqual(v["img"]["2026-07-12_side"], "../photos/view/2026-07-12_side.jpg?v=3")
        self.assertEqual(v["thumb"]["2026-07-12_side"], "../photos/thumbs/2026-07-12_side.jpg?v=3")
        self.assertEqual(v["sessions"], [{"date": "2026-07-12", "weight": 73, "note": "x"}])
        self.assertEqual((v["feet_cut"], v["summary"]), (["2026-07-12"], "<p>s</p>"))
        self.assertEqual(js('PhotosCore.buildView({photos: {}}, {}, "x/").sessions'), [])
        self.assertEqual(v["poses"], ["front", "side"])                       # кнопки — только для поз, которые есть


if __name__ == "__main__":
    unittest.main()
