// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');

const Table = (() => {
    const TableValue = new Uint32Array(256);
    for (let N = 0; N < 256; N++) {
        let C = N;
        for (let K = 0; K < 8; K++) C = C & 1 ? 0xedb88320 ^ (C >>> 1) : C >>> 1;
        TableValue[N] = C >>> 0;
    }
    return TableValue;
})();

function Fallback(Bytes) {
    let C = 0xffffffff;
    for (let I = 0; I < Bytes.length; I++) C = Table[(C ^ Bytes[I]) & 0xff] ^ (C >>> 8);
    return (C ^ 0xffffffff) >>> 0;
}

const Native = typeof Zlib.Crc32 === 'function' ? Zlib.Crc32 : null;

function Crc32(Value) {
    const Bytes = Buffer.isBuffer(Value) ? Value : Buffer.from(String(Value), 'utf8');
    return (Native ? Native(Bytes) : Fallback(Bytes)) >>> 0;
}

function U32(Value) {
    if (typeof Value === 'number') return Value >>> 0;
    if (typeof Value === 'bigint') return Number(BigInt.asUintN(32, Value));
    const Text = String(Value).trim();
    const Parsed = Text.toLowerCase().startsWith('0x') ? Number.parseInt(Text.slice(2), 16) : Number.parseInt(Text, 10);
    if (!Number.isFinite(Parsed)) throw new TypeError(`invalid u32: ${Value}`);
    return Parsed >>> 0;
}

function Hex32(Value) {
    return `0x${U32(Value).toString(16).toUpperCase().padStart(8, '0')}`;
}

module.exports = { Crc32, U32, Hex32 };
