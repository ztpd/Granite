// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, Crc32 } = require('../../Codec/FieldList');

const LeagueFields = [606117073, 753316640];
const LeagueName = 4164838379;
const UserRowFields = [681167798, 975910173, 983721846, 2305092240, 2942156214, 911535116, 1096015002];
const UserScalars = [
    3296163383, 144384974, 2740002200, 482368519, 2244545981, 4073602347, 3904584439, 4158425920, 1621328828, 475677580,
    4188721670, 2085707822,
];
const Routes = new Map([
    ['gamestatsv4/pnoleaguesummary', 'league'],
    ['gamestatsv4/pnouserleaguesummary', 'user'],
    ['gamestatsv4/pnouserleaderboard', 'leaderboard'],
    ['onlineseasongamestatsv3/pnouserlastngamestats', 'history'],
    ['gamestatsv4/pnouserlastngamestats_v2', 'history'],
]);

function Resolve(Route) {
    return Routes.get(String(Route).toLowerCase());
}

function Build(Input, Context = {}) {
    const Kind = Resolve(Context.Route);
    if (!Kind) throw new Error('Unknown Play Now Online data route');
    const Reply = new Builder().AddU32(Crc32('RESULT'), 0x504521a8);
    if (Kind === 'history' || Kind === 'leaderboard') {
        return Reply.AddU64(444609185, 0n).Build();
    }
    for (let Row = 0; Row < 10; Row++) {
        for (const Crc of LeagueFields) Reply.AddU64(Crc, 0n);
        Reply.AddString8(LeagueName, '');
        if (Kind === 'user') {
            for (const Crc of UserRowFields) Reply.AddU64(Crc, 0n);
        }
    }
    if (Kind === 'user') {
        for (const Crc of UserScalars) Reply.AddU64(Crc, 0n);
    }
    return Reply.Build();
}

module.exports = { Resolve, Build, Status: '2K19_CALLBACK_SHAPE_EMPTY_BOOTSTRAP' };
