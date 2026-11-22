#!/usr/bin/env python3
"""Черновик субботнего разбора: неделя в цифрах из всех данных + сравнение с прошлой неделей.

    python3 scripts/weekly_review.py              # неделя: прошлая суббота … вчера
    python3 scripts/weekly_review.py 2026-11-14   # дата разбора (неделя = 7 дней до неё)

Печатает markdown: сон, восстановление, тренировки против плана, питание против цели (по targets.csv),
алкоголь (что подтвердить), вес; плюс авто-проверку «хорошей недели» и черновик строки журнала.
Самочувствие, энергию и талию скрипт не знает — их спросить у пользователя.
"""
import sys, json
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib  # noqa: E402
import alcohol_check as alc  # noqa: E402
from lib import num, ru as f, WD  # noqa: E402


def mean(a):
    a = [x for x in a if x is not None]
    return sum(a) / len(a) if a else None


def delta(a, b, dg=0, unit="", good_up=True):
    if a is None or b is None:
        return ""
    d = a - b
    if round(d, dg) == 0:
        return " (=)"
    arrow = "↑" if d > 0 else "↓"
    ok = (d > 0) == good_up
    return f" ({arrow}{f(abs(d), dg)}{unit}{'' if ok else ' ⚠'})"


def hhmm(t):
    """ЧЧ:ММ → часы от 18:00 (чтобы 00:30 > 23:30)."""
    if not t:
        return None
    h, m = map(int, t.split(":"))
    x = h + m / 60
    return x if x >= 12 else x + 24


