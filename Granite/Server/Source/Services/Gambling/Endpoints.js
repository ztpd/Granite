// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub } = require('../IdaSpecificStub');
const { Builder, GetU64, GetFields, Types, DateToVCDate } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const Policy = require('../../../../../Shared/AnteUp');
const Logger = require('../../Core/Logger');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

const UserStatusField = 0x5cecd555;
const UserStatus = Object.freeze({
    Ok: Crc32('OK'),
    Banned: 0x6bb1ca30,
    Blocked: 0xe510159a,
});

const PlaceBetResponse = Object.freeze({
    RollA: 0x1bea188e,
    RollB: 0x82e34934,
    RollC: 0xf5e479a2,
    Value1080: 3824148403,
    Value1088: 1113713710,
    Value1096: 4021069828,
    Value1120: 3199728789,
});
const RollValues = Object.freeze([0x8c612ff4, 0xb34a4dbc, 0x9d0e39b2, 0xf506fd7b, 0x8201cded, 0x6b6268d8]);
const PlaceBetRequest = Object.freeze({
    Currency: 0x29c281bd,
    ContextId: 0xdcff2a93,
    CourtIndex: 0x1d669aa5,
});

function BuildCurrentLimits() {
    const Reply = new Builder()
        .AddU32(Result, Success)
        .AddU32(UserStatusField, UserStatus.Ok)
        .AddU64(0xdcff2a93, Policy.GamblingId)
        .AddU64(0x15a7d7e2, Policy.LimitCount)
        .AddU64(4018196596, 0n)
        .AddVCDate(0x62d3911c, DateToVCDate(new Date()))
        .AddU64(3824148403, 0n)
        .AddF32(1382161937, 0);
    for (let I = 0; I < Policy.LimitCount; I++) {
        Reply.AddU64(Crc32(`LIMIT_${I}`), BigInt(Policy.ByIndex(I)?.entryVc || 0));
    }
    Logger.Verbose(
        `Ante-Up practice limits: id=${Policy.GamblingId}, ${Policy.LimitCount} court indices; no VC settlement`,
    );
    return Reply.Build();
}

function BuildPlaceBet(Input) {
    const Fields = Input?.Parsed?.Fields || [];
    const Index = GetU64(Fields, PlaceBetRequest.CourtIndex);
    const ContextId = GetU64(Fields, PlaceBetRequest.ContextId);
    const Typed = [PlaceBetRequest.CourtIndex, PlaceBetRequest.ContextId].every((Crc) => {
        const Records = GetFields(Fields, Crc);
        return Records.length === 1 && Records[0].Type === Types.U64;
    });
    const Court = Index !== null && Index !== undefined && Index < 64n ? Policy.ByIndex(Number(Index)) : null;
    if (!Typed || !Court || ContextId !== Policy.GamblingId) {
        Logger.Verbose(
            `Ante-Up rejected invalid/stale court index=${Index}, gamblingId=${ContextId}; reload current_limits and court objects`,
        );
        return new Builder().AddU32(Result, Crc32('FAILURE')).Build();
    }
    Logger.Verbose(
        `Ante-Up practice entry: ${Court.name}, index=${Index}, displayed price=${Court.entryVc}; VC unchanged`,
    );
    return new Builder()
        .AddU32(Result, Success)
        .AddU32(PlaceBetResponse.RollA, RollValues[0])
        .AddU32(PlaceBetResponse.RollB, RollValues[0])
        .AddU32(PlaceBetResponse.RollC, RollValues[0])
        .AddU64(PlaceBetResponse.Value1080, 0n)
        .AddU64(PlaceBetResponse.Value1088, 0n)
        .AddU64(PlaceBetResponse.Value1096, 0n)
        .AddU64(PlaceBetResponse.Value1120, 0n)
        .Build();
}

const Endpoints = Object.freeze({
    CurrentLimits: Object.freeze({
        Id: 0x5095f4be,
        Route: 'gambling/current_limits',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/current_limits',
        Ida: '0x1412A60B0',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    PlaceBet: Object.freeze({
        Id: 0x5d0ecd48,
        Route: 'gambling/place_bet',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/place_bet',
        Ida: '0x14129A750',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    ScheduledPrizeWheelStatus: Object.freeze({
        Id: 0xe1982985,
        Route: 'gambling/prize_wheel/get_scheduled_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/get_scheduled_status',
        Ida: null,
        Evidence: 'NOT_OBSERVED_STATIC_2K19',
    }),
    PrizeWheelStatus: Object.freeze({
        Id: 0xc3741502,
        Route: 'gambling/prize_wheel/get_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/get_status',
        Ida: '0x14023B010',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    PrizeWheelSpin: Object.freeze({
        Id: 0x399bf790,
        Route: 'gambling/prize_wheel/spin',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/prize_wheel/spin',
        Ida: '0x140226090',
        Evidence: 'IDA_EXACT_2K19_STATIC_LOOKUP',
    }),
    UserStatus: Object.freeze({
        Id: 0x37a37dbe,
        Route: 'gambling/user_status',
        Url: 'https://nba2k19-svc.2ksports.com:21133/nba/2k19/Gambling/user_status',
        Ida: null,
        Evidence: 'NOT_OBSERVED_STATIC_2K19',
    }),
});

const AllEndpointIds = Object.freeze(Object.values(Endpoints).map((Endpoint) => Endpoint.Id));
const EndpointIds = Object.freeze(
    Object.values(Endpoints)
        .filter((Endpoint) => Endpoint.Evidence === 'IDA_EXACT_2K19_STATIC_LOOKUP')
        .map((Endpoint) => Endpoint.Id),
);
const ByRoute = new Map(Object.values(Endpoints).map((Endpoint) => [Endpoint.Route, Endpoint]));
const ById = new Map(Object.values(Endpoints).map((Endpoint) => [Endpoint.Id >>> 0, Endpoint]));

function Resolve(RouteOrId) {
    if (typeof RouteOrId === 'string') return ByRoute.get(RouteOrId.toLowerCase()) || null;
    return ById.get(Number(RouteOrId) >>> 0) || null;
}

function Build(Input, Context = {}) {
    const Route = String(Context.Route || '').toLowerCase();
    const Endpoint = Resolve(Route) || Endpoints.CurrentLimits;
    if (Endpoint.Id === Endpoints.CurrentLimits.Id) return BuildCurrentLimits();
    if (Endpoint.Id === Endpoints.PlaceBet.Id) return BuildPlaceBet(Input);
    return BuildIdaStub(Input, Context, Endpoint.Id, `NBA2K19 Gambling ${Endpoint.Route}`);
}

module.exports = {
    BuildCurrentLimits,
    BuildPlaceBet,
    PlaceBetRequest,
    PlaceBetResponse,
    RollValues,
    Build,
    Gambling: Build,
    Endpoints,
    EndpointIds,
    AllEndpointIds,
    ByRoute,
    ById,
    Resolve,
    ExactEndpointIds: EndpointIds,
    UnobservedEndpointIds: Object.freeze([Endpoints.ScheduledPrizeWheelStatus.Id, Endpoints.UserStatus.Id]),
    Feature: 'TK_WORLD::INFORMATION::RequestCourtPrices / PlaceBet / PRIZE_WHEEL',
    Status: 'IDA_EXACT_2K19_IDS_RESPONSE_SCHEMA_PROVISIONAL',
};
