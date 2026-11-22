#!/usr/bin/env python3
"""Алкоголь по вечерам — подсчёт для субботнего разбора (scripts/weekly_review.py).

Разметку ночей «похоже на алкоголь» и ответы пользователя ведёт приложение (desktop/alcohol.js): alcohol_check.csv, events.csv.
Вечер с алкоголем = событие type=алкоголь (start = вечер) или утро со статусом «да» (вечер = утро − 1).
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import read  # noqa: E402


def evenings():
    """Вечера с алкоголем (ISO): события type=алкоголь + подтверждённые утра «да» (вечер = утро−1)."""
    ev = {e["start"] for e in read("events.csv") if (e.get("type") or "").strip() == "алкоголь" and e.get("start")}
    ev |= {(date.fromisoformat(r["date"]) - timedelta(days=1)).isoformat() for r in read("alcohol_check.csv") if r["status"] == "да"}
    return ev


def count(start, end, evs=None):
    """Сколько вечеров с алкоголем в [start, end] (date или ISO)."""
    a, b = str(start), str(end)
    return sum(1 for e in (evenings() if evs is None else evs) if a <= e <= b)


def verdict(n):
    """Оценка числа дней с алкоголем за неделю: 1 — норм, 2 — такое себе, 3+ — проблема."""
    return ("0 — отлично", "1 — норм", "2 — уже такое себе")[n] if n < 3 else f"{n} — проблема"
