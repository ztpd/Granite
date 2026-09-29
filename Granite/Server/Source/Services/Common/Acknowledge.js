// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build() {
    return new Builder().AddU32(Result, Success).Build();
}

module.exports = { Build, Acknowledge: Build, Status: 'REAL_RESULT_ONLY' };
