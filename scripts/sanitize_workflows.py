#!/usr/bin/env python3
"""Make exported n8n workflow JSON safe to publish.

Usage: python scripts/sanitize_workflows.py raw_exports/ n8n/workflows/
Removes credential references and webhook ids, and masks phone numbers,
phone-number ids and shared secrets. Review the output before committing.
"""
import json, re, sys, pathlib

src, dst = map(pathlib.Path, sys.argv[1:3])
dst.mkdir(parents=True, exist_ok=True)

PATTERNS = [
    (re.compile(r'\b92\d{10}\b'), '92XXXXXXXXXX'),            # WhatsApp numbers
    (re.compile(r'\b\d{15}\b'), 'PHONE_NUMBER_ID'),           # WhatsApp phone number id
    (re.compile(r'\b[0-9a-f]{32}\b'), 'REDACTED_SECRET'),     # shared secrets
    (re.compile(r'\+92 ?\d{3} ?\d{7}'), '+92 XXX XXXXXXX'),
]

def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items() if k not in ('credentials', 'webhookId', 'pinData')}
    if isinstance(o, list):
        return [clean(x) for x in o]
    if isinstance(o, str):
        for rx, rep in PATTERNS:
            o = rx.sub(rep, o)
    return o

for f in src.glob('*.json'):
    data = json.loads(f.read_text())
    (dst / f.name).write_text(json.dumps(clean(data), indent=2, ensure_ascii=False))
    print('cleaned', f.name)
