// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc32, U32, Hex32 } = require('./Crc32');

const Confirmed = [
    'SESSION_KEY',
    'STRINGCRC',
    'U64',
    'S64',
    'BOOL',
    'STRING16',
    'BINARY',
    'F32',
    'RESULT',
    'SUCCESS',
    'USERID',
    'GAMERTAG',
    'FILETYPE',
    'FILENAME',
    'DESCRIPTION',
    'EXTRA_DATA_SIZE',
    'MAXRESULTS',
    'CATEGORY',
    'FILTER',
    'ORDERBY',
    'VERSION',
    'DISPLAYNAME',
    'NUMVOTES',
    'FILEID',
    'DATASIZE',
    'FILEPATH',
    'RATING',
    'NUMDOWNLOADS',
    'TITLEID',
    'MOREAVAILABLE',
    'GAMBLING_ID',
    'GAMESESSIONID',
    'MATCHTYPE',
    'NUMBEROFUSERS',
    'QUARTER_LENGTH',
    'USERTEAMID',
    'OPPTEAMID',
    'USERISHOME',
    'PARK',
    'PARK_AFFILIATION',
    'PARK_TYPE',
    'PARK_COURT_NAME',
    'PARK_COURT_INDEX',
    'PARK_STREAK',
    'PLAYERRATING',
    'COMPLETIONSTATUS',
    'POINTSINPAINT',
    'FASTBREAKPOINTS',
    'PUTBACKPOINTS',
    'PLAYEROFTHEGAME',
    'TIME_PLAYED',
    'TEAM_NAME',
    'TEAM_ID',
    'CITY_NAME',
    'TEAM_LOGO_PATH',
];

const ByCrc = new Map(Confirmed.map((Name) => [Crc32(Name), Name]));

function Resolve(Value) {
    return ByCrc.get(U32(Value)) || null;
}

function Register(Name) {
    const Value = Crc32(Name);
    if (!ByCrc.has(Value)) ByCrc.set(Value, Name);
    return Value;
}

function* Variants(Word) {
    const Upper = String(Word).trim().toUpperCase();
    if (!Upper) return;
    yield Upper;
    yield Upper.replaceAll('-', '_');
    yield Upper.replaceAll('_', '');
    yield Upper.replaceAll('_', '-');
}

function BruteForce(Targets, Words) {
    const Wanted = new Set(Targets.map(U32));
    const Found = new Map();
    for (const Word of [...Confirmed, ...(Words || [])]) {
        for (const Candidate of Variants(Word)) {
            const Value = Crc32(Candidate);
            if (Wanted.has(Value) && !Found.has(Value)) {
                Found.set(Value, Candidate);
                ByCrc.set(Value, Candidate);
            }
        }
    }
    return Found;
}

module.exports = { Confirmed, Resolve, Register, BruteForce, Crc32, U32, Hex32 };
