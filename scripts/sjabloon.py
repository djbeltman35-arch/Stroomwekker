#!/usr/bin/env python3
"""Maakt netlify/lib/sjabloon.mjs uit public/hoe-werkt-het/index.html.
Draai opnieuw als de kop, stijl of footer van de site verandert."""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / 'public/hoe-werkt-het/index.html').read_text()
head_end = s.index('<style>', s.index('</style>'))          # begin van paginastijl
head = s[:head_end]
head = re.sub(r'<title>.*?</title>', '<title>{{TITLE}}</title>', head)
head = re.sub(r'(<meta name="description" content=")[^"]*', r'\1{{DESC}}', head)
head = re.sub(r'(<meta property="og:description" content=")[^"]*', r'\1{{DESC}}', head)
head = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\1{{TITLE}}', head)
head = re.sub(r'(<link rel="canonical" href=")[^"]*', r'\1{{URL}}', head)
head = re.sub(r'(<meta property="og:url" content=")[^"]*', r'\1{{URL}}', head)
head = re.sub(r'(<meta property="og:type" content=")[^"]*', r'\1article', head)
head = re.sub(r'<script type="application/ld\+json">.*?</script>\n?', '', head, flags=re.S)
m = re.search(r'<style id="hmenu-css">.*?</style>\n', s, re.S)
if m: head += m.group(0)  # menu rechtsboven
hb = s.index('</head>'); he = s.index('</header>') + len('</header>')
header = s[hb:he].replace(' aria-current="page"', '')
footer = s[s.index('</main>'):]
out = ('// Automatisch gemaakt door scripts/sjabloon.py. Niet met de hand aanpassen.\n'
       f'export const HEAD = {json.dumps(head, ensure_ascii=False)};\n'
       f'export const HEADER = {json.dumps(header, ensure_ascii=False)};\n'
       f'export const FOOTER = {json.dumps(footer, ensure_ascii=False)};\n')
(root / 'netlify/lib/sjabloon.mjs').write_text(out)
print('sjabloon.mjs', len(out), 'tekens')
