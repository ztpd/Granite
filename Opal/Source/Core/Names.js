// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc32, ByteSwap, Hex } = require('./Crc32');

const Names = [
    'COMMAND',
    'LOCATION',
    'NAME',
    'MATCH_ID',
    'MATCH_TYPE',
    'MATCH_VERSION',
    'TEAM_ID',
    'USER_ID_LIST',
    'SESSION_NAME',
    'WORLD_TYPE',
    'WORLD_VERSION',
    'SEARCH_STATE',
    'URL',
    'PLATFORM',
    'COMPRESSED_DATA',
    'USERDATA',
    'PUID',
    'PLAYER_PUID',
    'SQUAD_INVITE',
    'SQUAD_ACCEPT',
    'SQUAD_LEAVE',
    'FROM',
    'PLAYER_ID',
    'USER',
    'REGION',
    'POSITION',
    'RESULT',
    'SEARCH_REASON',
    'SEARCH_TYPE',
    'SOURCE_URL',
    'GROUP_COUNT',
    'TEAM_LEVEL',
    'DESTINATION_ROOM',
    'GAMBLING_ID',
    'GAMESESSIONID',
    'MATCHTYPE',
    'NUMBEROFUSERS',
    'QUARTER_LENGTH',
    'USERID',
    'POS',
    'PLAYERRATING',
    'USERTEAMID',
    'OPPTEAMID',
    'USERISHOME',
    'W',
    'L',
    'D',
    'Q',
    'RATING',
    'FGM',
    'FGA',
    '3PM',
    '3PA',
    'FTM',
    'FTA',
    'PTS',
    'AST',
    'REB',
    'OREB',
    'DREB',
    'DFGA',
    'DFGM',
    'PM',
    'STL',
    'BLK',
    'FLS',
    'TO',
    '2X2',
    '3X2',
    'POSS',
    'DUNKS',
    'LAYUPS',
    'POINTSINPAINT',
    'FASTBREAKPOINTS',
    'PUTBACKPOINTS',
    'PLAYEROFTHEGAME',
    'MINUTES',
    'TIME_PLAYED',
    'COMPLETIONSTATUS',
    'PARK_AFFILIATION',
    'PARK_TYPE',
    'PARK_COURT_NAME',
    'PARK_COURT_INDEX',
    'PARK_STREAK',
    'POINTS_RESPONSIBLE_FOR',
    'SECOND_CHANCE_POINTS',
    'PASSES_INTERCEPTED',
    'PTS_OFF_TURNOVER',
    'TO_FORCED',
    'POINTS_MADE_IN_PAINT',
    'POINTS_ATTEMPTED_IN_PAINT',
    'POINTS_MADE_MIDRANGE',
    'POINTS_ATTEMPTED_MIDRANGE',
    'POINTS_MADE_CATCH_AND_SHOOT',
    'POINTS_ATTEMPTED_CATCH_AND_SHOOT',
    'POINTS_MADE_PICK_AND_ROLL',
    'POINTS_ATTEMPTED_PICK_AND_ROLL',
    'OBJECT_DATA',
    'OBJECT_UPDATE',
    'OBJECT_DATA_LIST',
    'OBJECT_UPDATE_LIST',
    'REQUEST_ACK',
    'HELLO',
    'HEARTBEAT',
    'NONE',
    'WALKING',
    'GOT_NEXT',
    'PLAYING',
    'PENDING',
    'JOIN',
    'WORLD',
    'MYCOURT',
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
    'PARK',
];

