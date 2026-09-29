// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU64, GetString8 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const C = Object.freeze({
    UserId: Crc32('USERID'),
    Gamertag: Crc32('GAMERTAG'),
    DisplayName: 0xb28711b9,
    Id2834: 0x2834e7b8,
    IdFab7: 0xfab7631f,
    Result: Crc32('RESULT'),
    Success: Crc32('SUCCESS'),
});

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const UserId = GetU64(Fields, C.UserId) ?? Context.userId ?? 1n;
    const Name = (GetString8(Fields, C.Gamertag) || GetString8(Fields, C.DisplayName) || Context.gamertag || '').trim();
    return new Builder()
        .AddU64(C.UserId, UserId)
        .AddString8(C.Gamertag, Name)
        .AddString8(C.DisplayName, Name)
        .AddU64(C.Id2834, GetU64(Fields, C.Id2834) ?? 0n)
        .AddU64(C.IdFab7, GetU64(Fields, C.IdFab7) ?? 0n)
        .AddU32(C.Result, C.Success)
        .Build();
}

module.exports = { Build, GetAccount: Build, C, Status: 'VERIFIED_2K21_ADJACENT' };
