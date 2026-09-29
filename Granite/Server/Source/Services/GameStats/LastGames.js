// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

function Build() {
    return new Builder().AddU64(Crc32('NUMBER_OF_RECORDS'), 0n).AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build, LastGames: Build, Status: 'VERIFIED_2K17_EMPTY_HISTORY_CROSS_VERSION' };
