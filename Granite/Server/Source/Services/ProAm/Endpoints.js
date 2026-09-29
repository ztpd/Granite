// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Logger = require('../../Core/Logger');
const Crypto = require('node:crypto');
const { Crc32 } = require('../../Core/Crc32');
const { Builder, Types, GetU64, GetString8 } = require('../../Codec/FieldList');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

const Fields = Object.freeze({
    LeaderboardCount: 0x1a8032a1,
    LeaderboardRequestKind: 0xca97b669,
    FeaturedRequest: 0x59542039,

    UserLeaderboard: Object.freeze([
        0x270d2bda, 0xbf486fbc, 0x7389a59f, 0x85a5b830, 0x319d18ad, 0x3006dc10, 0x796dd6ae, 0x958a9ac9, 0xa0666b6f,
    ]),
    UserLeaderboardText: 0xa1a10324,

    TeamLeaderboard: Object.freeze([0x270d2bda, 0x958a9ac9, 0xbf486fbc]),
    TeamLeaderboardData: 0x1dfa2206,
    TeamName: 0x0ac1bb96,
    TeamId: 0x2e646054,
    Version: 0x80592dd9,
    TeamLeaderboardText: 0xa1a10324,

    FeaturedTitle: 0x5e099350,
    FeaturedSubtitle: 0x2d64ce62,
    FeaturedDescription: 0xe27c9ae8,
    FeaturedKind: 0x238c32f7,
    FeaturedValue1: 0x69231164,
    FeaturedValue2: 0xe346d888,
    FeaturedCount: 0x716e532d,
    FeaturedPlayerId: 0xc5fbb3a5,
    FeaturedPlayerText: 0x18bc039b,
    FeaturedPlayerData: 0x1b5cb8dd,

    CapturedTeamId: 0x25ce9668,
    CapturedTeamCity: 0x386e7285,
    CapturedTeamLogo: 0xa0c45fea,
});

function Endpoint(Id, Route, Evidence = 'NOT_OBSERVED_STATIC_2K19', Ida = []) {
    return Object.freeze({ Id: Id >>> 0, Route: Route.toLowerCase(), Evidence: Evidence, Ida: Object.freeze(Ida) });
}

const Exact = 'IDA_EXACT_2K19_STATIC_LOOKUP';

