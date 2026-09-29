// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64, GetString8, Crc32 } = require('../Source/Codec/FieldList');
const { ContentStore } = require('../Source/Storage/ContentStore');
const { SessionStore } = require('../Source/Storage/SessionStore');

const Modules = [
    '../Source/Services/Common/Acknowledge',
    '../Source/Services/Account/GetAccount',
    '../Source/Services/Account/UpdateAccount',
    '../Source/Services/ContentMessage/Message',
    '../Source/Services/Misc/CheckDLCInventory',
    '../Source/Services/Misc/StringsFilter',
    '../Source/Services/MyCareer/Save',
    '../Source/Services/MyCareer/Attributes/Get',
    '../Source/Services/MyCareer/Attributes/Price',
    '../Source/Services/VirtualCurrency/Balance',
    '../Source/Services/VirtualCurrency/GetConsumableInfo',
    '../Source/Services/VirtualCurrency/GetPrices',
    '../Source/Services/VirtualCurrency/Purchase',
    '../Source/Services/World/Connect',
    '../Source/Services/VCEvent/EventProcessor',
    '../Source/Services/VCReport/Batch',
    '../Source/Services/Video/Enumerate',
    '../Source/Services/GameStats/LastGames',
    '../Source/Services/GameStats/LeagueSummary',
    '../Source/Services/GameStats/LeaderBoard',
    '../Source/Services/GameStats/UserLeague',
    '../Source/Services/GameStats/Matchmaking',
    '../Source/Services/Inventory/GetWithTag',
    '../Source/Services/Store/GetItems',
    '../Source/Services/Store/GetLayout',
    '../Source/Services/Store/GetOverview',
    '../Source/Services/Store/GetOwnedItems',
    '../Source/Services/Store/Purchase',
    '../Source/Services/UserContent/Upload',
    '../Source/Services/UserContent/List',
    '../Source/Services/UserContent/Download',
    '../Source/Services/MyTeam/GameSetup/SessionData',
    '../Source/Services/Blacktop/PlayWithFriends',
    '../Source/Services/MyTeam/Collection/Actions',
    '../Source/Services/Career/Upgrades/BadgePrices',
    '../Source/Services/Arbitration/Upload',
    '../Source/Services/MyCareer/Online/Download',
    '../Source/Services/MyCareer/Online/EnumerateVerify',
    '../Source/Services/MyCareer/Online/Upload',
    '../Source/Services/MyCareer/Online/Delete',
    '../Source/Services/ContentMessage/Retrieve',
    '../Source/Services/MyTeam/Lineup/GetActive',
    '../Source/Services/Store/MPStore/Overview',
    '../Source/Services/GameLoader/MyCourt/Banners',
    '../Source/Services/MyCourt/Endpoints',
    '../Source/Services/Gambling/Endpoints',
    '../Source/Services/ProAm/Endpoints',
    '../Source/Services/Ida2K19/Unresolved',
];

Test('every populated endpoint module returns a parseable VcFieldList', (T) => {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-endpoints-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    const Empty = new Builder().Build();
    const Input = { Body: Empty.Body, Parsed: Parse(Empty.Body) };
    const Context = {
        userId: null,
        gamertag: '',
        Sessions: new SessionStore(Path.join(Root, 'sessions')),
        content: new ContentStore(Path.join(Root, 'content')),
        Careers: new Map(),
        Wallets: new Map(),
        PublicHost: '127.0.0.1',
        WorldPort: 20054,
        SessionKey: '',
    };
    for (const Name of Modules) {
        const Endpoint = require(Name);
        Assert.equal(typeof Endpoint.Build, 'function', `${Name} has no Build export`);
        Assert.ok(Endpoint.Status, `${Name} has no evidence status`);
        const Reply = Endpoint.Build(Input, Context);
        Assert.ok(Reply && Buffer.isBuffer(Reply.Body), `${Name} returned no body`);
        const Decoded = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
        const ExpectedResult = Endpoint.ExpectedEmptyResult ?? Crc32('SUCCESS');
        Assert.equal(
            GetU32(Decoded.Fields, Crc32('RESULT')),
            ExpectedResult,
            `${Name} returned an unexpected RESULT for an empty request`,
        );
    }
});

Test('IDA 2K19 registry keeps every exact service ID uniquely addressable', () => {
    const Registry = require('../Source/Services/Ida2K19/Registry');
    const Ids = Registry.Modules.flatMap((Endpoint) => Endpoint.EndpointIds || []);
    Assert.equal(new Set(Ids.map((Id) => Number(Id) >>> 0)).size, Ids.length);
    for (const Id of Ids) Assert.equal(typeof Registry.ByEndpointId.get(Number(Id) >>> 0).Build, 'function');
});

Test('NBA 2K19 attributes get always emits the complete fixed sixteen-entry set', () => {
    const Endpoint = require('../Source/Services/MyCareer/Attributes/Get');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Reply = Endpoint.Build({ Parsed: { Fields: [] } }, { userId: 'player-1', Careers: new Map() });
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    const Names = Parsed.Fields.filter((Field) => Field.Crc === Constants.Name);
    const Levels = Parsed.Fields.filter((Field) => Field.Crc === Constants.Level);
    const Caps = Parsed.Fields.filter((Field) => Field.Crc === Constants.CurrentCap);
    Assert.deepEqual(
        Names.map((Field) => Field.Data1 >>> 0),
        Constants.AttributeIds,
    );
    Assert.equal(Levels.length, 16);
    Assert.equal(Caps.length, 16);
    Assert.equal(GetU64(Parsed.Fields, Constants.CurrentCap), 25n);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.Cap).length, 0);
});

