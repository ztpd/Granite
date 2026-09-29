// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Https = require('node:https');
const Os = require('node:os');
const Path = require('node:path');
const { Parse, GetU64 } = require('../Source/Codec/FieldList');
const { CreateGraniteServer } = require('../Source/Server');
const Get = require('../Source/Services/MyCareer/Attributes/Get');
const { Overall, LoadCareerOveralls } = require('../Source/Storage/CareerOverall');

const Fixtures = Path.join(__dirname, 'Fixtures', 'CareerOverall');
const GetItems = Fs.readFileSync(Path.join(Fixtures, 'StoreV4GetItemsOvr98.bin'));
const AttributesGet = Fs.readFileSync(Path.join(Fixtures, 'AttributesGet.bin'));

function Unlocks(Reply) {
    return Parse(Reply.Body, { FieldListSize: Reply.FieldListSize })
        .Fields.filter((Field) => Field.Crc === Get.FeatureUnlock)
        .map((Field) => Field.Data1 >>> 0);
}

async function Serve(T, Root) {
    const Config = {
        Host: '127.0.0.1',
        Port: 0,
        PublicHost: '127.0.0.1',
        WorldPort: 20054,
        CertificateDirectory: Path.join(Root, 'certificate'),
        CaptureDirectory: Path.join(Root, 'captures'),
        UserContentDirectory: Path.join(Root, 'content'),
        SessionDirectory: Path.join(Root, 'sessions'),
        CdnDirectory: Path.join(Root, 'cdn'),
        CareerOverall: Path.join(Root, 'career', 'overall.json'),
        CareerAttributes: Path.join(Root, 'career', 'attributes.json'),
        AttributeProfiles: Path.join(Root, 'career', 'attribute-profiles.json'),
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    };
    const Instance = CreateGraniteServer(Config);
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Post = (PathName, Body) =>
        new Promise((Resolve, Reject) => {
            const Req = Https.request(
                {
                    host: '127.0.0.1',
                    port: Port,
                    path: PathName,
                    method: 'POST',
                    rejectUnauthorized: false,
                    headers: { 'Content-Length': String(Body.length), VCFIELDLIST_SIZE: String(Body.length) },
                },
                (Incoming) => {
                    const Chunks = [];
                    Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                    Incoming.on('end', () => {
                        const Bytes = Buffer.concat(Chunks);
                        Resolve({ Body: Bytes, FieldListSize: Number(Incoming.headers.vcfieldlist_size) });
                    });
                },
            );
            Req.on('error', Reject);
            Req.end(Body);
        });
    return { Config, Post };
}

Test('the captured StoreV4/v4/get_items request reports overall 98 in field 0xF821A709', () => {
    Assert.equal(GetU64(Parse(GetItems).Fields, Overall), 98n);
    Assert.equal(GetU64(Parse(AttributesGet).Fields, Overall), null, 'Attributes/get itself carries no overall');
});

Test(
    'Attributes/get returns SHIRT_OFF once the career has reported 91+ overall, and keeps it across restarts',
    async (T) => {
        const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-shirtless-'));
        T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
        const Session = '/nba/2k19/MyCareer/Attributes/get?x=4638905923597195517';
        const Store = '/nba/2k19/StoreV4/v4/get_items?x=4638905923597195517';
        Fs.mkdirSync(Path.join(Root, 'sessions'), { recursive: true });
        Fs.writeFileSync(
            Path.join(Root, 'sessions', '4638905923597195517.json'),
            JSON.stringify({
                key: '4638905923597195517',
                userId: null,
                gamertag: '',
                verified: false,
                platformUserId: null,
                celestialUserId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }),
        );

        const First = await Serve(T, Root);
        Assert.ok(
            !Unlocks(await First.Post(Session, AttributesGet)).includes(Get.ShirtOff),
            'no SHIRT_OFF before the client has reported an overall',
        );

        await First.Post(Store, GetItems);
        Assert.deepEqual([...LoadCareerOveralls(First.Config.CareerOverall).values()], [98]);
        Assert.ok(Unlocks(await First.Post(Session, AttributesGet)).includes(Get.ShirtOff));

        const Restarted = await Serve(T, Root);
        Assert.ok(
            Unlocks(await Restarted.Post(Session, AttributesGet)).includes(Get.ShirtOff),
            'the recorded overall survives a server restart',
        );
    },
);

Test('SHIRT_OFF starts at 91 overall', () => {
    const Context = (OverallValue) => ({
        userId: 76561198843023395n,
        Careers: new Map(),
        CareerOveralls: new Map([['76561198843023395:0', OverallValue]]),
    });
    Assert.ok(!Unlocks(Get.Build({ Parsed: { Fields: [] } }, Context(90))).includes(Get.ShirtOff));
    Assert.ok(Unlocks(Get.Build({ Parsed: { Fields: [] } }, Context(91))).includes(Get.ShirtOff));
    Assert.ok(
        !Unlocks(Get.Build({ Parsed: { Fields: [] } }, { userId: 1n, Careers: new Map() })).includes(Get.ShirtOff),
    );
});
