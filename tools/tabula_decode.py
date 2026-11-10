#!/usr/bin/env python3
"""Turn a sealed document (INCIPIT TABULA … EXPLICIT) back into a standard .age file.

Independent of the app (standard library only). Then open it with the official tool:
    python3 tools/tabula_decode.py tabula.txt > doc.age
    age -d doc.age            # prints {"v":1,"title":...,"text":...}

Paste the glyph text from the Google Doc into tabula.txt (File > Download > Plain text works too).
"""
import math, struct, sys, zlib

ALPHABET = "☉☽☿♀♂♃♄♈♉♊♋♌♍♎♏♐♑♒♓🜁🜂🜃🜄☊☋☌☍⚹🜍🜔🜚🜛"
VAL = {c: i for i, c in enumerate(ALPHABET)}


def decode(text):
    body = text.split("INCIPIT TABULA", 1)[-1].split("EXPLICIT", 1)[0]
    vals = []
    for c in body:
        if c in " \t\r\n︎️ ​﻿":
            continue
        if c not in VAL:
            raise SystemExit(f"unknown sign {c!r} (U+{ord(c):04X})")
        vals.append(VAL[c])
    n = (len(vals) * 5) // 8
    if math.ceil(n * 8 / 5) != len(vals):
        raise SystemExit("impossible number of signs: the text is incomplete")
    bits = "".join(format(v, "05b") for v in vals)
    if set(bits[n * 8:]) - {"0"}:
        raise SystemExit("non-zero padding bits: damaged text")
    wire = bytes(int(bits[i * 8:i * 8 + 8], 2) for i in range(n))
    data, crc = wire[:-4], struct.unpack(">I", wire[-4:])[0]
    if zlib.crc32(data) != crc:
        raise SystemExit("checksum mismatch: the signs were damaged")
    return data


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    sys.stdout.buffer.write(decode(src))
