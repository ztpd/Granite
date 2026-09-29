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
const { Builder, Types, Parse, GetField, GetFields, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const ItemCache = require('../Source/Services/MyTeam/Collection/ItemCache');
const { CreateGraniteServer } = require('../Source/Server');

const { Crcs, EndpointIds, JsonKeys } = ItemCache;
const Success = 0x504521a8;

const CapturedRequest = Buffer.alloc(16);

function InflateMode2(BlobData) {
    if (!BlobData || BlobData.length < 4) return null;
    const NumberValue = BlobData.readUInt32LE(0);
    const Header = ((NumberValue >>> 8) & 0xff) + ((NumberValue & 0xff) << 8);
    if (Header % 31 !== 0 || (NumberValue & 0x2000) !== 0 || (NumberValue & 0xf) !== 8) return null;
    try {
        return Zlib.inflateSync(BlobData);
    } catch {
        return null;
    }
}

function ReadCString(Bytes) {
    const End = Bytes.indexOf(0);
    return { Terminated: End >= 0, Text: Bytes.subarray(0, End >= 0 ? End : Bytes.length).toString('utf8') };
}

function RootMembers(Document) {
    if (Document === null || typeof Document !== 'object') return [];
    return Object.entries(Document).map(([Key, Value]) => ({ key: Crc32(Key), value: Value }));
}

function ReceiveCallback(Cache, Reply) {
    const { Fields } = Parse(Reply);
    if (GetU32(Fields, Crcs.Result) !== Success) return { Branch: 'error-dialog', Line: 152 };
    const BlobData = GetField(Fields, Crcs.Json, 0, Types.Binary);
    const Inflated = InflateMode2(BlobData && BlobData.value);
    if (!Inflated) return { Branch: 'error-dialog', Line: 356 };
    const { Terminated, Text } = ReadCString(Inflated);
    let Document;
    try {
        Document = JSON.parse(Text);
    } catch {
        return { Branch: 'json-parse-failed' };
    }
    if (!Cache.DefaultDocument) {
        Cache.DefaultDocument = Document;
        return { Branch: 'request-user-collection-short', Terminated };
    }
    const Defaults = RootMembers(Cache.DefaultDocument);
    if (Defaults.length === 0) return { Branch: 'assert', Line: 351 };
    let Selected = Defaults[0];
    if (Selected.key === JsonKeys.SkippedRootMember) {
        if (Defaults.length < 2 || Defaults[1].key === JsonKeys.SkippedRootMember)
            return { Branch: 'assert', Line: 344 };
        Selected = Defaults[1];
    }
    const Catalog = Array.isArray(Selected.value) ? Selected.value.length : Object.keys(Selected.value || {}).length;
    const UserMembers = RootMembers(Document).length;
    return { Branch: 'loaded', Catalog, UserMembers, Terminated };
}

Test('the bare SUCCESS Granite used to send is the 0x5251BC93 BAD_JSON_BLOB dialog', () => {
    const Bare = new Builder().AddU32(Crcs.Result, Success).Build().Body;
    Assert.deepEqual(ReceiveCallback({ DefaultDocument: null }, Bare), { Branch: 'error-dialog', Line: 356 });
});

Test('default then user collection replies load the cache without an assert or dialog', () => {
    const Cache = { DefaultDocument: null };
    const First = ReceiveCallback(Cache, ItemCache.GetDefaultCollection().Body);
    Assert.deepEqual(First, { Branch: 'request-user-collection-short', Terminated: true });
    const Second = ReceiveCallback(Cache, ItemCache.UserCollectionShort().Body);
    Assert.deepEqual(Second, { Branch: 'loaded', Catalog: 0, UserMembers: 0, Terminated: true });
});

Test('reply wire shape: one RESULT, one zlib JSON blob, NUL-terminated text, no card fabricated', () => {
    for (const Reply of [ItemCache.GetDefaultCollection(), ItemCache.UserCollectionShort()]) {
        const { Fields } = Parse(Reply.Body);
        Assert.equal(Fields.length, 2);
        Assert.equal(GetFields(Fields, Crcs.Result).length, 1);
        Assert.equal(GetU32(Fields, Crcs.Result), Success);
        const Blobs = GetFields(Fields, 0x5d92c8f1, Types.Binary);
        Assert.equal(Blobs.length, 1, 'read with GetBinary(crc32("JSON"))');
        const Inflated = InflateMode2(Blobs[0].value);
        Assert.ok(Inflated, 'passes the sub_141904330 zlib header check');
        Assert.equal(Inflated.at(-1), 0);
    }
    const Defaults = RootMembers(
        JSON.parse(
            ReadCString(InflateMode2(GetField(Parse(ItemCache.GetDefaultCollection().Body).Fields, Crcs.Json).value))
                .Text,
        ),
    );
    Assert.equal(Defaults.length, 1);
    Assert.notEqual(Defaults[0].key, JsonKeys.SkippedRootMember);
    Assert.notEqual(Defaults[0].key, JsonKeys.DefaultCollectionExtra);
    Assert.deepEqual(Defaults[0].value, []);
});

Test('HTTPS serves both captured MyTeam2k19 collection URLs through the item cache', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-myteam-collection-'));
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
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    });
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Post = (Url) =>
        new Promise((Resolve, Reject) => {
            const Req = Https.request(
                {
                    host: '127.0.0.1',
                    port: Port,
                    path: Url,
                    method: 'POST',
                    rejectUnauthorized: false,
                    headers: {
                        'Content-Length': String(CapturedRequest.length),
                        VCFIELDLIST_SIZE: String(CapturedRequest.length),
                    },
                },
                (Incoming) => {
                    const Chunks = [];
                    Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                    Incoming.on('end', () => Resolve(Buffer.concat(Chunks)));
                },
            );
            Req.on('error', Reject);
            Req.end(CapturedRequest);
        });
    const Cache = { DefaultDocument: null };
    const First = await Post('/nba/2k19/MyTeam2k19/get_default_collection?x=5943811978969940877');
    Assert.equal(ReceiveCallback(Cache, First).Branch, 'request-user-collection-short');
    const Second = await Post('/nba/2k19/MyTeam2k19/user_collection_short?x=5943811978969940877');
    Assert.equal(ReceiveCallback(Cache, Second).Branch, 'loaded');
    Assert.equal(EndpointIds.GetDefaultCollection, 0x5251bc93);
});
