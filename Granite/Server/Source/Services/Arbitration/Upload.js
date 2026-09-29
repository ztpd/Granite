// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const { Builder, GetU64, GetU32 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const Logger = require('../../Core/Logger');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

const Services = Object.freeze({
    0xbe9c094d: 'ArbitrationV3/AsyncArbitration',
    0x728258cd: 'ArbitrationV3/AsyncArbitrationPark',
    0x58bd1cb0: 'ArbitrationV3/UploadGymActivityResults',
    0x6e101dab: 'ArbitrationV3/UploadGameResults_6E101DAB',
    0x4433e4a1: 'ArbitrationV3/UploadGameResults_4433E4A1',
    0x5c1d6652: 'ArbitrationV3/UploadGameResults_5C1D6652',
    0xb62129c1: 'ArbitrationV3/UploadGameResults_B62129C1',
    0x906f6d8b: 'ArbitrationV3/UploadGameResults_906F6D8B',
    0x373f9dbf: 'GameStatsV3/UpdateCourtScore',
});
const EndpointIds = Object.freeze(Object.keys(Services).map(Number));

const Routes = new Map(Object.entries(Services).map(([Id, Url]) => [Url.toLowerCase(), Number(Id) >>> 0]));

const NameFormats = Object.freeze(['', 'USER_', 'TEAM_', 'TEAM_PLAYER_', 'GROUP_']);
const Names = Object.freeze([
    '2X2',
    '3PA',
    '3PM',
    '3X2',
    '4PA',
    '4PM',
    'ACCOMPLISHED_ACCOLADE_TYPES',
    'ALLEY_OOP_ATTEMPTS',
    'ALLEY_OOP_PASS_SUCCESSES',
    'ARCHETYPE',
    'ASSISTS',
    'AST',
    'BALL_POSSESSIONS_NUM',
    'BLK',
    'BLKA',
    'BLOCKS',
    'BLOCK_ATTEMPT_INSIDE_DEFENDED_SHOTS',
    'BLOCK_ATTEMPT_INSIDE_IMPACT_SUM',
    'BLOCK_ATTEMPT_PERIMETER_DEFENDED_SHOTS',
    'BLOCK_ATTEMPT_PERIMETER_IMPACT_SUM',
    'CLOUD_SAVE_ID',
    'COMPLETIONSTATUS',
    'D',
    'DEFENDER_BODYUPS_NUM',
    'DFGA',
    'DFGM',
    'DREB',
    'DRIBBLE_MOVES_NUM',
    'DUNKS',
    'ELEAGUE_REPLAY_DATA_VERSION',
    'EVENT_ID',
    'EVENT_MATCH_ID',
    'FASTBREAKPOINTS',
    'FGA',
    'FGM',
    'FLS',
    'FOULS',
    'FREE_THROW_TIMING_DISTRIBUTION',
    'FREE_THROW_TIMING_DISTRIBUTION_TOTAL_ERROR',
    'FREE_THROW_TIMING_DISTRIBUTION_TOTAL_SHOTS',
    'FTA',
    'FTM',
    'FTM_PERFECT_RELEASE',
    'GAMBLING_ID',
    'GAMESESSIONID',
    'GOODSHOTDEFENSE',
    'ID',
    'IN_PLAY_TOUCHES',
    'ISHOME',
    'IS_PRELUDE_OVER',
    'L',
    'LAYUPS',
    'LAYUP_TIMING_DISTRIBUTION',
    'LAYUP_TIMING_DISTRIBUTION_TOTAL_ERROR',
    'LAYUP_TIMING_DISTRIBUTION_TOTAL_SHOTS',
    'MATCHTYPE',
    'MATCHTYPE_NEW',
    'MINUTES',
    'MULTIDEFENSESTOPS',
    'NUMBEROFPLAYERS',
    'NUMBEROFUSERS',
    'OPPOSING_TEAM_DREB',
    'OPPOSING_TEAM_OREB',
    'OPPTEAMID',
    'OREB',
    'OREBOUNDS',
    'PARK',
    'PARK_AFFILIATION',
    'PARK_COURT_INDEX',
    'PARK_COURT_NAME',
    'PARK_STREAK',
    'PARK_TYPE',
    'PASSES_CAUGHT',
    'PASSES_INTERCEPTED',
    'PASSES_THROWN',
    'PASS_TO_ASSIST',
    'PASS_TO_OPEN_SHOT',
    'PLAYEROFTHEGAME',
    'PLAYERRATING',
    'PLAYNOW_LEAGUE',
    'PLAYNOW_TIER',
    'PM',
    'POINTS',
    'POINTSINPAINT',
    'POINTSOFFPOSTPLAY',
    'POINTS_ATTEMPTED_CATCH_AND_SHOOT',
    'POINTS_ATTEMPTED_IN_PAINT',
    'POINTS_ATTEMPTED_MIDRANGE',
    'POINTS_ATTEMPTED_PICK_AND_ROLL',
    'POINTS_MADE_CATCH_AND_SHOOT',
    'POINTS_MADE_IN_PAINT',
    'POINTS_MADE_MIDRANGE',
    'POINTS_MADE_PICK_AND_ROLL',
    'POINTS_RESPONSIBLE_FOR',
    'POKED_BALL_LOSE',
    'POS',
    'POSS',
    'PTS',
    'PTS_OFF_TURNOVER',
    'PUTBACKPOINTS',
    'Q',
    'QUARTER_LENGTH',
    'RATING',
    'REB',
    'REBOUNDS',
    'RELAY_ADDRESS',
    'ROSTER_ID',
    'SCORE',
    'SECOND_CHANCE_POINTS',
    'SHOOTING_FOULS',
    'SHOT_CONTEST_INSIDE_DEFENDED_SHOTS',
    'SHOT_CONTEST_INSIDE_IMPACT_SUM',
    'SHOT_CONTEST_PERIMETER_DEFENDED_SHOTS',
    'SHOT_CONTEST_PERIMETER_IMPACT_SUM',
    'SHOT_TIMING_DISTRIBUTION',
    'SHOT_TIMING_DISTRIBUTION_TOTAL_ERROR',
    'SHOT_TIMING_DISTRIBUTION_TOTAL_SHOTS',
    'SMARTDOUBLETEAM',
    'STARTED',
    'STEALS',
    'STEAL_FOULS',
    'STL',
    'STLA',
    'STOPPEDALLEYPASS',
    'STOPPEDFASTBREAK',
    'STRATEGY_CARDS_USED',
    'TEAM_DREB',
    'TEAM_ID',
    'TEAM_OREB',
    'THEORETICAL_2PT_ACCUMULATED_CHANCE',
    'THEORETICAL_3PT_ACCUMULATED_CHANCE',
    'THEORETICAL_FREE_THROW_ACCUMULATED_CHANCE',
    'THEORETICAL_LAYUPA',
    'THEORETICAL_LAYUP_ACCUMULATED_CHANCE',
    'THREEPOINTSHOTSMADE',
    'TIMEPLAYED',
    'TIME_HELD_BALL',
    'TIME_PLAYED',
    'TO',
    'TOURNAMENT_ROUND',
    'TO_FORCED',
    'TURNOVERS',
    'USERID',
    'USERISHOME',
    'USERTEAMID',
    'VERSION',
    'W',
    'WORLD_ID',
    'WORLD_TEAM_ID',
]);

