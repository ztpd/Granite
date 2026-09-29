// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const { Parse, GetU32, GetU64, Types, Crc32 } = require('../Source/Codec/FieldList');
const Pno = require('../Source/Services/GameStats/PlayNowOnline');

Test('PNO callback wire shapes include all ten repeated rows and typed status', () => {
    for (const Route of ['gamestatsv4/pnoleaguesummary', 'gamestatsv4/pnouserleaguesummary']) {
        const Reply = Pno.Build(null, { Route });
        const { Fields } = Parse(Reply.Body);
        Assert.equal(GetU32(Fields, Crc32('RESULT')), 0x504521a8);
        for (const Crc of [606117073, 753316640, 4164838379]) {
            const Rows = Fields.filter((F) => F.Crc === Crc);
            Assert.equal(Rows.length, 10, 'callback unconditionally reads ten entries');
            Assert.ok(Rows.every((F) => F.Type === (Crc === 4164838379 ? Types.String8 : Types.U64)));
        }
        Assert.equal(3817997973, Crc32('RESULT'));
        if (Route.includes('pnouser')) {
            for (const Crc of [681167798, 975910173, 983721846, 2305092240, 2942156214, 911535116, 1096015002]) {
                Assert.equal(Fields.filter((F) => F.Crc === Crc && F.Type === Types.U64).length, 10);
            }
            for (const Crc of [
                3296163383, 144384974, 2740002200, 482368519, 2244545981, 4073602347, 3904584439, 4158425920,
                1621328828, 475677580, 4188721670, 2085707822,
            ]) {
                Assert.equal(Fields.filter((F) => F.Crc === Crc && F.Type === Types.U64).length, 1);
            }
        }
    }
});

Test('PNO empty history and leaderboard explicitly stop consumer loops', () => {
    for (const Route of [
        'gamestatsv4/pnouserleaderboard',
        'gamestatsv4/pnouserlastngamestats_v2',
        'onlineseasongamestatsv3/pnouserlastngamestats',
    ]) {
        const { Fields } = Parse(Pno.Build(null, { Route }).Body);
        Assert.equal(Fields.length, 2);
        Assert.equal(GetU64(Fields, 444609185), 0n);
        Assert.equal(GetU32(Fields, Crc32('RESULT')), 0x504521a8);
    }
    Assert.equal(Pno.Resolve('mmg/quick/create'), undefined);
});

Test('every Play Now menu reply carries exactly one RESULT, and it is SUCCESS', () => {
    for (const Route of [
        'gamestatsv4/pnoleaguesummary',
        'gamestatsv4/pnouserleaguesummary',
        'gamestatsv4/pnouserleaderboard',
        'gamestatsv4/pnouserlastngamestats_v2',
        'onlineseasongamestatsv3/pnouserlastngamestats',
    ]) {
        const { Fields } = Parse(Pno.Build(null, { Route }).Body);
        const Results = Fields.filter((F) => F.Crc === Crc32('RESULT'));
        Assert.equal(Results.length, 1, `${Route} has ${Results.length} RESULT records`);
        Assert.equal(Results[0].Type, Types.StringCrc);
        Assert.equal(Results[0].value, 0x504521a8);
    }
});