def fmt_bed(x):
    if x is None:
        return "—"
    x = x % 24
    return f"{int(x):02d}:{int(round((x % 1) * 60)) % 60:02d}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    review = date.fromisoformat(args[0]) if args else date.today()
    end = review - timedelta(days=1)
    start = end - timedelta(days=6)
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    pdays = [(start - timedelta(days=7 - i)).isoformat() for i in range(7)]

    W = lib.by("whoop_daily.csv")
    WK = lib.read("whoop_workouts.csv")
    N = lib.by("nutrition_daily.csv")
    T = lib.read("targets.csv")
    AC = lib.by("alcohol_check.csv")
    body = lib.by("body.csv")
    sleep_t = lib.meta()["plan"]["targets"].get("sleep", 7.5)
    target = lambda ds: lib.target_on(ds, T)
    base = lambda ds, k: lib.baseline(W, ds, k)
    LB = lib.by("workout_labels.csv")
    kind = lambda x: lib.workout_kind(x, LB)   # с учётом меток (workout_labels.csv)

    def whoop(ds_list):
        r = [W[d] for d in ds_list if d in W]
        g = lambda k: mean(num(x[k]) for x in r)
        return {"n": len(r), "rec": g("recovery"), "hrv": g("hrv"), "rhr": g("rhr"), "sleep": g("sleep_h"),
                "deep": g("deep_h"), "rem": g("rem_h"), "strain": g("strain"),
                "bed": mean(hhmm(x["bed"]) for x in r), "short": sum(1 for x in r if (num(x["sleep_h"]) or 9) < 6.5),
                "green": sum(1 for x in r if (num(x["recovery"]) or 0) >= 67), "red": sum(1 for x in r if num(x["recovery"]) is not None and num(x["recovery"]) < 34),
                "bh": mean(base(d, "hrv") for d in ds_list if d in W), "br": mean(base(d, "rhr") for d in ds_list if d in W)}

    def train(ds_list):
        s = set(ds_list)
        w = [x for x in WK if x["date"] in s and kind(x) != "walk"]
        late = [x for x in w if int(x["start"][11:13]) >= 20]
        return {"squash": sum(1 for x in w if kind(x) == "squash"), "strength": sum(1 for x in w if kind(x) == "strength"),
                "other": sum(1 for x in w if kind(x) == "other"), "late": len(late), "list": w}

    def food(ds_list):
        full = [d for d in ds_list if d in N and (num(N[d]["kcal"]) or 0) >= lib.FULL_DAY_KCAL]
        part = [d for d in ds_list if d in N and 0 < (num(N[d]["kcal"]) or 0) < lib.FULL_DAY_KCAL]
        hit = 0                 # Б, Ж, У в пределах ±15 % от цели — как зелёный день на «Питании» (portal/dataset.js → foodDay)
        for d in full:
            t = target(d)
            devs = [abs(v - float(t[k])) / float(t[k]) for k in ("protein", "fat", "carbs")
                    if (v := num(N[d][k])) is not None and num(t.get(k))]
            if devs and max(devs) <= 0.15:
                hit += 1
        g = lambda k: mean(num(N[d][k]) for d in full)
        return {"full": len(full), "part": len(part), "empty": len(ds_list) - len(full) - len(part), "hit": hit,
                "kcal": g("kcal"), "p": g("protein"), "f": g("fat"), "c": g("carbs")}

    w, pw = whoop(days), whoop(pdays)
    t, pt = train(days), train(pdays)
    n, pn = food(days), food(pdays)
    tg = target(end.isoformat())
    weights = sorted((d, num(b["weight_kg"])) for d, b in body.items() if days[0] <= d <= days[-1] and num(b.get("weight_kg")))
    waist = [(d, num(b["waist_cm"])) for d, b in sorted(body.items()) if num(b.get("waist_cm"))]
    alco = [(d, AC[d]) for d in days if d in AC]
    al_n, al_pn = alc.count(days[0], days[-1]), alc.count(pdays[0], pdays[-1])   # вечера с алкоголем за неделю

    L = []
    L.append(f"## Неделя {start:%d.%m}–{end:%d.%m} (разбор {review:%d.%m.%Y})\n")
    L.append("**Спросить:** самочувствие 1–10, энергия, стресс, талия (утром, по пупку), что мешало, изменения в БАДах\n")
    L.append("### Сон и восстановление (Whoop)")
    L.append(f"- Сон: **{f(w['sleep'], 1, ' ч')}**{delta(w['sleep'], pw['sleep'], 1, ' ч')} — цель {f(sleep_t, 1)}; глубокий {f(w['deep'], 1)}, REM {f(w['rem'], 1)}; ночей < 6,5 ч: {w['short']}")
    L.append(f"- Отбой в среднем: **{fmt_bed(w['bed'])}** (прошлая неделя {fmt_bed(pw['bed'])})")
    L.append(f"- Recovery: **{f(w['rec'], 0, '%')}**{delta(w['rec'], pw['rec'], 0, ' п.')} — зелёных {w['green']}, красных {w['red']} из {w['n']}")
    L.append(f"- HRV: {f(w['hrv'])} мс (норма {f(w['bh'])}) · пульс покоя: {f(w['rhr'], 1)} (норма {f(w['br'], 1)}) · strain ср. {f(w['strain'], 1)}")
    L.append("\n### Тренировки (Whoop)")
    L.append(f"- Силовые: **{t['strength']}/2** · сквош: **{t['squash']}/2**" + (f" · другое: {t['other']}" if t["other"] else "") + f" · после 20:00: {t['late']} (прошлая неделя: силовые {pt['strength']}, сквош {pt['squash']})")
    for x in sorted(t["list"], key=lambda x: x["start"]):
        dd = date.fromisoformat(x["date"])
        L.append(f"  - {WD[dd.weekday()]} {dd:%d.%m} {x['start'][11:]} — {x['sport']}, {x['duration_min']} мин, strain {x['strain']}, пульс {x['avg_hr']}/{x['max_hr']}")
    # неразмеченные (тип activity) за 2 недели — столько обновление забирает из Whoop само, так что правка в Whoop подтянется
    unl = sorted((x for x in WK if lib.unlabeled(x, LB) and pdays[0] <= x["date"] <= days[-1]), key=lambda x: x["start"])
    unl_s = [f"{WD[date.fromisoformat(x['date']).weekday()]} {date.fromisoformat(x['date']):%d.%m} {x['start'][11:]} ({x['duration_min']} мин)" for x in unl]
    if unl:
        L.append(f"- ❓ **Неразмеченные тренировки за 2 недели: {len(unl)}** (тип activity) — указать вид в Whoop или записать метку в workout_labels.csv; не ответил — спросить в чате или поправить вид в Whoop: " + ", ".join(unl_s))
    else:
        L.append("- Неразмеченных тренировок за 2 недели нет")
    L.append("\n### Питание (FatSecret)")
    L.append(f"- Записано полностью **{n['full']}/7**, неполных {n['part']}, без записей {n['empty']} · цель выполнена: {n['hit']} дн. (прошлая неделя: полных {pn['full']}/7)")
    L.append(f"- Среднее за полные дни: **{f(n['kcal'])} ккал**{delta(n['kcal'], pn['kcal'])} (цель {tg['kcal']}), белок **{f(n['p'])} г**{delta(n['p'], pn['p'])} (цель {tg['protein']}), Ж {f(n['f'])}, У {f(n['c'])}")
    L.append("\n### Алкоголь")
    L.append(f"- Дней с алкоголем: **{alc.verdict(al_n)}**{' 🛑' if al_n >= 3 else ''} (прошлая неделя {al_pn}) · 1 — норм, 2 — уже такое себе, 3 — проблема")
    if alco:
        for d, a in alco:
            dd = date.fromisoformat(d)
            st_ = {"?": "**подтвердить**", "да": "да", "нет": "нет"}.get(a["status"], a["status"])
            sig = f"HRV {a['hrv_dev_pct']}%, пульс +{a['rhr_dev']}" if a["hrv_dev_pct"] else "признаков в Whoop нет"
            L.append(f"- ночь {WD[(dd - timedelta(days=1)).weekday()]}→{WD[dd.weekday()]} {dd:%d.%m}: {sig} — {st_}")
    else:
        L.append("- признаков нет")
    L.append("\n### Вес и талия")
    L.append(f"- Взвешиваний: {len(weights)}" + (f", среднее {f(mean(v for _, v in weights), 1)} кг" if weights else " — напомнить взвешиваться каждое утро"))
    L.append(f"- Талия: последний замер {waist[-1][1]} см ({waist[-1][0]})" if waist else "- Талия: замеров ещё нет")

    # хорошая неделя (авто-часть)
    L.append("\n### «Хорошая неделя» — что видно из данных")
    chk = [
        ("Сон ≥ 7,5 ч в среднем", w["sleep"] is not None and w["sleep"] >= sleep_t),
        ("Восстановление без провалов (красных дней нет)", w["red"] == 0),
        ("Обе силовые сделаны", t["strength"] >= 2),
    ]
    for lab, ok in chk:
        L.append(f"- {'✅' if ok else '❌'} {lab}")
    L.append("- ❔ Самочувствие и энергия ≥ 7/10 — спросить\n- ❔ Талия не растёт — замерить\n- ❔ Вес стоит или медленно растёт — " + ("есть данные" if weights else "нет взвешиваний"))

    # черновик строки журнала
    j = {"week": f"{start:%d.%m}–{end:%d.%m}", "feel": None, "weight": round(mean(v for _, v in weights), 1) if weights else None,
         "waist": None, "sleep": None if w["sleep"] is None else round(w["sleep"], 1),
         "kcal": None if n["kcal"] is None else round(n["kcal"]), "protein": None if n["p"] is None else round(n["p"]),
         "training": f"силовые {t['strength']}/2, сквош {t['squash']}/2", "note": ""}
    L.append("\n### Черновик для data/meta.json → journal")
    L.append("```json\n" + json.dumps(j, ensure_ascii=False) + "\n```")
    print("\n".join(L))

if __name__ == "__main__":
    main()
