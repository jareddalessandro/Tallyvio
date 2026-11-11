"""The scheduler's catch-up refresh at startup."""

import threading

from app.services import scheduler


def test_stale_prices_refresh_right_away(monkeypatch):
    ran = threading.Event()
    monkeypatch.setattr(scheduler, "is_stale", lambda db: True)
    monkeypatch.setattr(scheduler, "_refresh_job", ran.set)
    started = scheduler.start_scheduler()
    try:
        assert ran.wait(5), "the startup catch-up didn't run"
    finally:
        started.shutdown(wait=False)


def _at(text: str):
    """A New York wall-clock time as an aware datetime."""
    from datetime import datetime

    return datetime.fromisoformat(text).replace(tzinfo=scheduler.MARKET_TZ)


def test_market_open_only_on_weekdays_during_trading_hours():
    # Tuesday, Nov 10, 2026.
    assert scheduler.market_open(_at("2026-11-10T09:30"))
    assert scheduler.market_open(_at("2026-11-10T12:00"))
    assert scheduler.market_open(_at("2026-11-10T16:00"))
    assert not scheduler.market_open(_at("2026-11-10T09:29"))
    assert not scheduler.market_open(_at("2026-11-10T16:01"))
    # Saturday.
    assert not scheduler.market_open(_at("2026-11-14T12:00"))


def test_market_open_reads_any_timezone_as_new_york():
    from datetime import datetime, timezone

    # 14:45 UTC is 9:45 in New York in November (EST), so the market is open.
    assert scheduler.market_open(datetime(2026, 11, 10, 14, 45, tzinfo=timezone.utc))
    assert not scheduler.market_open(datetime(2026, 11, 10, 14, 15, tzinfo=timezone.utc))


def test_intraday_job_skips_closed_hours(monkeypatch):
    ran = []
    monkeypatch.setattr(scheduler, "_refresh_job", lambda: ran.append(True))
    monkeypatch.setattr(scheduler, "market_open", lambda now: False)
    scheduler._intraday_job()
    assert ran == []
    monkeypatch.setattr(scheduler, "market_open", lambda now: True)
    scheduler._intraday_job()
    assert ran == [True]


def _started_job_ids(monkeypatch, **overrides):
    from app.config import settings

    for name, value in overrides.items():
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(scheduler, "is_stale", lambda db: False)
    started = scheduler.start_scheduler()
    try:
        return {job.id for job in started.get_jobs()}
    finally:
        started.shutdown(wait=False)


def test_intraday_refresh_is_scheduled_for_yahoo(monkeypatch):
    jobs = _started_job_ids(monkeypatch, price_provider="yahoo", price_intraday_minutes=15)
    assert jobs == {"daily_price_refresh", "intraday_price_refresh"}


def test_intraday_refresh_can_be_turned_off(monkeypatch):
    assert _started_job_ids(monkeypatch, price_provider="yahoo", price_intraday_minutes=0) == {"daily_price_refresh"}


def test_no_intraday_refresh_with_tiingo(monkeypatch):
    # Tiingo's daily prices are end of day only, so refreshing during the day would just spend its quota.
    jobs = _started_job_ids(monkeypatch, price_provider="tiingo", price_intraday_minutes=15)
    assert jobs == {"daily_price_refresh"}
