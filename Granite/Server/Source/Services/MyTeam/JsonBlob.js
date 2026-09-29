// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');
const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Crcs = Object.freeze({
    Result: Crc32('RESULT'),
    Json: Crc32('JSON'),
});

const Success = Crc32('SUCCESS');

const SkippedRootMember = 0xb4fa1177;

function Encode(Document) {
    return Zlib.deflateSync(Buffer.from(`${JSON.stringify(Document)}\0`, 'utf8'));
}

function Reply(Document) {
    return new Builder().AddU32(Crcs.Result, Success).AddBinary(Crcs.Json, Encode(Document)).Build();
}

module.exports = { Encode, Reply, Crcs, Success, SkippedRootMember };