Test('NBA 2K19 persisted archetype profile clamps an existing player before UI pricing', () => {
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Price = require('../Source/Services/MyCareer/Attributes/Price');
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const MaxLevels = [13, 8, 22, 21, 12, 13, 13, 16, 14, 11, 18, 17, 14, 16, 18, 25];
    const Context = {
        userId: 76561197960267366n,
        Careers: new Map(),
        Wallets: new Map(),
        Purchases: new Map(),
        AttributeProfiles: new Map([['76561197960267366', { maxLevels: MaxLevels }]]),
    };
    const GetReply = Get.Build({ Parsed: { Fields: [] } }, Context);
    const GetFields = Parse(GetReply.Body, { FieldListSize: GetReply.FieldListSize }).Fields;
    const CapLevels = GetFields.filter((Field) => Field.Crc === Constants.CurrentCap).map((Field) =>
        GetU64([Field], Constants.CurrentCap),
    );
    Assert.equal(CapLevels[1], 8n);

    const PriceRequest = new Builder();
    for (const Id of Constants.AttributeIds) PriceRequest.AddU32(Constants.Name, Id);
    for (const Id of Constants.AttributeIds) PriceRequest.AddU64(Constants.Level, 0n);
    const PriceReply = Price.Build({ Parsed: Parse(PriceRequest.Build().Body) }, Context);
    const PriceFields = Parse(PriceReply.Body, { FieldListSize: PriceReply.FieldListSize }).Fields;
    const Counts = PriceFields.filter((Field) => Field.Crc === Constants.PriceCount).map((Field) =>
        GetU64([Field], Constants.PriceCount),
    );
    Assert.equal(Counts[1], 8n);

    const Invalid = new Builder()
        .AddU32(Purchase.ItemCrc, Constants.AttributeIds[1])
        .AddU64(Purchase.FromLevel, 8n)
        .AddU64(Purchase.RequestToLevel, 9n)
        .AddU64(Purchase.SubmittedPrice, 25n)
        .Build();
    const Rejected = Parse(Purchase.Build({ Parsed: Parse(Invalid.Body) }, Context).Body);
    Assert.equal(GetU32(Rejected.Fields, Crc32('RESULT')), 0xf4e7a9b4);
});

Test('NBA 2K19 attribute defaults are a fresh build, and profiles override caps per user', () => {
    const Endpoint = require('../Source/Services/MyCareer/Attributes/Get');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Profiles = new Map([
        [
            'player-profile',
            {
                Initials: Constants.AttributeIds.map(() => 60),
                Caps: { Vertical: 77, ThreePoint: 85 },
            },
        ],
    ]);
    const Context = {
        userId: 'player-profile',
        gamertag: 'player-profile',
        Careers: new Map(),
        AttributeProfiles: Profiles,
    };
    const Reply = Endpoint.Build({ Parsed: { Fields: [] } }, Context);
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    const Levels = Parsed.Fields.filter((Field) => Field.Crc === Constants.Level);
    const Caps = Parsed.Fields.filter((Field) => Field.Crc === Constants.CurrentCap);
    Assert.ok(Levels.every((Field) => GetU64([Field], Constants.Level) === 0n));
    Assert.equal(GetU64(Caps.slice(10, 11), Constants.CurrentCap), 17n);
    Assert.equal(GetU64(Caps.slice(3, 4), Constants.CurrentCap), 25n);
});

Test('NBA 2K19 attributes price returns the default matrix with vertical cap', () => {
    const Endpoint = require('../Source/Services/MyCareer/Attributes/Price');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Req = new Builder();
    for (const Id of Constants.AttributeIds) Req.AddU32(Constants.Name, Id);
    for (const Id of Constants.AttributeIds) Req.AddU64(Constants.Level, 0n);
    const Input = { Parsed: Parse(Req.Build().Body) };
    const Reply = Endpoint.Build(Input, {});
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.Name).length, 16);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.PriceCount).length, 16);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.ToLevel).length, 15 * 25 + 17);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.Price).length, 15 * 25 + 17);
    Assert.ok(
        Parsed.Fields.filter((Field) => Field.Crc === Constants.Price).every(
            (Field) => Field.Data1 !== 0 || Field.Data2 !== 0,
        ),
    );
    const HeaderCrcs = Parsed.Fields.slice(0, 16 * 3).map((Field) => Field.Crc);
    Assert.deepEqual(
        HeaderCrcs,
        Constants.AttributeIds.flatMap(() => [Constants.Name, Constants.Level, Constants.PriceCount]),
    );
    Assert.equal(Parsed.Fields[16 * 3].Crc, Constants.ToLevel);
});

Test('NBA 2K19 attribute prices stop at the active build cap', () => {
    const Endpoint = require('../Source/Services/MyCareer/Attributes/Price');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Req = new Builder();
    for (const Id of Constants.AttributeIds) Req.AddU32(Constants.Name, Id);
    for (const Id of Constants.AttributeIds) Req.AddU64(Constants.Level, 0n);
    const MaxLevels = Constants.AttributeIds.map(() => 25);
    MaxLevels[1] = 8;
    const Context = {
        userId: 'price-cap-player',
        Careers: new Map(),
        AttributeProfiles: new Map([['price-cap-player', { maxLevels: MaxLevels }]]),
    };
    const Reply = Endpoint.Build({ Parsed: Parse(Req.Build().Body) }, Context);
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    const Counts = Parsed.Fields.filter((Field) => Field.Crc === Constants.PriceCount).map((Field) =>
        GetU64([Field], Constants.PriceCount),
    );
    Assert.equal(Counts.length, 16);
    Assert.equal(Counts[1], 8n);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Constants.ToLevel).length, 15 * 25 + 8);
});

