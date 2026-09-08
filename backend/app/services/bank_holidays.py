"""
England and Wales bank holidays, computed rather than tabulated.

The spreadsheet carried a hard-coded list that stopped at 2015, so any
recent data silently treated bank holidays as ordinary weekdays. Deriving
them means the app never goes stale.

Scotland and Northern Ireland differ; if those are ever needed, add them as
separate calendars rather than bending this one.
"""

from datetime import date, timedelta
from functools import lru_cache


def easter_sunday(year: int) -> date:
    """Anonymous Gregorian computus."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _next_weekday(day: date) -> date:
    """Shift a weekend date to the following Monday or Tuesday."""
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def _first_monday(year: int, month: int) -> date:
    day = date(year, month, 1)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def _last_monday(year: int, month: int) -> date:
    day = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return day - timedelta(days=day.weekday())


@lru_cache(maxsize=64)
def holidays_for_year(year: int) -> frozenset[date]:
    easter = easter_sunday(year)

    days = {
        _next_weekday(date(year, 1, 1)),            # New Year's Day
        easter - timedelta(days=2),                  # Good Friday
        easter + timedelta(days=1),                  # Easter Monday
        _first_monday(year, 5),                      # Early May
        _last_monday(year, 5),                       # Spring
        _last_monday(year, 8),                       # Summer
    }

    # Christmas and Boxing Day, with substitute days when they fall on a
    # weekend. Boxing Day must land after Christmas, hence the sequencing.
    christmas = _next_weekday(date(year, 12, 25))
    boxing = _next_weekday(date(year, 12, 26))
    if boxing <= christmas:
        boxing = _next_weekday(christmas + timedelta(days=1))
    days.update({christmas, boxing})

    # One-off royal and jubilee holidays. Not derivable, so listed.
    extras = {
        2011: [date(2011, 4, 29)],                                   # Royal Wedding
        2012: [date(2012, 6, 5)],                                    # Diamond Jubilee
        2022: [date(2022, 6, 3), date(2022, 9, 19)],                 # Platinum Jubilee, State Funeral
        2023: [date(2023, 5, 8)],                                    # Coronation
    }
    days.update(extras.get(year, []))

    return frozenset(days)


def holidays_between(start: date, end: date) -> frozenset[date]:
    days: set[date] = set()
    for year in range(start.year, end.year + 1):
        days.update(holidays_for_year(year))
    return frozenset(d for d in days if start <= d <= end)