const NameByCrc = new Map();
for (const Name of Names) {
    for (const Format of NameFormats) NameByCrc.set(Crc32(Format + Name) >>> 0, Format + Name);
}

const Aliases = new Map([
    ['arbitration/gym_activity', 0x58bd1cb0],
    ['onlinearbitration/gym_activity', 0x58bd1cb0],
]);

function Resolve(Route) {
    const Key = String(Route || '').toLowerCase();
    if (Routes.has(Key)) return Routes.get(Key);
    return Aliases.has(Key) ? Aliases.get(Key) : null;
}

function Describe(Fields) {
    return Fields.map((Field) => {
        const Entry = {
            Crc: Field.CrcHex,
            name: NameByCrc.get(Field.Crc >>> 0) || null,
            Type: Field.TypeName,
        };
        if (Buffer.isBuffer(Field.value)) Entry.value = { Bytes: Field.value.length, Hex: Field.value.toString('hex') };
        else if (typeof Field.value === 'bigint') Entry.value = Field.value.toString();
        else if (Field.value !== undefined) Entry.value = Field.value;
        else Entry.value = Field.Data1 >>> 0;
        return Entry;
    });
}

function Summary(Fields) {
    const Users = [];
    const Ids = Fields.filter((Field) => Field.Crc >>> 0 === Crc32('USER_USERID') >>> 0);
    Ids.forEach((Field, Index) => {
        const Read = (Name) => {
            const Value = GetU64(Fields, Crc32(`USER_${Name}`), Index);
            return Value === null ? null : Value.toString();
        };
        Users.push({
            userId: Read('USERID'),
            W: Read('W'),
            L: Read('L'),
            D: Read('D'),
            Pts: Read('PTS'),
            Reb: Read('REB'),
            Ast: Read('AST'),
            rating: Read('PLAYERRATING'),
        });
    });
    const Session = GetU64(Fields, Crc32('GAMESESSIONID'));
    return { GameSessionId: Session === null ? null : Session.toString(), Users };
}

function Store(Directory, Record) {
    if (!Directory) return null;
    const Day = Record.ReceivedAt.slice(0, 10);
    const Folder = Path.join(Directory, Day);
    Fs.mkdirSync(Folder, { recursive: true });
    const Stamp = Record.ReceivedAt.replace(/[-:.TZ]/g, '');
    const Name = `${Stamp}_${Record.Service.replace(/[^A-Za-z0-9_]+/g, '_')}_${Record.Summary.GameSessionId || 'nosession'}_${Record.userId || 'anonymous'}.json`;
    const File = Path.join(Folder, Name);
    Fs.writeFileSync(File, `${JSON.stringify(Record, null, 2)}\n`, 'utf8');
    return File;
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const ServiceId = Context.ArbitrationServiceId ?? Resolve(Context.Route || '');
    const Service = ServiceId === null ? 'unknown arbitration service' : Services[ServiceId];
    const Record = {
        ReceivedAt: new Date().toISOString(),
        Service,
        ServiceId: ServiceId === null ? null : `0x${(ServiceId >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        userId: Context.userId === undefined || Context.userId === null ? null : String(Context.userId),
        Summary: Summary(Fields),
        Fields: Describe(Fields),
    };
    try {
        const File = Store(Context.ArbitrationDirectory, Record);
        const Players = Record.Summary.Users.map(
            (U) => `${U.userId}${U.W === '1' ? ' W' : U.L === '1' ? ' L' : ''}`,
        ).join(', ');
        Logger.Info(
            `${Service}: ${Fields.length} fields, game ${Record.Summary.GameSessionId || '-'}` +
                (Players ? `, players ${Players}` : '') +
                (File ? `, stored ${Path.basename(File)}` : ''),
        );
    } catch (Failure) {
        Logger.Error(`${Service} upload could not be stored: ${Failure.message}`);
    }
    return new Builder().AddU32(Result, Success).Build();
}

module.exports = {
    Build,
    Upload: Build,
    Resolve,
    Describe,
    Summary,
    EndpointIds,
    Services,
    NameByCrc,
    Status: 'IDA_TRACED_2K19_ARBITRATION_UPLOADS',
};
