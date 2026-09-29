// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Zlib = require('node:zlib');
const { Builder, Types, Parse, GetU32, GetU64, GetString8, Crc32 } = require('../Source/Codec/FieldList');

Test('VcFieldList preserves records, values, arrays, strings, and gzip', () => {
    const Built = new Builder()
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .AddU64(Crc32('USERID'), 0x0110000100000666n)
        .AddString8(Crc32('GAMERTAG'), 'Granite')
        .AddU64(0x11111111, 1n)
        .AddU64(0x11111111, 2n)
        .Build();
    const Decoded = Parse(Built.Body);
    Assert.equal(GetU32(Decoded.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(Decoded.Fields, Crc32('USERID')), 0x0110000100000666n);
    Assert.equal(GetString8(Decoded.Fields, Crc32('GAMERTAG')), 'Granite');
    Assert.equal(Decoded.Fields.filter((Field) => Field.Crc === 0x11111111).length, 2);
    Assert.equal(Decoded.Fields.find((Field) => Field.Type === Types.String8).DataOffset % 8, 0);
    Assert.equal(Parse(Zlib.gzipSync(Built.Body)).Fields.length, 5);
});

Test('declared VCFIELDLIST_SIZE separates an exact trailing payload', () => {
    const Payload = Buffer.from('424e48211000000000112233445566778899aabbccddeeff', 'hex');
    const Built = new Builder()
        .AddU64(Crc32('EXTRA_DATA_SIZE'), BigInt(Payload.length))
        .AlignData(8)
        .Build({ Trailing: Payload });
    const Decoded = Parse(Built.Body, { FieldListSize: Built.FieldListSize });
    Assert.deepEqual(Decoded.Trailing, Payload);
    Assert.equal(Decoded.WireSize, Built.FieldListSize);
});
