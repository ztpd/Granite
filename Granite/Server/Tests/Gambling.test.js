// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Codec = require('../Source/Codec/FieldList');
const G = require('../Source/Services/Gambling/Endpoints');
const Policy = require('../../../Shared/AnteUp');
const Crc = Codec.Crc32;
const Decode = (Reply) => Codec.Parse(Reply.Body).Fields;
const Input = (Index, Id = Policy.GamblingId) => ({
    Parsed: {
        Fields: Decode(
            new Codec.Builder().AddU64(0x1d669aa5, Index).AddU64(0xdcff2a93, Id).AddU64(0x29c281bd, 0n).Build(),
        ),
    },
});

Test('current_limits supplies a bounded indexed price table and a shared nonzero id', () => {
    const Fields = Decode(G.Build({}, { Route: 'gambling/current_limits' }));
    Assert.equal(Codec.GetU64(Fields, 0xdcff2a93), Policy.GamblingId);
    Assert.equal(Codec.GetU64(Fields, 0x15a7d7e2), BigInt(Policy.LimitCount));
    Assert.ok(Policy.LimitCount <= 64);
    for (const C of Policy.Courts) Assert.equal(Codec.GetU64(Fields, Crc(`LIMIT_${C.index}`)), BigInt(C.entryVc));
});

Test('place_bet writes exact 2K19 roll CRCs and native U64 fields, without fabricated SUCCESS rolls', () => {
    const Fields = Decode(G.Build(Input(0n), { Route: 'gambling/place_bet' }));
    Assert.equal(Codec.GetU32(Fields, 0xe3920695), 0x504521a8);
    for (const Key of [0x1bea188e, 0x82e34934, 0xf5e479a2]) {
        Assert.equal(Codec.GetU32(Fields, Key), 0x8c612ff4);
        Assert.equal(Codec.GetField(Fields, Key).Type, Codec.Types.StringCrc);
    }
    for (const Key of [3824148403, 1113713710, 4021069828, 3199728789]) {
        Assert.equal(Codec.GetU64(Fields, Key), 0n, 'practice does not invent rewards or debit a wallet');
        Assert.equal(Codec.GetField(Fields, Key).Type, Codec.Types.U64);
    }
    for (const Wrong of [0x1be6ef6e, 0x82e5cd34, 0xf5e8b0e2, 0x42640c2e, 0xefae5dc4, 0xbeb8cfd5])
        Assert.ok(!Codec.GetField(Fields, Wrong));
});

Test('the captured index=255/id=0 request fails explicitly instead of treating 255 as VC', () => {
    for (const Req of [Input(255n, 0n), Input(255n), Input(0n, 0n), Input(64n), Input(0xffffffffffffffffn), {}]) {
        Assert.notEqual(Codec.GetU32(Decode(G.BuildPlaceBet(Req)), Crc('RESULT')), Crc('SUCCESS'));
    }
    const WrongType = Input(0n);
    WrongType.Parsed.Fields.find((F) => F.Crc === 0x1d669aa5).Type = Codec.Types.StringCrc;
    Assert.notEqual(Codec.GetU32(Decode(G.BuildPlaceBet(WrongType)), Crc('RESULT')), Crc('SUCCESS'));
    const Duplicate = Input(0n);
    Duplicate.Parsed.Fields.push({ ...Duplicate.Parsed.Fields[0] });
    Assert.notEqual(Codec.GetU32(Decode(G.BuildPlaceBet(Duplicate)), Crc('RESULT')), Crc('SUCCESS'));
});

Test('every configured court is accepted; retry is neutral/idempotent and does not depend on client balance', () => {
    for (const C of Policy.Courts) {
        const Req = Input(BigInt(C.index));
        Assert.deepEqual(G.BuildPlaceBet(Req).Body, G.BuildPlaceBet(Req).Body);
        Assert.equal(Codec.GetU32(Decode(G.BuildPlaceBet(Req)), Crc('RESULT')), Crc('SUCCESS'));
    }
});
