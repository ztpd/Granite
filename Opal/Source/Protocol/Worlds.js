// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc, Describe } = require('../Core/Names');
const { Crc32, Hex } = require('../Core/Crc32');

const Table = [
    'NONE',
    'BOULEVARD',
    'PRELUDE_STREET',
    'GAMBLING',
    'PARK_AFTER_DARK',
    'CRIB',
    'TEAM',
    'WALK_ON',
    'TEAM_TRAINING',
    'LAB',
    'SLAMBALL',
    'DYNAMIC_ARENA',
    'DYNAMIC_ARENA_ROAMING',
    'DYNAMIC_OUTDOOR_EVENT',
    'EVENT',
    'PRIZEWHEELBUILDING',
];

const Keys = Table.map((Name) => Crc(Name));

const ServerType = {
    World: Crc('WORLD'),
    Park: Crc('PARK'),
    MyCourt: Crc('MYCOURT'),
};

const ActivityOverride = { BOULEVARD: 0x3cf672c2 };

const Activities = Object.create(null);
for (const Name of Table) {
    Activities[Name] = ActivityOverride[Name] !== undefined ? ActivityOverride[Name] >>> 0 : Crc32(Name.toLowerCase());
}

if (Activities.GAMBLING !== 0xdb0b03f5) throw new Error('gambling activity key drifted');
if (Activities.SLAMBALL !== 0xfc9797cf) throw new Error('slamball activity key drifted');

const Evidence2K19 = Object.freeze({
    WorldKeys: Object.freeze({
        BOULEVARD: 0x19b63986,
        GAMBLING: 0x1d389fb9,
        SLAMBALL: 0x3aa40b83,
        CRIB: 0x7eb406e1,
    }),
    ActivityKeys: Object.freeze({
        BOULEVARD: 0x3cf672c2,
        GAMBLING: 0xdb0b03f5,
        SLAMBALL: 0xfc9797cf,
        Mycourt: 0xfeac4070,
    }),
    ServerTypes: Object.freeze({ World: 0xcd23d3f3, Park: 0xf2929087, Mycourt: 0xc1e9be6a }),
    StringOnlyWorldNames: Object.freeze(['NBA2K19_INDIANA_STATE_FAIR_WORLD']),
});

function IndexOf(WorldKey) {
    return Keys.indexOf(WorldKey >>> 0);
}

function NameOf(WorldKey) {
    const Index = IndexOf(WorldKey);
    return Index < 0 ? null : Table[Index];
}

function Label(WorldKey) {
    const Name = NameOf(WorldKey);
    return Name ? Name.toLowerCase().replace(/_/g, ' ') : `world ${Hex(WorldKey)}`;
}

function ActivityFor(WorldKey) {
    const Name = NameOf(WorldKey);
    return Name ? Activities[Name] : null;
}

function AssertRoutable(WorldKey) {
    const Index = IndexOf(WorldKey);
    if (Index < 0) {
        throw new Error(
            `world key ${Hex(WorldKey)} is not in the client's world table; ` +
                `the route flag would be cleared and the client would never dial`,
        );
    }
    if (Index === 0) {
        throw new Error(
            `world key ${Hex(WorldKey)} is table index 0 (None); ` +
                `HandleChangeServerPacket clears the route flag for index 0`,
        );
    }
    return Index;
}

module.exports = {
    Table,
    Keys,
    ServerType,
    Activities,
    IndexOf,
    NameOf,
    Label,
    ActivityFor,
    AssertRoutable,
    Describe,
    Evidence2K19,
};
