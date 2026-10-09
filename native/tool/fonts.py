"""Build small, self-hosted Noto Sans JP fonts for the game's Japanese UI."""
from pathlib import Path
import hashlib
import subprocess
import sys
import urllib.request
import venv

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.dart_tool/font-build'
SOURCE = CACHE / 'NotoSansJP.ttf'
REVISION = '51303ca9e8ac9dcea7b12d307ba568fd0e6fcfca'
SOURCE_SHA = 'cdd8f083c1f5928ff3361f8cda4d3fc9462cbe89'
URL = f'https://raw.githubusercontent.com/google/fonts/{REVISION}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf'


def source_is_valid():
    if not SOURCE.exists():
        return False
    data = SOURCE.read_bytes()
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == SOURCE_SHA


def generate():
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    from fontTools import subset

    characters = set(chr(i) for a, b in [(0x20, 0x17F), (0x3000, 0x30FF), (0xFF00, 0xFFEF)] for i in range(a, b + 1))
    for path in (ROOT / 'lib').glob('*.dart'):
        characters.update(path.read_text())
    output = ROOT / 'assets/fonts'
    output.mkdir(parents=True, exist_ok=True)
    for weight, name in [(400, 'Regular'), (600, 'SemiBold')]:
        font = TTFont(SOURCE)
        instantiateVariableFont(font, {'wght': weight}, inplace=True)
        options = subset.Options()
        options.name_IDs = ['*']  # Retain copyright, license and font names.
        options.name_languages = ['*']
        sub = subset.Subsetter(options=options)
        sub.populate(unicodes=[ord(c) for c in characters])
        sub.subset(font)
        target = output / f'NotoSansJP-{name}.ttf'
        font.save(target)
        print(f'{target.name}: {target.stat().st_size:,} bytes')
        font.close()


if __name__ == '__main__':
    CACHE.mkdir(parents=True, exist_ok=True)
    if not source_is_valid():
        with urllib.request.urlopen(URL, timeout=60) as response:
            data = response.read()
        if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != SOURCE_SHA:
            raise RuntimeError('Noto Sans JP source checksum mismatch')
        SOURCE.write_bytes(data)
    if '--generate' in sys.argv:
        generate()
    else:
        environment = CACHE / 'venv'
        python = environment / 'bin/python'
        if not python.exists():
            venv.EnvBuilder(with_pip=True).create(environment)
        subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'fonttools==4.60.1'], check=True)
        subprocess.run([str(python), str(Path(__file__).resolve()), '--generate'], check=True)
