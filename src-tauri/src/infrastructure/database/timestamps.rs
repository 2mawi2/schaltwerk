use chrono::{DateTime, TimeZone, Utc};

const MILLIS_THRESHOLD: i64 = 10_000_000_000;

fn utc_epoch() -> DateTime<Utc> {
    Utc.timestamp_opt(0, 0).single().unwrap_or_else(Utc::now)
}

pub fn utc_from_epoch_seconds_lossy(ts: i64) -> DateTime<Utc> {
    if ts.abs() >= MILLIS_THRESHOLD
        && let Some(dt) = Utc.timestamp_opt(ts / 1000, 0).single()
    {
        log::warn!("Coerced milliseconds timestamp to seconds (ts={ts})");
        return dt;
    }

    if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
        return dt;
    }

    log::warn!("Invalid epoch seconds timestamp (ts={ts}); falling back to epoch");
    utc_epoch()
}

pub fn utc_from_epoch_seconds_lossy_opt(ts: Option<i64>) -> Option<DateTime<Utc>> {
    let ts = ts?;

    if ts.abs() >= MILLIS_THRESHOLD
        && let Some(dt) = Utc.timestamp_opt(ts / 1000, 0).single()
    {
        log::warn!("Coerced milliseconds timestamp to seconds (ts={ts})");
        return Some(dt);
    }

    if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
        return Some(dt);
    }

    log::warn!("Invalid epoch seconds timestamp (ts={ts}); treating as missing");
    None
}

pub fn utc_from_epoch_millis_lossy(ms: i64) -> DateTime<Utc> {
    let candidate = if ms.abs() < MILLIS_THRESHOLD { ms * 1000 } else { ms };

    if let Some(dt) = Utc.timestamp_millis_opt(candidate).single() {
        if candidate != ms {
            log::warn!("Coerced seconds timestamp to millis (ms={ms})");
        }
        return dt;
    }

    if let Some(dt) = Utc.timestamp_opt(ms, 0).single() {
        log::warn!("Coerced seconds timestamp to millis via seconds parse (ms={ms})");
        return dt;
    }

    log::warn!("Invalid epoch millis timestamp (ms={ms}); falling back to epoch");
    utc_epoch()
}
