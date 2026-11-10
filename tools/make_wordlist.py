#!/usr/bin/env python3
"""Rebuilds the passphrase word list (src/core/wordlist.js).
Needs: npm install @scure/bip39, and a clone of github.com/mk270/whitakers-words at /tmp/claude-0/ww
(edit the path below). Output: /tmp/claude-0/verba.json, then embedded by hand into wordlist.js."""
import re, json, unicodedata, subprocess, collections, math
def bip(lang):
    out = subprocess.run(['node','-e',f"import('@scure/bip39/wordlists/{lang}.js').then(m=>console.log(JSON.stringify(m.wordlist)))"],capture_output=True,text=True,cwd='/home/claude/deps').stdout
    return json.loads(out)
def strip(w): return ''.join(c for c in unicodedata.normalize('NFD',w) if unicodedata.category(c)!='Mn')
langs={'en':bip('english'),'it':bip('italian'),'fr':[strip(w) for w in bip('french')]}
lat=set()
for line in open('/tmp/claude-0/ww/DICTLINE.GEN', encoding='latin-1'):
    s1=line[0:19].strip(); pos=line[76:83].strip(); rest=line[83:].split()
    if pos!='N' or len(rest)<9: continue
    decl,var,gen,kind,age,area,geo,freq,src=rest[:9]
    if freq not in ('A','B','C') or age not in ('X','C') or kind not in ('T','X'): continue
    w=None
    if decl=='1' and var=='1' and gen=='F': w=s1+'a'
    elif decl=='2' and var=='1' and gen=='M': w=s1+'us'
    elif decl=='2' and var=='2' and gen=='N': w=s1+'um'
    elif decl=='3' and var in ('1','2','3'): w=s1
    elif decl=='4' and var=='1': w=s1+'us'
    if w and re.fullmatch(r'[a-z]{4,10}', w): lat.add(w)
langs['la']=sorted(lat)
for k,v in langs.items(): print(k,len(v), all(re.fullmatch(r'[a-z]+',w) for w in v))
def lev1(a,b):
    if a==b: return True
    if abs(len(a)-len(b))>1: return False
    if len(a)==len(b): return sum(x!=y for x,y in zip(a,b))<=1
    if len(a)>len(b): a,b=b,a
    for i in range(len(b)):
        if b[:i]+b[i+1:]==a: return True
    return False
cnt=collections.Counter(w for v in langs.values() for w in set(v))
final=[]; seen=[]; byLen=collections.defaultdict(list)
for k in ['en','it','fr','la']:
    for w in langs[k]:
        if cnt[w]>1: continue
        if not (4<=len(w)<=10): continue
        if any(lev1(w,o) for L in (len(w)-1,len(w),len(w)+1) for o in byLen[L]): continue
        final.append(w); byLen[len(w)].append(w)
final=sorted(set(final))
print('final',len(final), 'bits/word', round(math.log2(len(final)),2), '6 words', round(6*math.log2(len(final)),1))
json.dump(final, open('/tmp/claude-0/verba.json','w'))
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = ("// Generated word list for passphrases (tools/make_wordlist.py). Do not edit by hand.\n"
 "// Sources: BIP39 English, Italian and French lists (MIT, github.com/bitcoin/bips; French accents removed),\n"
 "// and common Latin nouns from William Whitaker's WORDS dictionary (free for any use).\n"
 "// Rules: 4-10 letters a-z; words appearing in two languages removed; words one letter apart from\n"
 f"// another kept only once. {len(final)} words.\n"
 "export const WORDS = " + json.dumps(final, separators=(',',':')) + ";\n")
open(os.path.join(root, 'src/core/wordlist.js'), 'w').write(src)
print('wrote src/core/wordlist.js')
