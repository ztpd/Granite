// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Https = require('node:https');
const Os = require('node:os');
const Path = require('node:path');
const Zlib = require('node:zlib');
const { Builder, Types, Parse, GetField, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const Login = require('../Source/Services/Session/Login');
const GetActive = require('../Source/Services/MyTeam/Lineup/GetActive');
const JsonBlob = require('../Source/Services/MyTeam/JsonBlob');
const { SessionStore } = require('../Source/Storage/SessionStore');
const { CreateGraniteServer } = require('../Source/Server');

const Success = 0x504521a8;
const EndpointFile = Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json');

const CardGameServices = Object.freeze({
    GET_USER: 0xa40c9996,
    GET_SUBCOLLECTION_LIST: 0x1200f67c,
    GET_DEFAULT_COLLECTION: 0x5251bc93,
    USER_COLLECTION_SHORT: 0xa75cfbee,
    HEAT_CHECK: 0x3864dda5,
    GET_THEMES: 0x5b6b9afa,
    GET_ACTIVE_LINEUP: 0xdb18fc2c,
});

function InflateIntoZeroFilledBuffer(BlobData) {
    try {
        return Buffer.concat([Zlib.inflateSync(BlobData), Buffer.alloc(1)]);
    } catch {
        return null;
    }
}

function ReadCString(Bytes) {
    const End = Bytes.indexOf(0);
    return Bytes.subarray(0, End).toString('utf8');
}

function FromJson(Document) {
    const Members = Object.entries(Document).map(([KeyValue, Value]) => ({
        key: KeyValue.length ? Crc32(KeyValue) : 0,
        value: Value,
    }));
    if (Members.length === 0) return { Outcome: 'null-dereference' };
    let Key = Members[0].key;
    if (Key === JsonBlob.SkippedRootMember && Members.length > 1) Key = Members[1].key;
    const List = Key === 0 ? Document : Members.find((Member) => Member.key === Key).value;
    const Entries = Array.isArray(List) ? List.length : Object.keys(List).length;
    return { Outcome: 'loaded', entries: Entries };
}

function LineupReceiveCallback(Reply) {
    const { Fields } = Parse(Reply);
    if (GetU32(Fields, JsonBlob.Crcs.Result) !== Success) return { flag: 0, Outcome: 'error-dialog-496' };
    const BlobData = GetField(Fields, JsonBlob.Crcs.Json, 0, Types.Binary);
    const Text = BlobData && InflateIntoZeroFilledBuffer(BlobData.value);
    if (!Text) return { flag: 0, Outcome: 'error-dialog-527' };
    const Parsed = FromJson(JSON.parse(ReadCString(Text)));
    if (Parsed.Outcome !== 'loaded') return { flag: 0, Outcome: Parsed.Outcome };
    return { flag: 1, Outcome: 'loaded', entries: Parsed.entries };
}

function MyTeamStateTwo({ LineupLoaded, CollectionLoading, Busy }) {
    return LineupLoaded && !CollectionLoading && Busy === 0 ? 3 : 2;
}

Test('every MyTeam2k19 service id is crc32("CARD_GAME:<NAME>") and the login table now carries all of them', () => {
    const Table = JSON.parse(Fs.readFileSync(EndpointFile, 'utf8'));
    for (const [Name, Id] of Object.entries(CardGameServices)) {
        Assert.equal(Crc32(`CARD_GAME:${Name}`), Id, Name);
        const Row = Table.Endpoints.find((Endpoint) => Number(Endpoint.EndpointId) >>> 0 === Id);
        Assert.ok(Row, `${Name} has no Session/login SERVICES row`);
        Assert.ok(Row.Url.endsWith(`/nba/2k19/MyTeam2k19/${Name.toLowerCase()}`), `${Name} -> ${Row.Url}`);
        Assert.equal(Row.Records.length, 14);
    }
});

Test('Session/login serializes the GET_ACTIVE_LINEUP row into the services blob', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-active-lineup-login-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Req = new Builder()
        .AddU64(Login.Crcs.UserId, 0x0110000100000666n)
        .AddU32(Login.Crcs.Environment, 0x8321fc23)
        .AddU32(Login.Crcs.SkuId, Login.Exact2K19.SkuSelector)
        .Build();
    const Reply = Login.Build(
        { Body: Req.Body, Parsed: Parse(Req.Body) },
        { Sessions: new SessionStore(Root), EndpointFile: EndpointFile },
    );
    const Services = Parse(Zlib.gunzipSync(GetField(Parse(Reply.Body).Fields, Login.Crcs.Services).value)).Fields;
    const Index = Services.findIndex((Field) => Field.Crc === 0xc493acfe && Field.Data1 === 0xdb18fc2c);
    Assert.ok(Index >= 0, 'endpoint id record 0xDB18FC2C');
    const Url = Services.slice(Index, Index + 14).find((Field) => Field.Crc === 0x12bbf3ab);
    Assert.equal(Url.value, 'https://nba2k19-svc.2ksports.com:21140/nba/2k19/MyTeam2k19/get_active_lineup');
});