const EndpointList = Object.freeze([
    Endpoint(0x3f798e55, 'proamgamestatsv3/gettryoutinfo', Exact, ['0x14107CC10']),
    Endpoint(0xfd7de951, 'proamgamestatsv3/gettryoutrounds'),
    Endpoint(0xf7b27805, 'proamgamestatsv3/getusereleaguequalificationsummary', Exact, ['0x1410E1F90']),
    Endpoint(0x252d5f89, 'proamgamestatsv3/uploadtryoutreplay'),
    Endpoint(0xe281556d, 'proamgamestatsv3/getusertryoutsummary'),

    Endpoint(0x7094b091, 'proamgamestatsv3/advertisefreeagency', Exact, ['0x141110090']),
    Endpoint(0xf2d5bb53, 'gamestatsv4/cancel_offer'),
    Endpoint(0x5d6fcf67, 'gamestatsv4/create_or_update_team_info', Exact, ['0x141111CB0', '0x1411127D0']),
    Endpoint(0xf2b33e37, 'gamestatsv4/disband_team'),
    Endpoint(0x5065767b, 'gamestatsv4/get_featured_team_user_stats', Exact, ['0x141106460', '0x1412A63A0']),
    Endpoint(0x2bba6a4c, 'gamestatsv4/get_levelup_status', Exact, ['0x141102480']),
    Endpoint(0x1a703366, 'gamestatsv4/get_suggested_team_list'),
    Endpoint(0xb1108bd4, 'proamgamestatsv3/suggesteduserlist'),
    Endpoint(0xbd301c29, 'proamgamestatsv3/getteaminfo'),
    Endpoint(0x511a4523, 'gamestatsv4/invite_user'),
    Endpoint(0xcc5356b7, 'gamestatsv4/join_team'),
    Endpoint(0xf741d665, 'proamgamestatsv3/lastngamestats'),
    Endpoint(0x06c653da, 'gamestatsv4/leave_team'),
    Endpoint(0xf83be359, 'proamgamestatsv3/proam_manager_interested_players'),
    Endpoint(0xead0d15f, 'proamgamestatsv3/proam_manager_kick_player'),
    Endpoint(0xf5796895, 'proamgamestatsv3/proam_manager_recruit'),
    Endpoint(0xad6cb75d, 'proamgamestatsv3/proam_manager_reject_player'),
    Endpoint(0xebe9abb9, 'proamgamestatsv3/proam_manager_sign_player'),
    Endpoint(0x67158b7a, 'proamgamestatsv3/playercardstats'),
    Endpoint(0x0af3f196, 'proamgamestatsv3/proam_player_quit_team'),
    Endpoint(0xabc1c6c1, 'proamgamestatsv3/proam_player_team_list'),
    Endpoint(0xa76e3553, 'proamgamestatsv3/proam_player_tryout'),
    Endpoint(0xc4403a37, 'gamestatsv4/reject_invite'),
    Endpoint(0x22906ce5, 'proamgamestatsv3/removefromfreeagencylist'),
    Endpoint(0x39eabcf8, 'gamestatsv4/remove_team_member'),
    Endpoint(0x80c81255, 'proamgamestatsv3/rttfinal', Exact, ['0x1403997D0']),
    Endpoint(0xa557bfe5, 'proamgamestatsv3/rttgamestats', Exact, ['0x140BC2BF0']),
    Endpoint(0x6870ab05, 'proamgamestatsv3/rttroundinfo', Exact, ['0x1410FEBB0']),
    Endpoint(0x6cce196d, 'proamgamestatsv3/rttroundwinnerlist'),
    Endpoint(0x15759b5f, 'proamgamestatsv3/rttteamlastgamestats'),
    Endpoint(0x7c61449a, 'proamgamestatsv3/rttteamleaderboard', Exact, ['0x140BA06D0']),
    Endpoint(0xe2b3fd58, 'proamgamestatsv3/v2/rttteamleaderboard', Exact, ['0x140BC2D00', '0x1410FE470']),
    Endpoint(0xadc6ffa6, 'proamgamestatsv3/rttteamliststats', Exact, ['0x141100860']),
    Endpoint(0x50628f2a, 'proamgamestatsv3/rttteamstats'),
    Endpoint(0xadd1e31c, 'proamgamestatsv3/rttteamstatus', Exact, ['0x141100C30']),
    Endpoint(0x34784b8f, 'proamgamestatsv3/rttuserliststats'),
    Endpoint(0xa294176a, 'proamgamestatsv3/getsummary'),
    Endpoint(0xfb57b5a9, 'gamestatsv4/get_team_leaderboard', Exact, ['0x1412A6500']),
    Endpoint(0x93941e37, 'gamestatsv4/get_team_list_stats', Exact, ['0x140BA07C0']),
    Endpoint(0xfa68e5a5, 'gamestatsv4/get_team_stats'),
    Endpoint(0x4a31fc81, 'proamgamestatsv3/transferteamowner'),
    Endpoint(0x25998f32, 'proamgamestatsv3/updateteamname'),
    Endpoint(0xb97c9371, 'gamestatsv4/get_user_leaderboard', Exact, ['0x1412A6640']),
    Endpoint(0x0a2aaa1e, 'proamgamestatsv3/userliststats', Exact, ['0x140BA05A0']),
    Endpoint(0xdfac57bd, 'gamestatsv4/get_user_stats', Exact, ['0x140BC04A0']),
    Endpoint(0xbbccfb57, 'proamgamestatsv3/userstatsforteam'),

    Endpoint(0xb05e179b, 'mmg/proam/create'),
    Endpoint(0xa70ccd2b, 'mmg/proam/state'),
    Endpoint(0x7d1313a6, 'mmg/proam/interlockedupdate'),
    Endpoint(0xa6413d56, 'mmg/proam/leave'),
    Endpoint(0x9ae264d8, 'mmg/proam/privatequery'),
    Endpoint(0x194c086d, 'mmg/proam/query'),
    Endpoint(0x5708ea50, 'mmg/proam/remove'),
    Endpoint(0x8b782cc7, 'mmg/proam/search'),
    Endpoint(0xa7adc218, 'mmg/proam/update'),
]);

const ByRoute = new Map(EndpointList.map((Item) => [Item.Route, Item]));
const ById = new Map(EndpointList.map((Item) => [Item.Id, Item]));
const AllEndpointIds = Object.freeze(EndpointList.map((Item) => Item.Id));
const EndpointIds = Object.freeze(EndpointList.filter((Item) => Item.Evidence === Exact).map((Item) => Item.Id));

