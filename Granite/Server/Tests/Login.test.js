// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Zlib = require('node:zlib');
const { Builder, Parse, GetField, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { SessionStore } = require('../Source/Storage/SessionStore');
const Login = require('../Source/Services/Session/Login');

Test('login echoes environment, creates a u64 session, and supplies a parseable services table', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-login-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Req = new Builder()
        .AddU64(Login.Crcs.UserId, 0x0110000100000666n)
        .AddU32(Login.Crcs.Environment, 0x8321fc23)
        .AddU32(Login.Crcs.SkuId, Login.Exact2K19.SkuSelector)
        .Build();
    const EndpointFile = Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json');
    const Reply = Login.Build(
        { Body: Req.Body, Parsed: Parse(Req.Body) },
        {
            Sessions: new SessionStore(Root),
            EndpointFile,
        },
    );
    const Decoded = Parse(Reply.Body);
    Assert.equal(GetU32(Decoded.Fields, Login.Crcs.Result), Login.Crcs.Success);
    Assert.equal(GetU32(Decoded.Fields, Login.Crcs.Environment), 0x8321fc23);
    Assert.ok(GetU64(Decoded.Fields, Login.Crcs.SessionKey) > 0n);
    const Services = GetField(Decoded.Fields, Login.Crcs.Services);
    Assert.ok(Services && Buffer.isBuffer(Services.value));
    Assert.equal(Parse(Zlib.gunzipSync(Services.value)).Fields.length, 517 * 14);
    Assert.equal(Login.Exact2K19.SessionRootUrl, 'https://nba2k19-ws.2ksports.com:19217/Session');
    Assert.equal(Login.Exact2K19.OriginalSessionPort, 19217);
    Assert.equal(Login.Exact2K19.GraniteRedirectPort, 21000);
    Assert.equal(Login.Exact2K19.TitleId, 0x801e);
    const Parameters = Parse(Zlib.gunzipSync(GetField(Decoded.Fields, Login.Crcs.Parameters).value));
    const Delay = GetField(Parameters.Fields, Login.Crcs.LockstepDelaySeconds);
    Assert.equal(Math.ceil(Math.fround(Delay.value * 60)), Login.LockstepBufferFrames());

    const Table = JSON.parse(Fs.readFileSync(EndpointFile, 'utf8'));
    Assert.equal(Table.Evidence.ExactUniqueConstantServiceIds, 173);
    Assert.equal(Table.Evidence.ExactIdsResolvedByThisTable, 146);
    for (const Id of ['0x8C8B8BF4', '0xCA7A1109', '0x8290B650']) {
        const Row = Table.Endpoints.find((Endpoint) => Endpoint.EndpointId === Id);
        Assert.equal(Row?.EndpointIdEvidence, 'IDA_EXACT_2K19_STATIC_LOOKUP', `${Id} lacks IDA evidence`);
    }
    const Inventory = Table.Endpoints.find((Endpoint) => Endpoint.Url.endsWith('/Inventory/get_with_tag'));
    Assert.equal(Inventory?.EndpointId, '0xF23E8B39');
    Assert.equal(Inventory?.EndpointIdEvidence, 'IDA_EXACT_2K19_STATIC_LOOKUP');
    const Store = Table.Endpoints.find((Endpoint) => Endpoint.Url.endsWith('/StoreV4/v4/get_items'));
    Assert.equal(Store?.EndpointId, '0x25E937AD');
    Assert.equal(Store?.EndpointIdEvidence, 'IDA_EXACT_2K19_STATIC_LOOKUP');
    const Advertised = Parse(Zlib.gunzipSync(Services.value)).Fields;
    const RowIndex = Advertised.findIndex((Field) => Field.Crc === 0xc493acfe && Field.Data1 === 0x25e937ad);
    Assert.ok(RowIndex >= 0, 'the native item-price lookup must exist in the wire service table');
    Assert.equal(Advertised.slice(RowIndex, RowIndex + 14).find((Field) => Field.Crc === 0x12bbf3ab).value, Store.Url);
});

Test('login supplies the exact NBA2K19 F32 lookahead field for supported buffer profiles', () => {
    const { Types } = require('../Source/Codec/FieldList');
    for (const Frames of [10, 12, 15, 18]) {
        const Parameters = Parse(
            Zlib.gunzipSync(Login.BuildParameterBlob({ GRANITE_LOCKSTEP_BUFFER_FRAMES: String(Frames) })),
        );
        const Delay = GetField(Parameters.Fields, 0xfb1c4cf3);
        Assert.equal(Delay.Type, Types.F32);
        Assert.equal(Delay.value, Math.fround(Frames / 60));
        Assert.equal(Math.ceil(Math.fround(Delay.value * 60)), Frames);
        Assert.equal(Parameters.Fields.filter((F) => F.Crc === 0xfb1c4cf3).length, 1);
    }
    Assert.equal(Login.LockstepBufferFrames({}), 12);
    for (const Value of ['0', '-1', '50', '18.5', 'NaN', 'Infinity'])
        Assert.throws(() => Login.BuildParameterBlob({ GRANITE_LOCKSTEP_BUFFER_FRAMES: Value }), /1\.\.49/);
});