Test('NBA 2K19 VC prices echo dynamic ITEM_n fields with usable price columns', () => {
    const Endpoint = require('../Source/Services/VirtualCurrency/GetPrices');
    const Req = new Builder();
    Req.AddU32(Crc32('ITEM_0'), 0xb67c1400).AddU32(Crc32('ITEM_1'), 0x6c8ff58f);
    const Reply = Endpoint.Build({ Parsed: Parse(Req.Build().Body) }, { VcPrices: new Map() });
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU32(Parsed.Fields, Crc32('ITEM_0')), 0xb67c1400);
    Assert.equal(GetU32(Parsed.Fields, Crc32('ITEM_1')), 0x6c8ff58f);
    Assert.ok(GetU64(Parsed.Fields, Crc32('PRICE_0')) > 0n);
    Assert.ok(GetU64(Parsed.Fields, Crc32('FINAL_PRICE_1')) > 0n);

    const Tx = Endpoint.TransactionFields;
    Assert.equal(Parsed.Fields.length, 11);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Tx.Item).length, 0);
    Assert.equal(Parsed.Fields.filter((Field) => Field.Crc === Tx.Price).length, 0);
    for (let Index = 0; Index < 2; Index++) {
        for (const Prefix of ['ITEM', 'FINAL_PRICE', 'PRICE', 'FINAL_MYTEAM_PRICE', 'MYTEAM_PRICE']) {
            Assert.ok(
                Parsed.Fields.some((Field) => Field.Crc === Crc32(`${Prefix}_${Index}`)),
                `${Prefix}_${Index} is present`,
            );
        }
    }
    const Crcs = Parsed.Fields.map((Field) => Field.Crc >>> 0);
    Assert.deepEqual(
        Crcs,
        [...Crcs].sort((Left, Right) => Left - Right),
    );
});

Test('NBA 2K19 VC prices replay the full 15-item live store batch at 100 VC', () => {
    const Endpoint = require('../Source/Services/VirtualCurrency/GetPrices');
    const CapturedItems = [
        0x066a8838, 0xef15fdab, 0xa2c20dc4, 0x964fa1d3, 0x3d7eda62, 0x60933b95, 0xd9542293, 0xef9195db, 0xf0953d2a,
        0xa2e1947d, 0x9171446c, 0xb0d807c9, 0x2340036f, 0xe73a8cec, 0xf03defa4,
    ];
    const Req = new Builder();
    CapturedItems.forEach((Item, Index) => Req.AddU32(Crc32(`ITEM_${Index}`), Item));
    Req.AddU64(0xab66f403, 0n).AddU32(0xe9e10b1e, 0x4905ed7b);

    const Reply = Endpoint.Build({ Parsed: Parse(Req.Build().Body) }, { VcPrices: new Map() });
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(Parsed.Fields.length, CapturedItems.length * 5 + 1);
    CapturedItems.forEach((Item, Index) => {
        Assert.equal(GetU32(Parsed.Fields, Crc32(`ITEM_${Index}`)), Item >>> 0);
        for (const Prefix of ['FINAL_PRICE', 'PRICE', 'FINAL_MYTEAM_PRICE', 'MYTEAM_PRICE']) {
            Assert.equal(GetU32(Parsed.Fields, Crc32(`${Prefix}_${Index}`)), 100);
        }
    });
});