function NormalizeRoute(RouteOrUrl) {
    let Value = String(RouteOrUrl || '')
        .trim()
        .toLowerCase();
    try {
        Value = new URL(Value, 'https://granite.invalid').pathname.toLowerCase();
    } catch {
        Value = Value.split('?')[0];
    }
    Value = Value.replace(/^\/+|\/+$/g, '');
    const Prefix = 'nba/2k19/';
    const Offset = Value.indexOf(Prefix);
    if (Offset >= 0) Value = Value.slice(Offset + Prefix.length);
    return Value;
}

function Resolve(RouteOrId) {
    if (typeof RouteOrId === 'number' || typeof RouteOrId === 'bigint') {
        return ById.get(Number(RouteOrId) >>> 0) || null;
    }
    return ByRoute.get(NormalizeRoute(RouteOrId)) || null;
}

function AddResult(ListBuilder) {
    return ListBuilder.AddU32(Result, Success);
}

function ReadNumeric(Row, Crc, Index) {
    if (Array.isArray(Row)) return Row[Index] ?? 0n;
    return Row?.[Crc] ?? Row?.[`0x${Crc.toString(16).toUpperCase().padStart(8, '0')}`] ?? 0n;
}

function BuildUserLeaderboard(Rows = []) {
    const List = Array.isArray(Rows) ? Rows : [];
    const ListBuilder = AddResult(new Builder()).AddU64(Fields.LeaderboardCount, BigInt(List.length));
    for (const Row of List) {
        Fields.UserLeaderboard.forEach((Crc, Index) => ListBuilder.AddU64(Crc, ReadNumeric(Row, Crc, Index)));
        ListBuilder.AddString8(
            Fields.UserLeaderboardText,
            Row?.Text ?? Row?.name ?? Row?.[Fields.UserLeaderboardText] ?? '',
        );
    }
    return ListBuilder.Build();
}

function BuildTeamLeaderboard(Rows = []) {
    const List = Array.isArray(Rows) ? Rows : [];
    const ListBuilder = AddResult(new Builder()).AddU64(Fields.LeaderboardCount, BigInt(List.length));
    for (const Row of List) {
        Fields.TeamLeaderboard.forEach((Crc, Index) => ListBuilder.AddU64(Crc, ReadNumeric(Row, Crc, Index)));
        ListBuilder.AddString8(Fields.TeamLeaderboardData, Row?.Data ?? Row?.[Fields.TeamLeaderboardData] ?? '');
        ListBuilder.AddString8(Fields.TeamName, Row?.TeamName ?? Row?.[Fields.TeamName] ?? '');
        ListBuilder.AddString8(
            Fields.TeamLeaderboardText,
            Row?.Text ?? Row?.name ?? Row?.[Fields.TeamLeaderboardText] ?? '',
        );
    }
    return ListBuilder.Build();
}

function BuildFeaturedTeam(Featured = null) {
    const Value = Featured && typeof Featured === 'object' ? Featured : {};
    const Players = Array.isArray(Value.Players) ? Value.Players.slice(0, 5) : [];
    const ListBuilder = AddResult(new Builder())
        .AddString8(Fields.FeaturedTitle, Value.title || '')
        .AddString8(Fields.FeaturedSubtitle, Value.Subtitle || '')
        .AddString8(Fields.FeaturedDescription, Value.description || '')
        .AddU32(Fields.FeaturedKind, Value.Kind || 0)
        .AddU64(Fields.FeaturedValue1, Value.Value1 || 0n)
        .AddU64(Fields.FeaturedValue2, Value.Value2 || 0n)
        .AddU64(Fields.FeaturedCount, BigInt(Players.length));
    for (const Player of Players) {
        ListBuilder.AddU64(Fields.FeaturedPlayerId, Player?.id || 0n)
            .AddString8(Fields.FeaturedPlayerText, Player?.Text || Player?.name || '')
            .AddString8(Fields.FeaturedPlayerData, Player?.Data || '');
    }
    return ListBuilder.Build();
}

function TeamKey(Context = {}) {
    return String(Context.userId ?? Context.SessionKey ?? Context.gamertag ?? 'anonymous');
}

