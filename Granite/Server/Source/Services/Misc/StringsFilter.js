// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const StringField = Crc32('STRING');

function Build(Input) {
    const Strings = (Input?.Parsed?.Fields || []).filter(
        (Field) => Field.Type === Types.String8 || Field.Type === Types.String16,
    );
    const Reply = new Builder();
    for (const Field of Strings) Reply.AddBool(StringField, true);
    if (!Strings.length) Reply.AddBool(StringField, true);
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build, StringsFilter: Build, Status: 'REAL_ALLOW_ALL_POLICY' };
