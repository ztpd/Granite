// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

function Build(Input) {
    const Fields = Input?.Parsed?.Fields || [];
    return new Builder()
        .AddU64(Crc32('VERSION'), GetU64(Fields, Crc32('VERSION')) ?? 2n)
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'))
        .Build();
}

module.exports = { Build, Enumerate: Build, Status: 'VERIFIED_EMPTY_FEED' };