function CapturedTeamRecord(Input) {
    const FieldValues = Input?.Parsed?.Fields || [];
    return {
        TeamName: GetString8(FieldValues, Fields.TeamName) || '',
        TeamId: GetU64(FieldValues, Fields.CapturedTeamId) ?? 0n,
        City: GetString8(FieldValues, Fields.CapturedTeamCity) || '',
        Logo: GetString8(FieldValues, Fields.CapturedTeamLogo) || '',
    };
}

function StableTeamId(Context, TeamName) {
    const Identity = `${TeamKey(Context)}\0${TeamName || 'PROAM'}`;
    const Digest = Crypto.createHash('sha256').update(Identity, 'utf8').digest();
    const Value = Digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return Value || 1n;
}

function BuildTeamUpdate(Input, Context = {}) {
    const Incoming = CapturedTeamRecord(Input);
    const Key = TeamKey(Context);
    const Previous = Context.ProAmTeams instanceof Map ? Context.ProAmTeams.get(Key) : null;
    const Record = {
        TeamName: Incoming.TeamName || Previous?.TeamName || '',
        TeamId: Previous?.TeamId || StableTeamId(Context, Incoming.TeamName),
        City: Incoming.City || Previous?.City || '',
        Logo: Incoming.Logo || Previous?.Logo || '',
        version: BigInt(Previous?.version || 0n) + 1n,
    };
    if (Context.ProAmTeams instanceof Map) Context.ProAmTeams.set(Key, Record);
    Logger.Info(`Pro-Am team update for ${TeamKey(Context)}: ${Record.TeamName || '(unnamed team)'}`);
    return AddResult(new Builder())
        .AddString8(Fields.TeamName, Record.TeamName)
        .AddString8(Fields.CapturedTeamCity, Record.City)
        .AddU64(Fields.TeamId, Record.TeamId)
        .AddU64(Fields.Version, Record.version)
        .Build();
}

function BuildStoredTeam(Context = {}) {
    const Record = Context.ProAmTeams instanceof Map ? Context.ProAmTeams.get(TeamKey(Context)) : null;
    const ListBuilder = AddResult(new Builder());
    if (Record) {
        ListBuilder.AddString8(Fields.TeamName, Record.TeamName || '')
            .AddU64(Fields.TeamId, Record.TeamId || 0n)
            .AddU64(Fields.Version, Record.version || 0n)
            .AddString8(Fields.CapturedTeamCity, Record.City || '')
            .AddString8(Fields.CapturedTeamLogo, Record.Logo || '');
    }
    return ListBuilder.Build();
}

function Build(Input, Context = {}) {
    const EndpointValue = Resolve(Context.Route ?? Context.EndpointId) || ById.get(0xb97c9371);
    Logger.Info(`Pro-Am ${EndpointValue.Route} (0x${EndpointValue.Id.toString(16).toUpperCase().padStart(8, '0')})`);
    switch (EndpointValue.Id) {
        case 0xb97c9371:
            return BuildUserLeaderboard(Context.ProAmUserLeaderboard);
        case 0xfb57b5a9:
            return BuildTeamLeaderboard(Context.ProAmTeamLeaderboard);
        case 0x5065767b:
            return BuildFeaturedTeam(Context.ProAmFeaturedTeam);
        case 0x5d6fcf67:
            return BuildTeamUpdate(Input, Context);
        case 0xbd301c29:
            return BuildStoredTeam(Context);
        default:
            Logger.Verbose(
                `NBA2K19 Pro-Am ${EndpointValue.Route}: endpoint wired; response schema pending a 2K19 capture/callback`,
            );
            return AddResult(new Builder()).Build();
    }
}

module.exports = {
    Build,
    ProAm: Build,
    BuildUserLeaderboard,
    BuildTeamLeaderboard,
    BuildFeaturedTeam,
    BuildTeamUpdate,
    BuildStoredTeam,
    EndpointList,
    EndpointIds,
    ExactEndpointIds: EndpointIds,
    AllEndpointIds,
    ByRoute,
    ById,
    Resolve,
    Fields,
    Types,
    Feature: 'TK_WORLD::ACTIVITY_PROAM_TEAM / PROAM_WALKON_LOBBY / ProAmGameStatsV3 / MMG Pro-Am',
    Status: '2K19_ROUTES_COMPLETE_THREE_RESPONSE_SCHEMAS_EXACT_REMAINDER_CAPTURE_PROVISIONAL',
};
