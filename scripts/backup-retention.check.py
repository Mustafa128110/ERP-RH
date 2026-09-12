import datetime as dt
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location("retention", "scripts/backup-retention.py")
module = module_from_spec(spec)
spec.loader.exec_module(module)
now = dt.datetime(2026, 9, 11, tzinfo=dt.timezone.utc)
keys = [f"erp-backups/history/{(now-dt.timedelta(hours=n*12)).strftime('%Y%m%dT%H%M%SZ')}.zip" for n in range(250)]
other = ["erp-backups/latest.zip", "erp-backups/staging/old.zip", "erp-backups/history/manual.zip"]
deleted = module.expired(keys+other, now)
assert not set(other) & set(deleted)
assert not set(keys[:29]) & set(deleted)
assert keys[-1] in deleted
assert len(keys)-len(deleted) <= 40
assert module.expired(keys[-10:], now) == []  # Keep at least the newest 14, even after a long outage.
print("Backup retention checks passed")
