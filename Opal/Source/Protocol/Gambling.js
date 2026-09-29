// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc, Describe } = require('../Core/Names');
const { Hex } = require('../Core/Crc32');

const WorldKey = Crc('GAMBLING');
const ActivityKey = 0xdb0b03f5;

const Fields = Object.freeze({
    GamblingId: Crc('GAMBLING_ID'),
    GameSessionId: Crc('GAMESESSIONID'),
    MatchType: Crc('MATCHTYPE'),
    NumberOfUsers: Crc('NUMBEROFUSERS'),
    QuarterLength: Crc('QUARTER_LENGTH'),
    UserId: Crc('USERID'),
    Pos: Crc('POS'),
    PlayerRating: Crc('PLAYERRATING'),
    UserTeamId: Crc('USERTEAMID'),
    OppTeamId: Crc('OPPTEAMID'),
    UserIsHome: Crc('USERISHOME'),
    Park: Crc('PARK'),
    ParkAffiliation: Crc('PARK_AFFILIATION'),
    ParkType: Crc('PARK_TYPE'),
    ParkCourtName: Crc('PARK_COURT_NAME'),
    ParkCourtIndex: Crc('PARK_COURT_INDEX'),
    ParkStreak: Crc('PARK_STREAK'),
});

const WireFields = Object.freeze({
    CourtPrices: Object.freeze({
        RequestKind: 0xef80d074,
        RequestContext: 0x62d3911c,
        RequestMode: 0xe3efdfb3,
        RequestBlob: 0xfe819fca,
        RepeatedPrice: 0xd81bb30f,
        Multiplier: 0x52621e11,
        GamblingId: Fields.GamblingId,
        LimitCount: 0x15a7d7e2,
        LimitPrefix: 'LIMIT_%d',
        AlternateEntry: 0x1c0ba990,
        AlternatePrice: 0x711b1aae,
        AlternateId: 0x8f893227,
    }),
    PlaceBet: Object.freeze({
        CurrencyOrBalance: 0x29c281bd,
        GamblingId: Fields.GamblingId,
        CourtIndex: 0x1d669aa5,
    }),
    PrizeWheelSpin: Object.freeze({
        Request: 0xbc385a24,
        Context: 0x5611cb51,
        User: 0xd5e5f21d,
    }),
    PrizeWheelStatus: Object.freeze({
        Request: 0xf821a709,
        User: 0xd5e5f21d,
    }),
});

const Services = Object.freeze({
    CurrentLimits: Object.freeze({
        Id: 0x5095f4be,
        Path: '/Gambling/current_limits',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/current_limits',
        Ida: '0x1412A60B0',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    PlaceBet: Object.freeze({
        Id: 0x5d0ecd48,
        Path: '/Gambling/place_bet',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/place_bet',
        Ida: '0x14129A750',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    ScheduledPrizeWheelStatus: Object.freeze({
        Id: 0xe1982985,
        Path: '/Gambling/prize_wheel/get_scheduled_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/get_scheduled_status',
        Ida: null,
        Evidence: 'NOT_OBSERVED_STATIC_2K19',
    }),
    PrizeWheelStatus: Object.freeze({
        Id: 0xc3741502,
        Path: '/Gambling/prize_wheel/get_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/get_status',
        Ida: '0x14023B010',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    PrizeWheelSpin: Object.freeze({
        Id: 0x399bf790,
        Path: '/Gambling/prize_wheel/spin',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/spin',
        Ida: '0x140226090',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    UserStatus: Object.freeze({
        Id: 0x37a37dbe,
        Path: '/Gambling/user_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/user_status',
        Ida: null,
        Evidence: 'NOT_OBSERVED_STATIC_2K19',
    }),
});

const ServiceByPath = new Map(Object.values(Services).map((Service) => [Service.Path.toLowerCase(), Service]));
const ServiceById = new Map(Object.values(Services).map((Service) => [Service.Id >>> 0, Service]));

const Methods = Object.freeze([
    'TK_WORLD::INFORMATION::RequestCourtPrices',
    'TK_WORLD::INFORMATION::PlaceBet',
    'TK_WORLD::PRIZE_WHEEL::RequestWheelSpinResultFromServer',
    'AI_ACTIVITY_GAMBLING::CheckExitArea',
    'OnlineArbitration_UploadGameResults',
]);

function IsWorld(WorldKeyValue) {
    return WorldKeyValue !== null && WorldKeyValue !== undefined && Number(WorldKeyValue) >>> 0 === WorldKey;
}

function IsActivity(ActivityKeyValue) {
    return (
        ActivityKeyValue !== null && ActivityKeyValue !== undefined && Number(ActivityKeyValue) >>> 0 === ActivityKey
    );
}

function IsGambling({ WorldKey: WorldKeyValue = null, ActivityKey: ActivityKeyValue = null } = {}) {
    return IsWorld(WorldKeyValue) || IsActivity(ActivityKeyValue);
}

function ReadField(List, CrcValue, Index = 0) {
    const FieldValues = List?.Fields || [];
    return FieldValues.filter((Field) => Field.Crc >>> 0 === CrcValue >>> 0)[Index] || null;
}

function ReadValue(List, CrcValue, Index = 0) {
    const Field = ReadField(List, CrcValue, Index);
    if (!Field) return null;
    if (Field.Value !== undefined) return Field.Value;
    if (Field.value !== undefined) return Field.value;
    return Field.Data1 >>> 0;
}

function ReadArbitration(List, Index = 0) {
    const Output = {};
    for (const [Name, CrcValue] of Object.entries(Fields)) {
        const Value = ReadValue(List, CrcValue, Index);
        if (Value !== null) Output[Name] = Value;
    }
    return Output;
}

function DescribeService(ServiceOrId) {
    const Service = typeof ServiceOrId === 'object' ? ServiceOrId : ServiceById.get(Number(ServiceOrId) >>> 0);
    if (!Service) return Hex(Number(ServiceOrId) >>> 0);
    return `${Service.Path} (${Hex(Service.Id)}, ${Service.Evidence})`;
}

module.exports = {
    WorldKey,
    ActivityKey,
    Fields,
    WireFields,
    Services,
    ServiceByPath,
    ServiceById,
    Methods,
    IsWorld,
    IsActivity,
    IsGambling,
    ReadField,
    ReadValue,
    ReadArbitration,
    DescribeService,
    Describe,
};
