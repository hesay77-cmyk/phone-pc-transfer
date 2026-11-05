#!/usr/bin/env python3
"""官网字体：只截取官网用到的字，放进 apps/site/fonts/，生成 fonts.css。

官网任何页面（apps/site/*.html）文字改了就重新跑一次：  python3 scripts/site-fonts.py
需要：npm、pip install fonttools brotli
中文 Noto Sans SC、英文数字 Inter，都是可变字重（100–900），开源字体（OFL）。
"""
import html, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'apps', 'site')
OUT = os.path.join(SITE, 'fonts')

page = ''.join(open(os.path.join(SITE, f), encoding='utf-8').read() for f in sorted(os.listdir(SITE)) if f.endswith('.html'))
text = html.unescape(re.sub(r'<[^>]+>', ' ', page))
chars = {ord(c) for c in text if ord(c) > 0x2e7f}  # 中文和全角标点；英文数字交给 Inter

tmp = tempfile.mkdtemp()
pkgs = {}
for name in ('@fontsource-variable/noto-sans-sc', '@fontsource-variable/inter'):
    tgz = subprocess.check_output(['npm', 'pack', name, '-q'], cwd=tmp, text=True).strip().splitlines()[-1]
    d = os.path.join(tmp, tgz[:-4])
    os.makedirs(d)
    subprocess.check_call(['tar', 'xzf', os.path.join(tmp, tgz), '-C', d])
    pkgs[name] = os.path.join(d, 'package')


def ranges(css):
    for block in re.findall(r'@font-face\s*{[^}]+}', css):
        src = re.search(r'url\(\./files/([^)]+)\)', block).group(1)
        cps = set()
        for part in re.search(r'unicode-range:\s*([^;]+);', block).group(1).split(','):
            a, _, b = part.strip()[2:].partition('-')
            cps.update(range(int(a, 16), int(b or a, 16) + 1))
        yield src, cps


def urange(cps):
    cps, out, i = sorted(cps), [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append('U+%x' % cps[i] if i == j else 'U+%x-%x' % (cps[i], cps[j]))
        i = j + 1
    return ','.join(out)


shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
css = ['/* 由 scripts/site-fonts.py 生成，别手改 */']

# 英文数字：Inter 的 latin 整块（小，不截）
inter = pkgs['@fontsource-variable/inter']
shutil.copy(os.path.join(inter, 'files', 'inter-latin-wght-normal.woff2'), os.path.join(OUT, 'inter.woff2'))
css.append("@font-face{font-family:'Inter Var';font-style:normal;font-display:swap;font-weight:100 900;"
           "src:url(inter.woff2) format('woff2');"
           "unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}")

# 中文：从各分块里只留官网用到的字
sc = pkgs['@fontsource-variable/noto-sans-sc']
left, n = set(chars), 0
for src, cps in ranges(open(os.path.join(sc, 'wght.css'), encoding='utf-8').read()):
    need = left & cps
    if not need:
        continue
    left -= need
    n += 1
    out = os.path.join(OUT, 'sc-%d.woff2' % n)
    subprocess.check_call([sys.executable, '-m', 'fontTools.subset', os.path.join(sc, 'files', src),
                           '--unicodes=' + ','.join('%x' % c for c in sorted(need)),
                           '--flavor=woff2', '--layout-features=*', '--output-file=' + out])
    css.append("@font-face{font-family:'Noto SC Var';font-style:normal;font-display:swap;font-weight:100 900;"
               "src:url(sc-%d.woff2) format('woff2');unicode-range:%s}" % (n, urange(need)))

open(os.path.join(OUT, 'fonts.css'), 'w', encoding='utf-8').write('\n'.join(css) + '\n')
shutil.rmtree(tmp)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('中文 %d 个字，%d 个文件，共 %d KB；字体里没有的字：%s' % (len(chars), n, total // 1024, ''.join(map(chr, left)) or '无'))
