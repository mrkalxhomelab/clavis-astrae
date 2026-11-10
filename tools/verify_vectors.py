#!/usr/bin/env python3
"""Independent re-implementation of the CLAVIS ASTRAE v1 recipient side.

Uses only the Python standard library (hashlib, hmac, zlib). Shares no code
with the JavaScript app. For each vector in tests/vectors.json it:
  1. decodes the glyph text with its own 5-bit decoder,
  2. checks the CRC-32 with zlib,
  3. recomputes the test pad and verifies HMAC-SHA-256,
  4. XOR-decrypts and compares with the expected plaintext.
It also re-encrypts the plaintext and compares the packet byte for byte.

Usage: python3 tools/verify_vectors.py [tests/vectors.json]
"""
import hashlib, hmac, json, struct, sys, zlib, math

ALPHABET = "☉☽☿♀♂♃♄♈♉♊♋♌♍♎♏♐♑♒♓🜁🜂🜃🜄☊☋☌☍⚹🜍🜔🜚🜛"
VAL = {c: i for i, c in enumerate(ALPHABET)}
assert len(ALPHABET) == 32 and len(VAL) == 32
BLK, MACLEN, HDR = 128, 32, 20


def stream(d, size):
    out = bytearray()
    blk = 0
    while len(out) < size:
        out += hashlib.sha256(b"CLAVIS-TEST-PAD" + bytes([d]) + struct.pack(">I", blk)).digest()
        blk += 1
    return bytes(out[:size])


def decode_glyphs(text):
    body = text.split("INCIPIT EPISTULA", 1)[-1].split("EXPLICIT", 1)[0]
    vals = [VAL[c] for c in body if c not in " \n\t\r︎️"]
    n = (len(vals) * 5) // 8
    assert math.ceil(n * 8 / 5) == len(vals), "impossible glyph count"
    bits = "".join(format(v, "05b") for v in vals)
    assert set(bits[n * 8:]) <= {"0"}, "non-zero padding"
    return bytes(int(bits[i * 8:(i + 1) * 8], 2) for i in range(n))


def encrypt(pad_streams, padid, direction, offset, text):
    u = text.encode("utf-8")
    P = math.ceil((4 + len(u)) / BLK) * BLK
    s = pad_streams[direction]
    kmac, kotp = s[offset:offset + MACLEN], s[offset + MACLEN:offset + MACLEN + P]
    F = struct.pack(">I", len(u)) + u + bytes(P - 4 - len(u))
    C = bytes(a ^ b for a, b in zip(F, kotp))
    H = b"CA" + bytes([1, direction]) + bytes.fromhex(padid) + struct.pack(">II", offset, P)
    return H + C + hmac.new(kmac, H + C, hashlib.sha256).digest()


def decrypt(pad_streams, wire):
    packet, crc = wire[:-4], struct.unpack(">I", wire[-4:])[0]
    assert zlib.crc32(packet) == crc, "CRC mismatch"
    assert packet[:3] == b"CA\x01"
    d = packet[3]
    o, P = struct.unpack(">II", packet[12:20])
    H, C, tag = packet[:HDR], packet[HDR:HDR + P], packet[HDR + P:]
    s = pad_streams[d]
    kmac = s[o:o + MACLEN]
    assert hmac.compare_digest(hmac.new(kmac, H + C, hashlib.sha256).digest(), tag), "HMAC mismatch"
    F = bytes(a ^ b for a, b in zip(C, s[o + MACLEN:o + MACLEN + P]))
    n = struct.unpack(">I", F[:4])[0]
    assert all(b == 0 for b in F[4 + n:])
    return d, o, packet, F[4:4 + n].decode("utf-8")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "tests/vectors.json"
    data = json.load(open(path, encoding="utf-8"))
    streams = [stream(0, 65536), stream(1, 65536)]
    for i, v in enumerate(data["vectors"]):
        d, o, packet, text = decrypt(streams, decode_glyphs(v["armored"]))
        assert text == v["plaintext"], f"vector {i}: plaintext mismatch"
        assert packet.hex() == v["packet_hex"], f"vector {i}: packet mismatch"
        assert encrypt(streams, "0123456789abcdef", d, o, text) == packet, f"vector {i}: re-encryption mismatch"
        print(f"vector {i}: OK  ({'A→B' if d == 0 else 'B→A'}, offset {o}, P {v['P']})")
    print("All vectors verified independently.")


if __name__ == "__main__":
    main()
