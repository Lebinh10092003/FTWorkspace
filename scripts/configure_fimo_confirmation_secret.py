"""Install the FIMO confirmation key received on stdin from production CI."""

import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile


def main():
    secret = sys.stdin.readline().strip()
    if not secret:
        return
    if not re.fullmatch(r'[a-f0-9]{64}', secret):
        raise SystemExit('The FIMO confirmation key must be 64 lowercase hex characters.')

    env_file = (Path(__file__).resolve().parents[1] / 'backend' / '.env').resolve(strict=True)
    original = env_file.read_bytes()
    key = b'FIMO_BATCH_2_WEBHOOK_SECRET'
    lines = [line for line in original.splitlines(keepends=True)
             if not re.match(rb'\s*(?:export\s+)?' + key + rb'\s*=', line)]
    contents = b''.join(lines).rstrip(b'\r\n') + b'\n' + key + b'=' + secret.encode() + b'\n'
    if original == contents:
        return

    temporary = None
    try:
        with NamedTemporaryFile(dir=env_file.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(env_file)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print('FIMO confirmation key configured.')


if __name__ == '__main__':
    main()