Test('NBA 2K19 consumable info echoes the career key in the exact tattoo transaction shape', () => {
    const Endpoint = require('../Source/Services/VirtualCurrency/GetConsumableInfo');
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Req = new Builder().AddU64(Tx.CareerKey, 0x1234n).Build();
    const Reply = Endpoint.Build({ Parsed: Parse(Req.Body) }, { userId: 42n, Wallets: new Map() });
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU32(Parsed.Fields, Tx.Mode), Prices.TransactionModes.Purchasable);
    Assert.equal(GetU64(Parsed.Fields, Tx.CareerKey), 0x1234n);
    Assert.equal(GetU64(Parsed.Fields, Tx.Quantity), 0n);
    Assert.equal(GetU32(Parsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
});

Test('NBA 2K19 tattoo consume echoes the native transaction key and price', () => {
    const Endpoint = require('../Source/Services/VirtualCurrency/GetConsumableInfo');
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Req = new Builder().AddU64(Tx.CareerKey, 0x12345678n).AddU64(Tx.Price, 275n).Build();
    const Reply = Endpoint.Consume({ Parsed: Parse(Req.Body) }, { userId: 42n, Wallets: new Map() });
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU64(Parsed.Fields, Tx.CareerKey), 0x12345678n);
    Assert.equal(GetU64(Parsed.Fields, Tx.Price), 275n);
    Assert.equal(GetU64(Parsed.Fields, Tx.Quantity), 0n);
    Assert.equal(GetU32(Parsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
});

Test('NBA 2K19 spend consumable purchase returns the exact transaction and debits its quantity', () => {
    const Endpoint = require('../Source/Services/VirtualCurrency/Purchase');
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Item = 0xed6c02a0;
    const SelectorA = 0x5120778a;
    const SelectorB = 0x896cc56c;
    const Req = new Builder()
        .AddU32(Tx.Item, Item)
        .AddU64(SelectorA, 7n)
        .AddU64(Tx.Quantity, 2n)
        .AddU64(SelectorB, 9n)
        .AddU64(Tx.CareerKey, 0x1234n)
        .Build();
    const Context = {
        userId: 42n,
        Wallets: new Map([['42', 100000n]]),
        VcPrices: new Map([[Item, { price: 275n }]]),
        Purchases: new Map(),
    };
    const Reply = Endpoint.BuildConsumable({ Parsed: Parse(Req.Body) }, Context);
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU32(Parsed.Fields, Tx.Mode), Prices.TransactionModes.Purchasable);
    Assert.equal(GetU32(Parsed.Fields, Tx.Item), Item);
    Assert.equal(GetU64(Parsed.Fields, Tx.Price), 275n);
    Assert.equal(GetU64(Parsed.Fields, Tx.CareerKey), 0x1234n);
    Assert.equal(GetU64(Parsed.Fields, Tx.Quantity), 2n);
    Assert.equal(GetU64(Parsed.Fields, Endpoint.BalanceCrc), 99450n);
    Assert.equal(GetU64(Parsed.Fields, SelectorA), 7n, 'catalogue selector A is preserved');
    Assert.equal(GetU64(Parsed.Fields, SelectorB), 9n, 'catalogue selector B is preserved');
    Assert.equal(GetU32(Parsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Context.Wallets.get('42'), 99450n);
    Assert.equal(Context.Purchases.size, 1);
    const Crcs = Parsed.Fields.map((Field) => Field.Crc >>> 0);
    Assert.deepEqual(
        Crcs,
        [...Crcs].sort((Left, Right) => Left - Right),
    );
});

Test('NBA 2K19 VC balance debits on purchase, fixed only under static opt-in', () => {
    const Balance = require('../Source/Services/VirtualCurrency/Balance');
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Wallets = new Map();
    const Careers = new Map();
    const Context = { userId: 42n, Wallets, Careers, Purchases: new Map() };
    Assert.equal(Balance.BalanceFor(Context), 100000n);
    const Req = new Builder().AddU32(Purchase.ItemCrc, Constants.AttributeIds[0]).Build();
    const Reply = Purchase.Build({ Parsed: Parse(Req.Body) }, Context);
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU32(Parsed.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Balance.BalanceFor(Context), 99900n, 'purchases debit by default (100 default price)');
    Assert.equal(Careers.get(Constants.CareerKey(Context))[0].level, 1n);

    const StaticContext = {
        userId: 43n,
        Wallets: new Map(),
        Careers: new Map(),
        Purchases: new Map(),
        VirtualCurrencyStatic: true,
    };
    Assert.equal(Balance.BalanceFor(StaticContext), 100000n);
    Purchase.Build({ Parsed: Parse(Req.Body) }, StaticContext);
    Assert.equal(Balance.BalanceFor(StaticContext), 100000n, 'static opt-in keeps the fixed wallet');
});

Test('NBA 2K19 attribute purchase changes only the requested item and enforces its build cap', () => {
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Wallets = new Map([['42', 100000n]]);
    const Careers = new Map();
    const Context = {
        userId: 42n,
        Wallets,
        Careers,
        Purchases: new Map(),
        AttributeProfiles: new Map([
            ['42', { Initials: Constants.AttributeIds.map(() => 60), Caps: { Vertical: 77 } }],
        ]),
    };
    const Vertical = Constants.AttributeIds[10];
    const Body = new Builder()
        .AddU32(Purchase.ItemCrc, Vertical)
        .AddU64(Purchase.FromLevel, 16n)
        .AddU64(Purchase.RequestToLevel, 17n)
        .AddU64(Purchase.SubmittedPrice, 25n)
        .Build();
    const Success = Parse(Purchase.Build({ Parsed: Parse(Body.Body) }, Context).Body);
    Assert.equal(GetU32(Success.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const Attrs = Careers.get(Constants.CareerKey(Context));
    Assert.equal(Attrs[10].level, 17n);
    Assert.ok(Attrs.filter((Item) => Item.id !== Vertical).every((Item) => Item.level === 0n));

    const RejectedBody = new Builder()
        .AddU32(Purchase.ItemCrc, Vertical)
        .AddU64(Purchase.FromLevel, 17n)
        .AddU64(Purchase.RequestToLevel, 18n)
        .AddU64(Purchase.SubmittedPrice, 25n)
        .Build();
    const Rejected = Parse(Purchase.Build({ Parsed: Parse(RejectedBody.Body) }, Context).Body);
    Assert.equal(GetU32(Rejected.Fields, Crc32('RESULT')), 0xf4e7a9b4);
    Assert.equal(Attrs[10].level, 17n);
    Assert.equal(Wallets.get('42'), 99975n, 'the rejected cart debits nothing on top of the earlier buy');
});

Test('NBA 2K19 multi-item carts apply each indexed target atomically', () => {
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Wallets = new Map([['42', 100000n]]);
    const Careers = new Map();
    const Context = { userId: 42n, Wallets, Careers, Purchases: new Map() };
    const MaxLevels = [13, 8, 22, 21, 12, 13, 13, 16, 14, 11, 18, 17, 14, 16, 18, 25];
    Context.AttributeProfiles = new Map([['42', { maxLevels: MaxLevels }]]);
    const Body = new Builder()
        .AddU32(Purchase.ItemCrc, Constants.AttributeIds[2])
        .AddU32(Purchase.ItemCrc, Constants.AttributeIds[3])
        .AddU64(0x97aadcfc, 0n)
        .AddU64(0xb2080f36, 22n)
        .AddU64(0xfee529c4, 625n)
        .AddU64(0x0c0f9093, 0n)
        .AddU64(0x5dca6408, 21n)
        .AddU64(0x58922270, 600n)
        .Build();
    const Reply = Parse(Purchase.Build({ Parsed: Parse(Body.Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Wallets.get('42'), 98775n, '625 + 600 debited');
    const Attrs = Careers.get(Constants.CareerKey(Context));
    Assert.equal(Attrs[2].level, 22n);
    Assert.equal(Attrs[3].level, 21n);
    Assert.ok(
        Attrs.filter((Item) => Item.id !== Constants.AttributeIds[2] && Item.id !== Constants.AttributeIds[3]).every(
            (Item) => Item.level === 0n,
        ),
    );
});

Test('NBA 2K19 save selects the executable cap row for the active archetype pair', () => {
    const Save = require('../Source/Services/MyCareer/Save');
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Profiles = new Map();
    const Context = {
        userId: 5953764367067898694n,
        SessionKey: '5953764367067898694',
        gamertag: 'SteamRIP',
        Careers: new Map(),
        AttributeProfiles: Profiles,
    };
    const Body = new Builder()
        .AddStringCrc(0x801f78b9, 0xb0082ca2)
        .AddStringCrc(0xa18e45f8, 0xb4722a7d)
        .AddStringCrc(0xa517a20c, 0x0baf5602)
        .Build();
    const Reply = Save.Build({ Parsed: Parse(Body.Body) }, Context);
    const Profile = Profiles.get(Constants.CareerKey(Context));
    Assert.ok(Profile);
    Assert.equal(Profile.primaryIndex, 2);
    Assert.equal(Profile.secondaryIndex, 6);
    Assert.equal(Profile.maxLevels[10], 18);
    const Parsed = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize });
    Assert.equal(GetU32(Parsed.Fields, 0x801f78b9), 0xb0082ca2);
    const AttrsReply = Get.Build({ Parsed: { Fields: [] } }, Context);
    const Attrs = Parse(AttrsReply.Body, { FieldListSize: AttrsReply.FieldListSize });
    const Vertical = Attrs.Fields.filter((Field) => Field.Crc === Constants.Level)[10];
    const CapLevels = Attrs.Fields.filter((Field) => Field.Crc === Constants.CurrentCap);
    Assert.equal(GetU64([Vertical], Constants.Level), 0n);
    Assert.deepEqual(
        CapLevels.map((Field) => GetU64([Field], Constants.CurrentCap)),
        [13n, 8n, 22n, 21n, 12n, 13n, 13n, 16n, 14n, 11n, 18n, 17n, 14n, 16n, 18n, 25n],
    );
    Assert.equal(Context.Careers.get(Constants.CareerKey(Context))[10].maxLevel, 18n);
});

Test('NBA 2K19 saves isolate build caps and purchased levels by career-save ID', () => {
    const Save = require('../Source/Services/MyCareer/Save');
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const { PrimaryArchetype, SecondaryArchetype } = require('../Source/Services/MyCareer/Attributes/BuildProfiles');
    const Profiles = new Map();
    const Careers = new Map();
    const Base = {
        userId: 42n,
        gamertag: 'two-build-player',
        Careers,
        AttributeProfiles: Profiles,
        Wallets: new Map(),
        Purchases: new Map(),
    };
    const BuildA = { ...Base, CareerSaveId: 1n };
    const BuildB = { ...Base, CareerSaveId: 2n };
    const SaveA = new Builder()
        .AddStringCrc(PrimaryArchetype, 0x0baf5602)
        .AddStringCrc(SecondaryArchetype, 0xb4722a7d)
        .Build();
    const SaveB = new Builder()
        .AddStringCrc(PrimaryArchetype, 0x3d026016)
        .AddStringCrc(SecondaryArchetype, 0x3d026016)
        .Build();
    Save.Build({ Parsed: Parse(SaveA.Body) }, BuildA);
    Save.Build({ Parsed: Parse(SaveB.Body) }, BuildB);
    Assert.notDeepEqual(
        Profiles.get(Constants.CareerKey(BuildA)).maxLevels,
        Profiles.get(Constants.CareerKey(BuildB)).maxLevels,
    );

    const Req = new Builder()
        .AddU32(Purchase.ItemCrc, Constants.AttributeIds[1])
        .AddU64(Purchase.FromLevel, 0n)
        .AddU64(Purchase.RequestToLevel, 1n)
        .AddU64(Purchase.SubmittedPrice, 25n)
        .Build();
    Purchase.Build({ Parsed: Parse(Req.Body) }, BuildA);
    Assert.equal(Careers.get(Constants.CareerKey(BuildA))[1].level, 1n);
    Assert.equal(Careers.get(Constants.CareerKey(BuildB)), undefined);

    const Reply = Get.Build({ Parsed: { Fields: [] } }, BuildB);
    const Fields = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
    const Caps = Fields.filter((Field) => Field.Crc === Constants.CurrentCap).map((Field) =>
        GetU64([Field], Constants.CurrentCap),
    );
    Assert.equal(Caps[1], 25n);
    Assert.equal(Careers.get(Constants.CareerKey(BuildB))[1].level, 0n);
});

Test('NBA 2K19 zero save IDs are isolated by the generated build fingerprint', () => {
    const Save = require('../Source/Services/MyCareer/Save');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const {
        Position,
        PrimaryArchetype,
        SecondaryArchetype,
    } = require('../Source/Services/MyCareer/Attributes/BuildProfiles');
    const Profiles = new Map();
    const Careers = new Map();
    const Base = { userId: 42n, CareerSaveId: 0n, Careers, AttributeProfiles: Profiles };
    const BuildA = { ...Base };
    const BuildB = { ...Base };
    const RequestA = new Builder()
        .AddStringCrc(Position, 0x86880481)
        .AddStringCrc(PrimaryArchetype, 0xd4fbef91)
        .AddStringCrc(SecondaryArchetype, 0x0baf5602)
        .Build();
    const RequestB = new Builder()
        .AddStringCrc(Position, 0xb0082ca2)
        .AddStringCrc(PrimaryArchetype, 0x3d026016)
        .AddStringCrc(SecondaryArchetype, 0x3d026016)
        .Build();
    Save.Build({ Parsed: Parse(RequestA.Body) }, BuildA);
    Save.Build({ Parsed: Parse(RequestB.Body) }, BuildB);
    const KeyA = Constants.CareerKey(BuildA);
    const KeyB = Constants.CareerKey(BuildB);
    Assert.notEqual(KeyA, KeyB);
    Assert.match(KeyA, /^42:build-/);
    Assert.ok(Profiles.has(KeyA));
    Assert.ok(Profiles.has(KeyB));
    Assert.notDeepEqual(Profiles.get(KeyA).maxLevels, Profiles.get(KeyB).maxLevels);
});

Test('NBA 2K19 resolves all 49 archetype pairs to their own complete cap row', () => {
    const Profiles = require('../Source/Services/MyCareer/Attributes/BuildProfiles');
    for (let Primary = 0; Primary < Profiles.ArchetypeCrcs.length; Primary++) {
        for (let Secondary = 0; Secondary < Profiles.ArchetypeCrcs.length; Secondary++) {
            const Profile = Profiles.ProfileForArchetypes(
                Profiles.ArchetypeCrcs[Primary],
                Profiles.ArchetypeCrcs[Secondary],
                0x86880481,
            );
            Assert.equal(Profile.primaryIndex, Primary);
            Assert.equal(Profile.secondaryIndex, Secondary);
            Assert.deepEqual(Profile.maxLevels, Profiles.MaxLevelTable[Primary][Secondary]);
            Assert.equal(Profile.maxLevels.length, 16);
            Assert.ok(Profile.maxLevels.every((Level) => Number.isInteger(Level) && Level >= 0 && Level <= 25));
            Assert.match(Profiles.BuildScopeForProfile(Profile), /^build-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
        }
    }
});

Test('NBA 2K19 unidentified builds fail closed instead of receiving 25-cap upgrades', () => {
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Price = require('../Source/Services/MyCareer/Attributes/Price');
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Context = {
        userId: 404n,
        Careers: new Map(),
        AttributeProfiles: new Map(),
        Wallets: new Map([['404', 100000n]]),
        Purchases: new Map(),
        RequireKnownAttributeProfile: true,
    };
    const GetReply = Get.Build({ Parsed: { Fields: [] } }, Context);
    const GetFields = Parse(GetReply.Body, { FieldListSize: GetReply.FieldListSize }).Fields;
    Assert.deepEqual(
        GetFields.filter((Field) => Field.Crc === Constants.CurrentCap).map((Field) =>
            GetU64([Field], Constants.CurrentCap),
        ),
        Constants.AttributeIds.map(() => 0n),
    );

    const PriceRequest = new Builder();
    for (const Id of Constants.AttributeIds) PriceRequest.AddU32(Constants.Name, Id);
    for (const Id of Constants.AttributeIds) PriceRequest.AddU64(Constants.Level, 0n);
    const PriceReply = Price.Build({ Parsed: Parse(PriceRequest.Build().Body) }, Context);
    const PriceFields = Parse(PriceReply.Body, { FieldListSize: PriceReply.FieldListSize }).Fields;
    Assert.equal(PriceFields.filter((Field) => Field.Crc === Constants.ToLevel).length, 0);

    const Checkout = new Builder()
        .AddU32(Purchase.ItemCrc, Constants.AttributeIds[0])
        .AddU64(Purchase.FromLevel, 0n)
        .AddU64(Purchase.RequestToLevel, 1n)
        .AddU64(Purchase.SubmittedPrice, 100n)
        .Build();
    const Rejected = Parse(Purchase.Build({ Parsed: Parse(Checkout.Body) }, Context).Body);
    Assert.equal(GetU32(Rejected.Fields, Crc32('RESULT')), 0xf4e7a9b4);
    Assert.equal(Context.Wallets.get('404'), 100000n);
});

Test('Gambling endpoint table preserves exact IDs and explicit evidence status', () => {
    const Gambling = require('../Source/Services/Gambling/Endpoints');
    Assert.deepEqual(Gambling.AllEndpointIds, [0x5095f4be, 0x5d0ecd48, 0xe1982985, 0xc3741502, 0x399bf790, 0x37a37dbe]);
    Assert.deepEqual(Gambling.EndpointIds, [0x5095f4be, 0x5d0ecd48, 0xc3741502, 0x399bf790]);
    Assert.equal(Gambling.Resolve('gambling/current_limits').Id, 0x5095f4be);
    Assert.equal(Gambling.Resolve('GAMBLING/PRIZE_WHEEL/SPIN').Id, 0x399bf790);
    Assert.match(Gambling.Status, /RESPONSE_SCHEMA_PROVISIONAL/);
});

Test('MyCourt endpoint table keeps the 2K19 login rows explicit and provisional', () => {
    const Mycourt = require('../Source/Services/MyCourt/Endpoints');
    Assert.deepEqual(
        Mycourt.AllEndpointIds,
        [0x9595a6a2, 0x7dde97d0, 0x22af8cca, 0x0222a4e4, 0x7fa6c24f, 0xbd2f91df, 0x72c35b69, 0xaeb39dfe, 0x82667321],
    );
    Assert.deepEqual(Mycourt.EndpointIds, [], 'no MMG MyCourt ID is promoted to exact static evidence');
    Assert.equal(Mycourt.Resolve('MYCOURT/InterLockedUpdate').Id, 0x22af8cca);
    Assert.equal(Mycourt.Resolve(0x82667321).Route, 'mycourt/update');
    Assert.match(Mycourt.Status, /RESPONSE_SCHEMA_PROVISIONAL/);
});

Test('Pro-Am routes are all addressable and its proven 2K19 callbacks get safe exact empty shapes', () => {
    const Proam = require('../Source/Services/ProAm/Endpoints');
    Assert.equal(Proam.EndpointList.length, 60);
    Assert.equal(new Set(Proam.AllEndpointIds).size, Proam.AllEndpointIds.length);
    Assert.equal(Proam.Resolve('/nba/2k19/ProAmGameStatsV3/v2/RttTeamLeaderboard?x=test').Id, 0xe2b3fd58);
    Assert.equal(Proam.Resolve('/nba/2k19/mmg/proam/InterLockedUpdate').Id, 0x7d1313a6);
    Assert.equal(Proam.Resolve('gamestatsv4/get_user_leaderboard').Id, 0xb97c9371);

    const User = Proam.Build({ Parsed: { Fields: [] } }, { Route: 'gamestatsv4/get_user_leaderboard' });
    const UserFields = Parse(User.Body, { FieldListSize: User.FieldListSize }).Fields;
    Assert.equal(GetU32(UserFields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(UserFields, Proam.Fields.LeaderboardCount), 0n);

    const Team = Proam.Build({ Parsed: { Fields: [] } }, { Route: 'gamestatsv4/get_team_leaderboard' });
    const TeamFields = Parse(Team.Body, { FieldListSize: Team.FieldListSize }).Fields;
    Assert.equal(GetU64(TeamFields, Proam.Fields.LeaderboardCount), 0n);

    const Featured = Proam.Build({ Parsed: { Fields: [] } }, { Route: 'gamestatsv4/get_featured_team_user_stats' });
    const FeaturedFields = Parse(Featured.Body, { FieldListSize: Featured.FieldListSize }).Fields;
    Assert.equal(GetU64(FeaturedFields, Proam.Fields.FeaturedCount), 0n);
    Assert.equal(GetU32(FeaturedFields, Proam.Fields.FeaturedKind), 0);
});

Test('Pro-Am capture-backed team update is retained for the matching local account', () => {
    const Proam = require('../Source/Services/ProAm/Endpoints');
    const Teams = new Map();
    const Req = new Builder()
        .AddString8(Proam.Fields.TeamName, 'Test')
        .AddU64(Proam.Fields.CapturedTeamId, 0n)
        .AddString8(Proam.Fields.CapturedTeamCity, 'CITY')
        .AddString8(Proam.Fields.CapturedTeamLogo, 'logo_proam_gold.iff')
        .Build();
    const Context = { Route: 'gamestatsv4/create_or_update_team_info', userId: 42n, ProAmTeams: Teams };
    const Update = Proam.Build({ Parsed: Parse(Req.Body) }, Context);
    Assert.equal(GetU32(Parse(Update.Body).Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const Stored = Teams.get('42');
    Assert.equal(Stored.TeamName, 'Test');
    Assert.notEqual(Stored.TeamId, 0n);
    Assert.equal(Stored.City, 'CITY');
    Assert.equal(Stored.Logo, 'logo_proam_gold.iff');
    Assert.equal(Stored.version, 1n);
    const UpdateFields = Parse(Update.Body, { FieldListSize: Update.FieldListSize }).Fields;
    Assert.equal(GetString8(UpdateFields, Proam.Fields.TeamName), 'Test');
    Assert.equal(GetString8(UpdateFields, Proam.Fields.CapturedTeamCity), 'CITY');
    Assert.equal(GetU64(UpdateFields, Proam.Fields.TeamId), Stored.TeamId);
    Assert.equal(GetU64(UpdateFields, Proam.Fields.Version), 1n);

    const LogoRequest = new Builder().AddString8(Proam.Fields.CapturedTeamLogo, 'logo_proam_silver.iff').Build();
    const LogoUpdate = Proam.Build({ Parsed: Parse(LogoRequest.Body) }, Context);
    const Revised = Teams.get('42');
    Assert.equal(Revised.TeamName, 'Test');
    Assert.equal(Revised.City, 'CITY');
    Assert.equal(Revised.Logo, 'logo_proam_silver.iff');
    Assert.equal(Revised.TeamId, Stored.TeamId);
    Assert.equal(Revised.version, 2n);
    Assert.equal(
        GetU64(Parse(LogoUpdate.Body, { FieldListSize: LogoUpdate.FieldListSize }).Fields, Proam.Fields.Version),
        2n,
    );

    const Reply = Proam.Build({ Parsed: { Fields: [] } }, { ...Context, Route: 'proamgamestatsv3/getteaminfo' });
    const Fields = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
    Assert.equal(GetString8(Fields, Proam.Fields.TeamName), 'Test');
    Assert.equal(GetString8(Fields, Proam.Fields.CapturedTeamLogo), 'logo_proam_silver.iff');
    Assert.equal(GetU64(Fields, Proam.Fields.TeamId), Stored.TeamId);
    Assert.equal(GetU64(Fields, Proam.Fields.Version), 2n);
});

Test('purchased attribute levels survive a Granite restart', () => {
    const { LoadCareers, SaveCareers } = require('../Source/Server');
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Purchase = require('../Source/Services/VirtualCurrency/Purchase');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');

    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-careers-'));
    const File = Path.join(Root, 'career', 'attributes.json');
    const UserId = 76561197960267777n;
    const Upgraded = Constants.AttributeIds[0];

    const Careers = new Map();
    const Context = {
        userId: UserId,
        Careers,
        Wallets: new Map(),
        Purchases: new Map(),
        SaveCareers: () => SaveCareers(File, Careers),
    };
    const Req = new Builder()
        .AddU32(Purchase.ItemCrc, Upgraded)
        .AddU64(Purchase.FromLevel, 0n)
        .AddU64(Purchase.RequestToLevel, 1n)
        .Build();
    const Reply = Parse(Purchase.Build({ Parsed: Parse(Req.Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'), 'the upgrade was accepted');

    const LiveLevel = Careers.get(Constants.CareerKey(Context)).find((Item) => Item.id === Upgraded).level;
    Assert.equal(LiveLevel, 1n, 'the level is live in memory');
    Assert.ok(Fs.existsSync(File), 'the purchase was written to disk');

    const Reloaded = LoadCareers(File);
    Assert.ok(Reloaded.has(Constants.CareerKey(Context)), 'the career came back from disk');

    const FreshContext = { userId: UserId, Careers: Reloaded, Wallets: new Map(), Purchases: new Map() };
    const GetReply = Get.Build({ Parsed: { Fields: [] } }, FreshContext);
    const Fields = Parse(GetReply.Body, { FieldListSize: GetReply.FieldListSize }).Fields;
    const Names = Fields.filter((Field) => Field.Crc === Constants.Name).map((Field) => Field.Data1 >>> 0);
    const Levels = Fields.filter((Field) => Field.Crc === Constants.Level).map((Field) =>
        GetU64([Field], Constants.Level),
    );

    Assert.equal(Names.length, Constants.AttributeIds.length, 'all sixteen attributes are still reported');
    Assert.equal(
        Levels[Names.indexOf(Upgraded)],
        1n,
        'the purchased level survived the restart instead of resetting to the build default',
    );
    for (let Index = 0; Index < Names.length; Index++) {
        if (Names[Index] === Upgraded) continue;
        Assert.equal(Levels[Index], 0n, 'untouched attributes stay at their build default');
    }

    Fs.rmSync(Root, { recursive: true, force: true });
});

Test('a 98 overall asserted by Attributes/price is adopted and returned by Attributes/get', () => {
    const Price = require('../Source/Services/MyCareer/Attributes/Price');
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Captured = [17n, 8n, 20n, 20n, 23n, 23n, 11n, 11n, 14n, 11n, 14n, 17n, 22n, 23n, 13n, 25n];

    const Careers = new Map();
    const Saved = [];
    const Context = {
        userId: 76561198843023395n,
        Careers,
        Wallets: new Map(),
        Purchases: new Map(),
        SaveCareers: () => Saved.push(true),
    };

    const Before = Get.Build({ Parsed: { Fields: [] } }, Context);
    const BeforeLevels = Parse(Before.Body, { FieldListSize: Before.FieldListSize })
        .Fields.filter((F) => F.Crc === Constants.Level)
        .map((F) => GetU64([F], Constants.Level));
    Assert.deepEqual(
        BeforeLevels,
        Constants.AttributeIds.map(() => 0n),
    );

    const Req = new Builder();
    for (const Id of Constants.AttributeIds) Req.AddU32(Constants.Name, Id);
    for (const Level of Captured) Req.AddU64(Constants.Level, Level);
    Price.Build({ Parsed: Parse(Req.Build().Body) }, Context);
    Assert.ok(Saved.length > 0, 'adopting the levels persisted them');

    const After = Get.Build({ Parsed: { Fields: [] } }, Context);
    const Fields = Parse(After.Body, { FieldListSize: After.FieldListSize }).Fields;
    const Names = Fields.filter((F) => F.Crc === Constants.Name).map((F) => F.Data1 >>> 0);
    const Levels = Fields.filter((F) => F.Crc === Constants.Level).map((F) => GetU64([F], Constants.Level));
    const Caps = Fields.filter((F) => F.Crc === Constants.CurrentCap).map((F) => GetU64([F], Constants.CurrentCap));
    for (let Index = 0; Index < Names.length; Index++) {
        const Wanted = Captured[Constants.AttributeIds.indexOf(Names[Index])];
        const Ceiling = Caps[Index] < 25n ? Caps[Index] : 25n;
        Assert.equal(
            Levels[Index],
            Wanted > Ceiling ? Ceiling : Wanted,
            `attribute ${Index} came back at the level the client asserted`,
        );
    }

    const Lower = new Builder();
    for (const Id of Constants.AttributeIds) Lower.AddU32(Constants.Name, Id);
    for (const _ of Captured) Lower.AddU64(Constants.Level, 0n);
    Price.Build({ Parsed: Parse(Lower.Build().Body) }, Context);
    const FinalReply = Get.Build({ Parsed: { Fields: [] } }, Context);
    const FinalLevels = Parse(FinalReply.Body, { FieldListSize: FinalReply.FieldListSize })
        .Fields.filter((F) => F.Crc === Constants.Level)
        .map((F) => GetU64([F], Constants.Level));
    Assert.notDeepEqual(
        FinalLevels,
        Constants.AttributeIds.map(() => 0n),
        'a zeroed assertion does not wipe the adopted levels',
    );
});

Test('NBA 2K19 Attributes/get grants the native Jumpshot Creator feature at 75 OVR progress', () => {
    const Get = require('../Source/Services/MyCareer/Attributes/Get');
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const MaxLevels = [17n, 8n, 20n, 20n, 23n, 23n, 11n, 11n, 14n, 11n, 14n, 17n, 22n, 23n, 13n, 25n];
    const Context = {
        userId: 76561198843023395n,
        Careers: new Map([
            [
                '76561198843023395:0',
                Constants.AttributeIds.map((Id, Index) => ({
                    id: Id,
                    level: MaxLevels[Index],
                    initial: 60n,
                    cap: 99n,
                    maxLevel: MaxLevels[Index],
                })),
            ],
        ]),
        AttributeProfiles: new Map([['76561198843023395:0', { maxLevels: MaxLevels }]]),
    };

    const Reply = Get.Build({ Parsed: { Fields: [] } }, Context);
    const Fields = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
    Assert.equal(Get.EstimateOverallForUnlocks(Constants.AttributesFor(Context)), 98);
    Assert.deepEqual(
        Fields.filter((Field) => Field.Crc === Get.FeatureUnlock).map((Field) => Field.Data1 >>> 0),
        [Get.JumpshotCreator],
    );

    const FreshContext = { userId: 'fresh-player', Careers: new Map() };
    const Fresh = Get.Build({ Parsed: { Fields: [] } }, FreshContext);
    const FreshFields = Parse(Fresh.Body, { FieldListSize: Fresh.FieldListSize }).Fields;
    Assert.equal(Get.EstimateOverallForUnlocks(Constants.AttributesFor(FreshContext)), 60);
    Assert.equal(FreshFields.filter((Field) => Field.Crc === Get.FeatureUnlock).length, 0);
});