Test('the empty active lineup sets the loaded flag and releases MyTeam from state 2', () => {
    const Result = LineupReceiveCallback(GetActive.Build().Body);
    Assert.deepEqual(Result, { flag: 1, Outcome: 'loaded', entries: 0 });
    Assert.equal(MyTeamStateTwo({ LineupLoaded: false, CollectionLoading: false, Busy: 0 }), 2);
    Assert.equal(MyTeamStateTwo({ LineupLoaded: Result.flag === 1, CollectionLoading: false, Busy: 0 }), 3);
});

Test('lineup document shape: a list member is required, a bare SUCCESS or empty root is fatal', () => {
    Assert.deepEqual(FromJson({}), { Outcome: 'null-dereference' });
    Assert.equal(
        LineupReceiveCallback(new Builder().AddU32(JsonBlob.Crcs.Result, Success).Build().Body).Outcome,
        'error-dialog-527',
    );
    const Document = JSON.parse(
        ReadCString(
            InflateIntoZeroFilledBuffer(GetField(Parse(GetActive.Build().Body).Fields, JsonBlob.Crcs.Json).value),
        ),
    );
    const Keys = Object.keys(Document);
    Assert.equal(Keys.length, 1);
    Assert.notEqual(Crc32(Keys[0]), JsonBlob.SkippedRootMember);
    Assert.deepEqual(Document[Keys[0]], []);
});

Test('HTTPS serves /MyTeam2k19/get_active_lineup through the lineup handler', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-active-lineup-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Instance = CreateGraniteServer({
        Host: '127.0.0.1',
        Port: 0,
        PublicHost: '127.0.0.1',
        WorldPort: 20054,
        RelayPort: 28091,
        RelaySessionPort: 0x2628,
        CertificateDirectory: Path.join(Root, 'certificate'),
        CaptureDirectory: Path.join(Root, 'captures'),
        UserContentDirectory: Path.join(Root, 'content'),
        SessionDirectory: Path.join(Root, 'sessions'),
        CdnDirectory: Path.join(Root, 'cdn'),
        EndpointTable: EndpointFile,
        MaximumBodyBytes: 1024 * 1024,
    });
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Body = Buffer.alloc(16);
    const Reply = await new Promise((Resolve, Reject) => {
        const Req = Https.request(
            {
                host: '127.0.0.1',
                port: Instance.Server.address().port,
                method: 'POST',
                rejectUnauthorized: false,
                path: '/nba/2k19/MyTeam2k19/get_active_lineup?x=8502060695108355856',
                headers: { 'Content-Length': String(Body.length), VCFIELDLIST_SIZE: String(Body.length) },
            },
            (Incoming) => {
                const Chunks = [];
                Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                Incoming.on('end', () => Resolve(Buffer.concat(Chunks)));
            },
        );
        Req.on('error', Reject);
        Req.end(Body);
    });
    Assert.equal(LineupReceiveCallback(Reply).Outcome, 'loaded');
});
