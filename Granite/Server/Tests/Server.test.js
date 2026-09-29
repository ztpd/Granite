// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Https = require('node:https');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64, Crc32 } = require('../Source/Codec/FieldList');
const { CreateGraniteServer } = require('../Source/Server');

Test('HTTPS capture server logs an empty request and replies with VcFieldList headers', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-server-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
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
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
    };
    const Instance = CreateGraniteServer(Config);
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Res = await new Promise((Resolve, Reject) => {
        const Req = Https.request(
            {
                host: '127.0.0.1',
                port: Port,
                path: '/nba/2k19/Unknown/ping',
                method: 'POST',
                rejectUnauthorized: false,
            },
            (Incoming) => {
                const Chunks = [];
                Incoming.on('data', (Chunk) => Chunks.push(Chunk));
                Incoming.on('end', () => Resolve({ headers: Incoming.headers, Body: Buffer.concat(Chunks) }));
            },
        );
        Req.on('error', Reject);
        Req.end();
    });
    Assert.equal(Number(Res.headers.vcfieldlist_size), Res.Body.length);
    Assert.equal(GetU32(Parse(Res.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const Captured = Fs.readdirSync(Config.CaptureDirectory);
    Assert.equal(
        Captured.filter((Name) => Name.endsWith('.bin')).length,
        2,
        'request and response bodies are both captured',
    );
    Assert.equal(
        Captured.filter((Name) => Name.endsWith('.json')).length,
        2,
        'request and response field lists both have decoded sidecars',
    );
    const ResponseSidecar = Captured.find((Name) => Name.endsWith('.response.json'));
    const DecodedResponse = JSON.parse(Fs.readFileSync(Path.join(Config.CaptureDirectory, ResponseSidecar), 'utf8'));
    Assert.equal(DecodedResponse.Parse.Status, 'ok');
});

Test('HTTPS dispatcher serves the NBA 2K19 MyCareer attribute routes', async (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-attributes-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
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
        EndpointTable: Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json'),
        MaximumBodyBytes: 1024 * 1024,
        VirtualCurrencyStatic: false,
    };
    const Instance = CreateGraniteServer(Config);
    await new Promise((Resolve) => Instance.Server.listen(0, '127.0.0.1', Resolve));
    T.after(() => new Promise((Resolve) => Instance.Server.close(Resolve)));
    const Port = Instance.Server.address().port;
    const Req = (PathName, Body) =>
        new Promise((Resolve, Reject) => {
            const ReqValue = Https.request(
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
                    Incoming.on('end', () => Resolve({ headers: Incoming.headers, Body: Buffer.concat(Chunks) }));
                },
            );
            ReqValue.on('error', Reject);
            ReqValue.end(Body);
        });

    const Empty = new Builder().Build().Body;
    for (const Endpoint of ['PnoLeagueSummary', 'PnoUserLeagueSummary', 'PnoUserLeaderboard']) {
        const PnoResponse = await Req(`/nba/2k19/GameStatsV4/${Endpoint}`, Empty);
        const PnoFields = Parse(PnoResponse.Body).Fields;
        Assert.equal(GetU32(PnoFields, Crc32('RESULT')), Crc32('SUCCESS'));
        if (Endpoint === 'PnoUserLeaderboard') {
            Assert.equal(PnoFields.filter((F) => F.Crc === 444609185).length, 1);
        } else {
            Assert.equal(
                PnoFields.filter((F) => F.Crc === 4164838379).length,
                10,
                'real PNO URLs must reach the 2K19 callback handler',
            );
        }
    }
    const GetResponse = await Req('/nba/2k19/MyCareer/Attributes/get?x=attribute-route-test', Empty);
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const GetParsed = Parse(GetResponse.Body, { FieldListSize: Number(GetResponse.headers.vcfieldlist_size) });
    Assert.deepEqual(
        GetParsed.Fields.filter((Field) => Field.Crc === Constants.Name).map((Field) => Field.Data1 >>> 0),
        Constants.AttributeIds,
    );

    const PriceRequest = new Builder();
    for (const Id of Constants.AttributeIds) PriceRequest.AddU32(Constants.Name, Id);
    for (const Id of Constants.AttributeIds) PriceRequest.AddU64(Constants.Level, 0n);
    const PriceBody = PriceRequest.Build().Body;
    const PriceResponse = await Req('/nba/2k19/MyCareer/Attributes/price?x=attribute-route-test', PriceBody);
    const PriceParsed = Parse(PriceResponse.Body, { FieldListSize: Number(PriceResponse.headers.vcfieldlist_size) });
    Assert.equal(PriceParsed.Fields.filter((Field) => Field.Crc === Constants.PriceCount).length, 16);
    Assert.equal(
        PriceParsed.Fields.filter((Field) => Field.Crc === Constants.ToLevel).length,
        0,
        'an anonymous/unidentified build must not receive a generic purchasable cap row',
    );
    Assert.equal(GetU32(PriceParsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));

    const DynamicPrices = new Builder().AddU32(Crc32('ITEM_0'), 0xb67c1400).Build().Body;
    const PricesResponse = await Req('/nba/2k19/VirtualCurrency/get_prices?x=attribute-route-test', DynamicPrices);
    const PricesParsed = Parse(PricesResponse.Body, { FieldListSize: Number(PricesResponse.headers.vcfieldlist_size) });
    Assert.ok(GetU64(PricesParsed.Fields, Crc32('PRICE_0')) > 0n);

    const LayoutBody = new Builder().AddU64(0xd5e5f21d, 0n).AddU64(0xf821a709, 98n).Build().Body;
    for (const Route of ['StoreV4/v4/get_layout', 'v4/get_layout', 'Store/get_layout']) {
        const LayoutResponse = await Req(`/nba/2k19/${Route}?x=attribute-route-test`, LayoutBody);
        const LayoutParsed = Parse(LayoutResponse.Body, {
            FieldListSize: Number(LayoutResponse.headers.vcfieldlist_size),
        });
        Assert.ok(GetU64(LayoutParsed.Fields, 0x6cb1bd26) > 0n);
        const BlobData = LayoutParsed.Fields.find((Field) => Field.Crc === 0xe1e79306);
        const Raw = require('node:zlib').inflateSync(BlobData.Raw);
        const Document = JSON.parse(Raw.subarray(0, -1).toString('utf8'));
        Assert.ok(Document.FOOTLOCKER.length && Document.SWAGS.length && Document.NBASTORE.length);
    }

    for (const Route of ['StoreV4/v4/get_items', 'v4/get_items', 'Store/get_items']) {
        const ItemResponse = await Req(`/nba/2k19/${Route}?x=attribute-route-test`, LayoutBody);
        const Fields = Parse(ItemResponse.Body, {
            FieldListSize: Number(ItemResponse.headers.vcfieldlist_size),
        }).Fields;
        Assert.equal(Fields.find((Field) => Field.Crc === 0x31de3808)?.Type, 0x55c05a86);
        const BlobData = Fields.find((Field) => Field.Crc === 0x9cc95621);
        Assert.ok(BlobData, `${Route} must reach the price handler, not a success-only stub`);
        const Updates = Parse(require('node:zlib').inflateSync(BlobData.Raw)).Fields;
        Assert.equal(GetU32(Updates, 0xfd76cfbd), 0xb67c1400);
        Assert.equal(GetU64(Updates, 0x417fe697), 100n);
    }

    const BalanceResponse = await Req('/nba/2k19/VirtualCurrency/balance?x=attribute-route-test', Empty);
    const BalanceParsed = Parse(BalanceResponse.Body, {
        FieldListSize: Number(BalanceResponse.headers.vcfieldlist_size),
    });
    Assert.equal(GetU64(BalanceParsed.Fields, 0x93b1e1e4), 100000n);

    const PurchaseBody = new Builder().AddU32(0xfd76cfbd, 0xb67c1400).Build().Body;
    await Req('/nba/2k19/VirtualCurrency/purchase?x=attribute-route-test', PurchaseBody);
    const AfterPurchase = await Req('/nba/2k19/VirtualCurrency/balance?x=attribute-route-test', Empty);
    const AfterPurchaseParsed = Parse(AfterPurchase.Body, {
        FieldListSize: Number(AfterPurchase.headers.vcfieldlist_size),
    });
    Assert.equal(GetU64(AfterPurchaseParsed.Fields, 0x93b1e1e4), 99900n);

    const Tx = require('../Source/Services/VirtualCurrency/GetPrices').TransactionFields;
    const SpendBody = new Builder()
        .AddU32(Tx.Item, 0xb67c1400)
        .AddU64(Tx.Quantity, 2n)
        .AddU64(Tx.CareerKey, 0x1234n)
        .Build().Body;
    const SpendResponse = await Req(
        '/nba/2k19/VirtualCurrency/spend_consumable_purchase?x=attribute-route-test',
        SpendBody,
    );
    const SpendParsed = Parse(SpendResponse.Body, { FieldListSize: Number(SpendResponse.headers.vcfieldlist_size) });
    Assert.equal(GetU32(SpendParsed.Fields, Tx.Item), 0xb67c1400);
    Assert.equal(GetU64(SpendParsed.Fields, Tx.Quantity), 2n);
    Assert.equal(
        GetU64(SpendParsed.Fields, 0x93b1e1e4),
        99700n,
        'dispatcher reaches the quantity-aware spend-consumable handler',
    );

    const ProAmResponse = await Req('/nba/2k19/GameStatsV4/get_user_leaderboard?x=attribute-route-test', Empty);
    const ProAmParsed = Parse(ProAmResponse.Body, { FieldListSize: Number(ProAmResponse.headers.vcfieldlist_size) });
    Assert.equal(GetU32(ProAmParsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(ProAmParsed.Fields, 0x1a8032a1), 0n);

    const RttResponse = await Req('/nba/2k19/ProAmGameStatsV3/v2/RttTeamLeaderboard?x=attribute-route-test', Empty);
    const RttParsed = Parse(RttResponse.Body, { FieldListSize: Number(RttResponse.headers.vcfieldlist_size) });
    Assert.equal(GetU32(RttParsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
});