const Observed = {
    COMMAND: 0xb18f14ce,
    LOCATION: 0x98ad1587,
    NAME: 0x68b693b2,
    MATCH_ID: 0xd4c0767a,
    MATCH_TYPE: 0x27efd460,
    MATCH_VERSION: 0x1780ec1f,
    TEAM_ID: 0x2e646054,
    USER_ID_LIST: 0x3a60fe52,
    SESSION_NAME: 0xcca11838,
    WORLD_TYPE: 0x9844a7c6,
    WORLD_VERSION: 0x8f639d27,
    SEARCH_STATE: 0x05385d34,
    URL: 0x62d10724,
    PLATFORM: 0xff614c87,
    COMPRESSED_DATA: 0x970e50df,
    USERDATA: 0xcdbd175e,
    NONE: 0x4905ed7b,
    WALKING: 0x9705bb0d,
    GOT_NEXT: 0xca9b2162,
    PLAYING: 0xecbccdf8,
    PENDING: 0xeb9084a3,
    JOIN: 0x1ef43563,
    PUID: 0xd0344d20,
    SQUAD_INVITE: 0xe1463584,
    SQUAD_ACCEPT: 0x9584c867,
    SQUAD_LEAVE: 0xe6a57fc0,
    FROM: 0x8f8f4cc4,
    PLAYER_PUID: 0x08794d4b,
    PLAYER_ID: 0xe569add0,
    USER: 0xbb063bfd,
    REGION: 0xff9a36f0,
    POSITION: 0x801f78b9,
    RESULT: 0xe3920695,
    SEARCH_REASON: 0x0babdc6a,
    SEARCH_TYPE: 0x9b06ffac,
    SOURCE_URL: 0x0e2ff2ee,
    GROUP_COUNT: 0x5f5af8db,
    TEAM_LEVEL: 0x51df9d5a,
    DESTINATION_ROOM: 0x642dc870,
    WORLD: 0xcd23d3f3,
    PARK: 0xf2929087,
    MYCOURT: 0xc1e9be6a,
    BOULEVARD: 0x19b63986,
    PRELUDE_STREET: 0x32838485,
    GAMBLING: 0x1d389fb9,
    PARK_AFTER_DARK: 0xaa9a8630,
    CRIB: 0x7eb406e1,
    TEAM: 0xf2754bab,
    WALK_ON: 0xef69ed2a,
    TEAM_TRAINING: 0xc9edd6b7,
    LAB: 0xf771f34e,
    SLAMBALL: 0x3aa40b83,
    DYNAMIC_ARENA: 0xaa078173,
    DYNAMIC_ARENA_ROAMING: 0x7da84f70,
    DYNAMIC_OUTDOOR_EVENT: 0xc31f074b,
    EVENT: 0xccfac817,
    PRIZEWHEELBUILDING: 0x55552c6b,
};

const Unnamed = {
    0x1dee499c: 'connect, constant 0x92E56E10',
    0x2e6bc5cc: 'connect, bool always 1',
    0x4b7ad8c3: 'activity / match flag',
    0x51df9d5a: 'connect, config+296',
    0x53d8418b: 'connect, u64 = 30',
    0x584b0f04: 'connect, config+592',
    0x5cedb580: 'destination identity, shares config+312 with WorldType',
    0x5f496877: 'connect, config+272',
    0x64bb8716: 'routing string',
    0x693578b9: 'connect, config+280',
    0x693736f0: 'build host / mode index',
    0x7e496427: 'connect, carries None',
    0x801f78b9: 'connect, config+584',
    0x9ad3e8f7: 'empty blob',
    0xab31ac76: 'search string',
    0xd615f1d1: 'unix timestamp',
    0xe301c3ff: 'room descriptor blob, 384 bytes',
    0xa10e3dbc: 'pending request kind, generic sender',
    0x338eda44: 'pending request kind, SendObjectUpdate',
    0x4cc2c3a9: 'pending request kind, SendHello',
};

const ByName = Object.create(null);
const ByValue = new Map();

for (const Name of Names) {
    const Value = Crc32(Name);
    ByName[Name] = Value;
    if (!ByValue.has(Value)) ByValue.set(Value, { name: Name, Swapped: false });
    const Swapped = ByteSwap(Value);
    if (!ByValue.has(Swapped)) ByValue.set(Swapped, { name: Name, Swapped: true });
}

for (const [Name, Expected] of Object.entries(Observed)) {
    const Actual = ByName[Name];
    if (Actual !== Expected >>> 0) {
        throw new Error(`crc mismatch for ${Name}: derived ${Hex(Actual)} but captures show ${Hex(Expected)}`);
    }
}

function ToPascal(Name) {
    return Name.split('_')
        .filter(Boolean)
        .map((P) => P.charAt(0).toUpperCase() + P.slice(1).toLowerCase())
        .join('');
}

const Display = Object.create(null);
for (const Name of Names) Display[Name] = ToPascal(Name);

function Resolve(Value) {
    return ByValue.get(Value >>> 0) || null;
}

function Describe(Value) {
    const Hit = Resolve(Value);
    if (Hit) return Display[Hit.name];
    return Hex(Value);
}

function NoteFor(Value) {
    return Unnamed[Value >>> 0] || null;
}

function Crc(Name) {
    const Value = ByName[Name];
    if (Value === undefined) throw new Error(`unknown engine name: ${Name}`);
    return Value;
}

module.exports = { Crc, Resolve, Describe, NoteFor, ToPascal, Names, Display };
