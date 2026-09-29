// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Table = (() => {
    const T = new Uint32Array(256);
    for (let N = 0; N < 256; N++) {
        let C = N;
        for (let K = 0; K < 8; K++) C = C & 1 ? 0xedb88320 ^ (C >>> 1) : C >>> 1;
        T[N] = C >>> 0;
    }
    return T;
})();

function Crc32(Text) {
    let C = 0xffffffff;
    for (let I = 0; I < Text.length; I++) C = Table[(C ^ Text.charCodeAt(I)) & 0xff] ^ (C >>> 8);
    return (C ^ 0xffffffff) >>> 0;
}

function ByteSwap(Value) {
    const V = Value >>> 0;
    return ((V >>> 24) | ((V >>> 8) & 0xff00) | ((V << 8) & 0xff0000) | (V << 24)) >>> 0;
}

function Hex(Value) {
    return '0x' + (Value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

module.exports = { Crc32, ByteSwap, Hex };
