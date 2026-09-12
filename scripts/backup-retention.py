"""Select expired ERP archives; never delete latest, staging or unknown keys."""
import datetime as dt
import json
import re
import sys

def expired(keys, now):
    archives = []
    for key in keys:
        match = re.fullmatch(r"erp-backups/history/(\d{8}T\d{6}Z)(?:-[a-f0-9]+)?\.zip", key)
        if match:
            archives.append((dt.datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc), key))
    archives.sort(reverse=True)
    keep = {key for date, key in archives[:14]}
    weeks, months = set(), set()
    for date, key in archives:
        age = (now - date).total_seconds() / 86400
        week, month = date.strftime("%G-%V"), date.strftime("%Y-%m")
        if age <= 14:
            keep.add(key)
        if age <= 56 and week not in weeks:
            keep.add(key)
            weeks.add(week)
        if age <= 93 and month not in months:
            keep.add(key)
            months.add(month)
    return [key for _, key in archives if key not in keep]

if __name__ == "__main__":
    objects = json.load(sys.stdin)
    for key in expired([entry["Key"] for entry in objects.get("Contents", [])], dt.datetime.now(dt.timezone.utc)):
        print(key)
