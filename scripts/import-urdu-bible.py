#!/usr/bin/env python3
"""Import published OUCV 2024 verses, never translate Scripture with AI.
Source: official fetch(bible) collection, urd_bib (Biblica, CC BY-SA 4.0).
Caches upstream source books in /tmp/obey-oucv. Run from any directory.
"""
import hashlib,json,re
from pathlib import Path
from urllib.request import urlopen
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
CACHE=Path('/tmp/obey-oucv');CACHE.mkdir(exist_ok=True)
BOOKS={'mat':'متی','mrk':'مرقس','luk':'لوقا','jhn':'یوحنا','act':'اعمال','heb':'عبرانیوں'}
def get(book):
 url=f'https://v1.fetch.bible/bibles/urd_bib/txt/{book}.json';p=CACHE/(book+'.json')
 if not p.exists():
  with urlopen(url,timeout=30) as r:p.write_bytes(r.read())
 data=json.loads(p.read_text());return book,data,{'url':url,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
with ThreadPoolExecutor(max_workers=6) as pool: sources=list(pool.map(get,BOOKS))
data={'translation':'Biblica® Open Urdu Contemporary Version™','year':2024,'language':'ur','license':'CC BY-SA 4.0','copyright':'Copyright © 1999, 2005, 2022, 2024 by Biblica, Inc.','source':'https://open.bible/','books':{},'sources':{}}
# A verse is a sequence of text and typed note/heading objects. Preserve all
# source text strings and notes; omit section headings from the verse body.
def verse(parts):
 text=[];notes=[]
 for part in parts:
  if isinstance(part,str):text.append(part)
  elif part.get('type')=='note':notes.append(part['contents'])
  elif part.get('type') not in ['heading']:raise ValueError('Unexpected source structure: '+repr(part))
 return {'text':''.join(text).strip(),'notes':notes}
for book,src,meta in sources:
 data['sources'][book]=meta
 data['books'][book]={'name':BOOKS[book],'chapters':{str(c):{str(v):verse(parts) for v,parts in enumerate(chapter) if v and parts} for c,chapter in enumerate(src['contents']) if c}}
(ROOT/'assets/bible/ur-oucv.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
ur=json.loads((ROOT/'lang/ur.json').read_text())
p=ur['church_assessment']['present']; nums=[36,38,38,38,42,42,42,42,43,45,46,47]
p['refs']=['اعمال 2:'+('46-47' if i==10 else str(n)) for i,n in enumerate(nums)]
p['verses']=[data['books']['act']['chapters']['2'][str(n)]['text'] for n in nums]
p['verses'][10]+=' '+data['books']['act']['chapters']['2']['47']['text']
# Exact substrings of the published text: fail if upstream text changes.
phrases=['خُداوؔند بھی ٹھہرایا اَور المسیح بھی','تَوبہ کرو','یِسوعؔ المسیح کے نام پر پاک ‏غُسل لو','پاک رُوح اِنعام میں پاؤگے','رسولوں سے، تعلیم پانے','رِفاقت رکھنے','روٹی توڑنے','دعا کرنے','معجزے اَور نِشان','اَپنی جائداد اَور مال و اَسباب بیچ بیچ کر','خُدا کی تمجید کرتے','خُداوؔند نَجات پانے والوں کی تعداد میں روز بروز اِضافہ کرتے رہتے تھے']
# Exact words differ between source revisions. Print candidate verses for review
# rather than silently injecting a paraphrase.
for i,phrase in enumerate(phrases):
 if phrase not in p['verses'][i]:print('HIGHLIGHT REVIEW',i,p['verses'][i])
p['highlights']=[phrase if phrase in p['verses'][i] else '' for i,phrase in enumerate(phrases)]
(ROOT/'lang/ur.json').write_text(json.dumps(ur,ensure_ascii=False,indent=2)+'\n')
print('Imported',sum(len(c) for b in data['books'].values() for c in b['chapters'].values()),'published verses')
