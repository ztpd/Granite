// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { test: Test } = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Zlib = require('node:zlib');

const { Builder, Types, Parse, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const VCPurchase = require('../Source/Services/VirtualCurrency/Purchase');
const StorePurchase = require('../Source/Services/Store/Purchase');
const StoreOwned = require('../Source/Services/Store/GetOwnedItems');
const Inventory = require('../Source/Services/Inventory/GetWithTag');
const Owned = require('../Source/Storage/OwnedItems');

const Anim = 0x75987e61;
const AnimType = 0x298ec8aa;

function VcContext(UserId = 42n) {
    return {
        userId: UserId,
        Wallets: new Map([[String(UserId), 100000n]]),
        Careers: new Map(),
        Purchases: new Map(),
        OwnedItems: new Map(),
        AttributeProfiles: new Map(),
        Saved: 0,
        SaveOwnedItems() {
            this.Saved += 1;
        },
    };
}

function VcBody(Item, Type = AnimType) {
    return new Builder()
        .AddStringCrc(VCPurchase.ItemCrc, Item >>> 0)
        .AddStringCrc(VCPurchase.PurchaseType, Type >>> 0)
        .AddU64(VCPurchase.SubmittedPrice, 100n)
        .Build();
}

Test('a bought animation is recorded per account instead of dropped', () => {
    const Context = VcContext();
    const Reply = Parse(VCPurchase.Build({ Parsed: Parse(VcBody(Anim).Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const OwnedSet = Owned.ListOwnedItems(Context.OwnedItems, Owned.OwnedKey(Context));
    Assert.equal(OwnedSet.length, 1);
    Assert.equal(OwnedSet[0].item, '0x75987E61');
    Assert.equal(Context.Saved, 1);
});

Test('the purchase reply echoes the cart so the client commits it locally', () => {
    const Context = VcContext();
    const Reply = Parse(VCPurchase.Build({ Parsed: Parse(VcBody(Anim).Body) }, Context).Body);
    const Crcs = Reply.Fields.map((F) => F.Crc >>> 0);
    Assert.deepEqual(
        [...Crcs].sort((A, B) => A - B),
        Crcs,
    );
    const Items = Reply.Fields.filter((F) => F.Crc === VCPurchase.ItemCrc);
    Assert.equal(Items.length, 1);
    Assert.equal(Items[0].Data1 >>> 0, Anim >>> 0);
});

Test('a tattoo purchase returns one complete 2K19 consumable transaction record', () => {
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Context = VcContext();
    const Body = new Builder()
        .AddU64(Tx.CareerKey, 0n)
        .AddStringCrc(VCPurchase.PurchaseType, AnimType)
        .AddStringCrc(VCPurchase.ItemCrc, Anim)
        .AddU64(VCPurchase.SubmittedPrice, 275n)
        .Build();
    const Reply = Parse(VCPurchase.Build({ Parsed: Parse(Body.Body) }, Context).Body);
    Assert.equal(
        Reply.Fields.filter((Field) => Field.Crc === Tx.Item).length,
        1,
        'request echo must not duplicate the purchased tattoo',
    );
    Assert.equal(GetU32(Reply.Fields, Tx.Mode), Prices.TransactionModes.Purchasable);
    Assert.equal(GetU64(Reply.Fields, Tx.Price), 275n);
    Assert.equal(GetU64(Reply.Fields, Tx.CareerKey), 0n);
    Assert.equal(GetU64(Reply.Fields, Tx.Quantity), 1n);
    Assert.equal(
        GetU64(Reply.Fields, VCPurchase.BalanceCrc),
        99725n,
        'generic 2K19 purchase callback publishes the post-transaction wallet',
    );
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
});

Test('attribute carts keep the bare SUCCESS reply', () => {
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Context = VcContext();
    Context.AttributeProfiles.set('42', {
        Initials: Constants.AttributeIds.map(() => 60),
        Caps: { Vertical: 77 },
    });
    const Vertical = Constants.AttributeIds[10];
    const Body = new Builder()
        .AddU32(VCPurchase.ItemCrc, Vertical)
        .AddU64(VCPurchase.FromLevel, 16n)
        .AddU64(VCPurchase.RequestToLevel, 17n)
        .AddU64(VCPurchase.SubmittedPrice, 25n)
        .Build();
    const Reply = Parse(VCPurchase.Build({ Parsed: Parse(Body.Body) }, Context).Body);
    Assert.equal(Reply.Fields.length, 1);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
});

Test('re-buying refreshes the record instead of duplicating it', () => {
    const Context = VcContext();
    const Input = () => ({ Parsed: Parse(VcBody(Anim).Body) });
    VCPurchase.Build(Input(), Context);
    VCPurchase.Build(Input(), Context);
    const OwnedSet = Owned.ListOwnedItems(Context.OwnedItems, Owned.OwnedKey(Context));
    Assert.equal(OwnedSet.length, 1);
});

Test('attribute items stay in careers, not in owned items', () => {
    const Constants = require('../Source/Services/MyCareer/Attributes/Constants');
    const Context = VcContext();
    Context.AttributeProfiles.set('42', {
        Initials: Constants.AttributeIds.map(() => 60),
        Caps: { Vertical: 77 },
    });
    const Vertical = Constants.AttributeIds[10];
    const Body = new Builder()
        .AddU32(VCPurchase.ItemCrc, Vertical)
        .AddU64(VCPurchase.FromLevel, 16n)
        .AddU64(VCPurchase.RequestToLevel, 17n)
        .AddU64(VCPurchase.SubmittedPrice, 25n)
        .Build();
    VCPurchase.Build({ Parsed: Parse(Body.Body) }, Context);
    Assert.equal(Owned.ListOwnedItems(Context.OwnedItems, Owned.OwnedKey(Context)).length, 0);
});

Test('Inventory/get_with_tag serves native compressed 2K19 inventory entries', () => {
    const Context = VcContext();
    const Empty = Parse(Inventory.Build({ Parsed: { Fields: [] } }, Context).Body);
    Assert.equal(GetU32(Empty.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Empty.Fields.filter((F) => F.Crc === Inventory.Fields.CompressedItem).length, 0);

    VCPurchase.Build({ Parsed: Parse(VcBody(Anim).Body) }, Context);
    const Outer = Parse(Inventory.Build({ Parsed: { Fields: [] } }, Context).Body);
    const Size = Outer.Fields.find((F) => F.Crc === Inventory.Fields.UncompressedSize);
    const BlobData = Outer.Fields.find((F) => F.Crc === Inventory.Fields.CompressedItem);
    Assert.ok(Size && BlobData && Buffer.isBuffer(BlobData.value));
    const Inflated = Zlib.inflateSync(BlobData.value);
    Assert.equal(Inflated.length, Number(Size.value));
    const Inner = Parse(Inflated);
    const Item = Inner.Fields.find((F) => F.Crc === VCPurchase.ItemCrc);
    const Ownership = Inner.Fields.find((F) => F.Crc === Inventory.Fields.OwnershipMask);
    Assert.equal(Item.Type >>> 0, Types.StringCrc, 'GetStringCrc requires a native StringCrc record');
    Assert.equal(Item.Data1 >>> 0, Anim >>> 0, 'GetStringCrc reads the item CRC from data1');
    Assert.equal(Ownership.value, 1n, 'ownership value one sets the native catalogue owned bit');
    Assert.match(Inventory.Status, /IDA_EXACT_2K19/);
});

Test('the live 0x817649DE animation survives the exact nested inventory wire format', () => {
    const LiveAnimation = 0x817649de;
    const Entry = Inventory.BuildItem(LiveAnimation);
    const Inner = Parse(Zlib.inflateSync(Entry.Compressed));
    const Item = Inner.Fields.find((Field) => Field.Crc === VCPurchase.ItemCrc);
    Assert.ok(Item);
    Assert.equal(Item.Type >>> 0, Types.StringCrc);
    Assert.equal(Item.Data1 >>> 0, LiveAnimation >>> 0);
    Assert.equal(Inner.Fields.find((Field) => Field.Crc === Inventory.Fields.OwnershipMask).value, 1n);
});

Test('StoreV4 get_owned_items retains its separate provisional response', () => {
    const Context = VcContext();
    VCPurchase.Build({ Parsed: Parse(VcBody(Anim).Body) }, Context);
    const Full = Parse(StoreOwned.Build({ Parsed: { Fields: [] } }, Context).Body);
    const Items = Full.Fields.filter((F) => F.Crc === VCPurchase.ItemCrc);
    Assert.equal(Items.length, 1);
    Assert.equal(Items[0].Data1 >>> 0, Anim >>> 0);
});

Test('store purchase records items too', () => {
    const Context = VcContext();
    const Reply = Parse(StorePurchase.Build({ Parsed: Parse(VcBody(Anim).Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Owned.ListOwnedItems(Context.OwnedItems, Owned.OwnedKey(Context)).length, 1);
});

Test('owned items survive a save/load round trip', () => {
    const Dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-owned-'));
    const File = Path.join(Dir, 'owned-items.json');
    const OwnedSet = new Map();
    Owned.RememberOwnedItem(OwnedSet, '011000010000002A', { item: Anim, purchaseType: AnimType, price: 100n });
    Owned.SaveOwnedItems(File, OwnedSet);
    const Reloaded = Owned.LoadOwnedItems(File);
    const Entries = Owned.ListOwnedItems(Reloaded, '011000010000002A');
    Assert.equal(Entries.length, 1);
    Assert.equal(Entries[0].item, '0x75987E61');
    Assert.equal(Entries[0].purchaseType, '0x298EC8AA');
    Fs.rmSync(Dir, { recursive: true, force: true });
});

const WheelzItem = 0x451aef05;
const WheelzItem2 = 0x2222753a;
const WheelzType = 0x4feaedaa;
const WheelzAssertedPrice = 0xcfaeb7cf;
const WheelzSelector = 0xb1f44f7f;
const WheelzCareerKey = 0x94c3c196;

function WheelzPriceBody(...Items) {
    const Req = new Builder();
    Items.forEach((Item, Index) => Req.AddU32(Crc32(`ITEM_${Index}`), Item >>> 0));
    return Req.Build();
}

function WheelzCartBody(Item, { AssertedPrice = 200n, Selector = 11n } = {}) {
    return new Builder()
        .AddU64(WheelzCareerKey, 0n)
        .AddU64(WheelzSelector, Selector)
        .AddStringCrc(VCPurchase.PurchaseType, WheelzType >>> 0)
        .AddU64(WheelzAssertedPrice, AssertedPrice)
        .AddU64(VCPurchase.CloudSaveId, 0n)
        .AddStringCrc(VCPurchase.ItemCrc, Item >>> 0)
        .Build();
}

Test('Wheelz get_prices advertises a flat 100 VC per requested item', () => {
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Context = { VcPrices: new Map() };
    const Reply = Parse(
        Prices.Build({ Parsed: Parse(WheelzPriceBody(WheelzItem, WheelzItem2, Anim).Body) }, Context).Body,
    );
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    for (let Index = 0; Index < 3; Index++) {
        Assert.equal(GetU32(Reply.Fields, Crc32(`PRICE_${Index}`)), 100, `PRICE_${Index} is 100 VC`);
        Assert.equal(GetU32(Reply.Fields, Crc32(`FINAL_PRICE_${Index}`)), 100, `FINAL_PRICE_${Index} is 100 VC`);
        Assert.equal(GetU32(Reply.Fields, Crc32(`MYTEAM_PRICE_${Index}`)), 100, `MYTEAM_PRICE_${Index} is 100 VC`);
        Assert.equal(
            GetU32(Reply.Fields, Crc32(`FINAL_MYTEAM_PRICE_${Index}`)),
            100,
            `FINAL_MYTEAM_PRICE_${Index} is 100 VC`,
        );
    }
    Assert.equal(Reply.Fields.length, 3 * 5 + 1, 'regular store reply has five dynamic columns per item plus RESULT');
    for (const Field of Reply.Fields) {
        Assert.notEqual(Field.Data1 >>> 0, 0xffffffff, `no -1 sentinel in 0x${Field.Crc.toString(16).toUpperCase()}`);
    }
    Assert.equal(Context.VcPrices.get(WheelzItem >>> 0).price, 100n);
});

const { LoadCatalogPrices } = require('../Source/Storage/StoreCatalog');
const CatalogPrices = LoadCatalogPrices(Path.join(__dirname, '..', 'Storage', 'Inventory', 'AutomaticCatalog.json'));

Test('a captured tattoo cart is charged its native store price, not a flat 100 VC', () => {
    const Body = Fs.readFileSync(Path.join(__dirname, 'Fixtures', 'TattooPurchase', 'Cart36.bin'));
    const Cart = Parse(Body);
    Assert.equal(GetU32(Cart.Fields, VCPurchase.PurchaseType), VCPurchase.ConsumablePurchaseType);
    Assert.equal(GetU64(Cart.Fields, Crc32('ITEM0_EXPECTED_PRICE')), 750n);
    Assert.equal(CatalogPrices.get(0x14077e98), 750n, 'native catalog price for Sun And Moon');

    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Context = { ...VcContext(), StoreCatalogPrices: CatalogPrices };
    const Reply = Parse(VCPurchase.Build({ Parsed: Cart }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Context.Wallets.get('42'), 100000n - 750n, 'the tattoo costs 750 VC');
    Assert.equal(GetU64(Reply.Fields, Tx.Price), 750n, 'the transaction record publishes 750');
    Assert.equal(GetU64(Reply.Fields, VCPurchase.BalanceCrc), 99250n);
    const OwnedSet = Owned.ListOwnedItems(Context.OwnedItems, Owned.OwnedKey(Context));
    Assert.equal(OwnedSet[0].item, '0x14077E98');
    Assert.equal(OwnedSet[0].price, '750');
});

Test('consumable carts use the native catalog price over any price the client sends', () => {
    for (const [Item, Native] of [
        [WheelzItem, 200n],
        [WheelzItem2, 2000n],
    ]) {
        const Context = { ...VcContext(), StoreCatalogPrices: CatalogPrices };
        const Cart = new Builder()
            .AddStringCrc(VCPurchase.ItemCrc, Item >>> 0)
            .AddStringCrc(VCPurchase.PurchaseType, WheelzType >>> 0)
            .AddU64(VCPurchase.SubmittedPrice, 1n)
            .AddU64(WheelzAssertedPrice, 1n)
            .Build();
        const Reply = Parse(VCPurchase.Build({ Parsed: Parse(Cart.Body) }, Context).Body);
        Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
        Assert.equal(
            Context.Wallets.get('42'),
            100000n - Native,
            `item 0x${Item.toString(16)} costs its catalog price`,
        );
    }
});

Test('a consumable missing from the catalog is charged its ITEM%d_EXPECTED_PRICE', () => {
    const Context = VcContext();
    const Reply = Parse(
        VCPurchase.Build({ Parsed: Parse(WheelzCartBody(WheelzItem, { AssertedPrice: 650n }).Body) }, Context).Body,
    );
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Context.Wallets.get('42'), 100000n - 650n);
});

Test('a tattoo consumable purchase (spend_consumable_purchase) uses the native catalog price', () => {
    const Prices = require('../Source/Services/VirtualCurrency/GetPrices');
    const Tx = Prices.TransactionFields;
    const Context = { ...VcContext(), StoreCatalogPrices: CatalogPrices };
    const Body = new Builder().AddU32(Tx.Item, 0x14077e98).AddU64(Tx.Quantity, 1n).AddU64(Tx.CareerKey, 0n).Build();
    const Reply = Parse(VCPurchase.BuildConsumable({ Parsed: Parse(Body.Body) }, Context).Body);
    Assert.equal(GetU32(Reply.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(GetU64(Reply.Fields, Tx.Price), 750n);
    Assert.equal(Context.Wallets.get('42'), 99250n);
});

Test('Wheelz ownership equips from inventory, persists, and isolates players', () => {
    const Context = VcContext();
    VCPurchase.Build({ Parsed: Parse(WheelzCartBody(WheelzItem).Body) }, Context);

    const Outer = Parse(Inventory.Build({ Parsed: { Fields: [] } }, Context).Body);
    const BlobData = Outer.Fields.find((F) => F.Crc === Inventory.Fields.CompressedItem);
    Assert.ok(BlobData && Buffer.isBuffer(BlobData.value), 'wheelz part served as inventory entry');
    const Inner = Parse(Zlib.inflateSync(BlobData.value));
    const Item = Inner.Fields.find((F) => F.Crc === VCPurchase.ItemCrc);
    Assert.equal(Item.Type >>> 0, Types.StringCrc);
    Assert.equal(Item.Data1 >>> 0, WheelzItem >>> 0);
    Assert.equal(Inner.Fields.find((F) => F.Crc === Inventory.Fields.OwnershipMask).value, 1n);

    const Full = Parse(StoreOwned.Build({ Parsed: { Fields: [] } }, Context).Body);
    const Items = Full.Fields.filter((F) => F.Crc === VCPurchase.ItemCrc);
    Assert.equal(Items.length, 1);
    Assert.equal(Items[0].Data1 >>> 0, WheelzItem >>> 0);

    const Dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-wheelz-'));
    const File = Path.join(Dir, 'owned-items.json');
    Owned.SaveOwnedItems(File, Context.OwnedItems);
    const Reloaded = Owned.LoadOwnedItems(File);
    const Entries = Owned.ListOwnedItems(Reloaded, Owned.OwnedKey(Context));
    Assert.equal(Entries.length, 1);
    Assert.equal(Entries[0].item, '0x451AEF05');
    Fs.rmSync(Dir, { recursive: true, force: true });

    const Other = VcContext(43n);
    Other.OwnedItems = Context.OwnedItems;
    const OtherInventory = Parse(Inventory.Build({ Parsed: { Fields: [] } }, Other).Body);
    Assert.equal(OtherInventory.Fields.filter((F) => F.Crc === Inventory.Fields.CompressedItem).length, 0);
    const OtherOwned = Parse(StoreOwned.Build({ Parsed: { Fields: [] } }, Other).Body);
    Assert.equal(OtherOwned.Fields.filter((F) => F.Crc === VCPurchase.ItemCrc).length, 0);
});

Test('Store get_items serves bought Wheelz parts in the native inventory envelope', () => {
    const StoreItems = require('../Source/Services/Store/GetItems');
    const EmptyContext = VcContext();
    const Empty = Parse(StoreItems.Build({ Parsed: { Fields: [] } }, EmptyContext).Body);
    Assert.equal(GetU32(Empty.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    Assert.equal(Empty.Fields.filter((F) => F.Crc === Inventory.Fields.CompressedItem).length, 0);

    const Context = VcContext();
    VCPurchase.Build({ Parsed: Parse(WheelzCartBody(WheelzItem).Body) }, Context);
    const Outer = Parse(StoreItems.Build({ Parsed: { Fields: [] } }, Context).Body);
    Assert.equal(GetU32(Outer.Fields, Crc32('RESULT')), Crc32('SUCCESS'));
    const Size = Outer.Fields.find((F) => F.Crc === Inventory.Fields.UncompressedSize);
    const BlobData = Outer.Fields.find((F) => F.Crc === Inventory.Fields.CompressedItem);
    Assert.ok(Size && BlobData && Buffer.isBuffer(BlobData.value));
    const Inflated = Zlib.inflateSync(BlobData.value);
    Assert.equal(Inflated.length, Number(Size.value));
    const Inner = Parse(Inflated);
    const Item = Inner.Fields.find((F) => F.Crc === VCPurchase.ItemCrc);
    Assert.equal(Item.Type >>> 0, Types.StringCrc, 'GetStringCrc requires a native StringCrc record');
    Assert.equal(Item.Data1 >>> 0, WheelzItem >>> 0, 'bought Wheelz part listed for equip');
    Assert.equal(Inner.Fields.find((F) => F.Crc === Inventory.Fields.OwnershipMask).value, 1n);
    Assert.match(StoreItems.Status, /IDA_EXACT_2K19/);
});
