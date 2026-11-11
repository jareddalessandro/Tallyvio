import logging
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.database import system_session
from app.services.prices import is_stale, refresh_all

log = logging.getLogger(__name__)

MARKET_TZ = ZoneInfo("America/New_York")
MARKET_OPEN = time(9, 30)
MARKET_CLOSE = time(16, 0)


def _refresh_job() -> None:
    with system_session() as db:
        try:
            refresh_all(db)
        except Exception:
            log.exception("Scheduled price refresh failed")


def market_open(now: datetime) -> bool:
    """US stock market hours: weekdays 9:30 AM-4:00 PM Eastern. Holidays aren't known; a run on one just
    finds no new prices."""
    local = now.astimezone(MARKET_TZ)
    return local.weekday() < 5 and MARKET_OPEN <= local.time() <= MARKET_CLOSE


def _intraday_job() -> None:
    # During the day the provider's daily bar holds the latest price, which is stored as today's close and
    # replaced by the real close at the evening refresh.
    if market_open(datetime.now(timezone.utc)):
        _refresh_job()


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=settings.price_refresh_tz)
    # Daily, including weekends, since crypto trades every day.
    scheduler.add_job(
        _refresh_job,
        CronTrigger(
            hour=settings.price_refresh_hour,
            minute=settings.price_refresh_minute,
            timezone=settings.price_refresh_tz,
        ),
        id="daily_price_refresh",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )
    # And every few minutes while the market is open. The trigger ticks all day; the job skips the
    # closed hours, which keeps any interval working (a cron "*/n" only spaces evenly when n divides 60).
    minutes = settings.intraday_refresh_minutes
    if minutes:
        scheduler.add_job(
            _intraday_job,
            IntervalTrigger(minutes=minutes),
            id="intraday_price_refresh",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=minutes * 60,
        )
        log.info("Prices also refresh every %d minutes while the US market is open", minutes)
    elif settings.price_provider == "tiingo" and settings.price_intraday_minutes:
        log.info("Intraday price refreshes are off: Tiingo's daily prices are end of day only")
    # Catch up if the computer was off at the scheduled time.
    with system_session() as db:
        if is_stale(db):
            log.info("Prices are stale; refreshing on startup")
            # An aware time: a naive one is read in the scheduler's zone (New York), which put the catch-up
            # hours in the past or future depending on the server's TZ, and it was dropped as missed.
            scheduler.add_job(
                _refresh_job, id="startup_price_refresh", next_run_time=datetime.now(timezone.utc),
                misfire_grace_time=3600,
            )
    scheduler.start()
    return scheduler
