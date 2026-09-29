// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Scalars = [
    Crc32('USER_LEAGUE_ID'),
    Crc32('USER_WINS_TOTAL'),
    Crc32('USER_LOSS_TOTAL'),
    0x26e3b60f,
    0xac867fe3,
    0x2f86a80a,
    Crc32('USER_WINS_FOR_TROPHY'),
    Crc32('USER_GAMES_REMAINING'),
    Crc32('USER_GAMES_PLAYED'),
    0x46b9d8a5,
    0x26bb2d59,
    0x046ee7ba,
    0x4fe8ff14,
    0xc69d7759,
    0x5f69ac3d,
    0xb630584f,
    Crc32('PPG'),
    0x921d3af5,
    Crc32('NUMBER_OF_RECORDS'),
    0x08092745,
    0xbc5cf5a6,
    0x403af069,
];

function Build() {
    const Reply = new Builder();
    for (const Field of Scalars) Reply.AddU64(Field, 0n);
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build, LeagueSummary: Build, Status: 'VERIFIED_2K17_NEW_PLAYER_SHAPE_CROSS_VERSION' };
