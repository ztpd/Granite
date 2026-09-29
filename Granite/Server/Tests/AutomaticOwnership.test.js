// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Path = require('node:path');
const Zlib = require('node:zlib');
const { Parse, Types } = require('../Source/Codec/FieldList');
const { LoadAutomaticItems, InventoryFor } = require('../Source/Storage/AutomaticOwnership');
const { OwnedKey } = require('../Source/Storage/OwnedItems');
const Inventory = require('../Source/Services/Inventory/GetWithTag');
const StoreOwned = require('../Source/Services/Store/GetOwnedItems');
const CatalogPath = Path.resolve(__dirname, '../Storage/Inventory/AutomaticCatalog.json');

Test('manifest archive import contains native ownership IDs, including direct clothing and shoe references', () => {
    const Catalog = require(CatalogPath);
    Assert.equal(Catalog.nativeRecordCount, 28470);
    Assert.equal(Catalog.items.length, 28470);
    const Tattoo = Catalog.items.find((Entry) => Entry.item === '0x7CA80600');
    Assert.equal(Tattoo.name, '2K Logo');
    const Hoodie = Catalog.items.find((Entry) => Entry.item === '0x7C875DB3');
    Assert.equal(Hoodie.name, 'Jordan City Of Flight Sleeveless Hoodie');
    Assert.match(
        Hoodie.content[0],
        /^cdn\/store\/clothing\/win64\/items\/hoodie_sleeveless_jordan_city_of_flight_wht\./,
    );
    const Shoe = Catalog.items.find((Entry) => Entry.item === '0x2C1724A8');
    Assert.equal(Shoe.name, 'Curry 5');
    Assert.match(Shoe.content[0], /^cdn\/store\/shoes\/win64\/data\/shoe_4029_knicks_home\./);
    Assert.equal(new Set(Catalog.items.map((Entry) => Entry.item)).size, Catalog.items.length);
    const Attributes = require('../Source/Services/MyCareer/Attributes/Constants').AttributeIds;
    Assert.equal(Catalog.items.filter((Entry) => Attributes.includes(Number(Entry.item))).length, 0);
});

Test('automatic grants merge without debiting VC, rewriting purchases, or leaking another account purchases', () => {
    const AutomaticOwnedItems = LoadAutomaticItems(CatalogPath);
    const Context = { userId: 42n, AutomaticOwnedItems, OwnedItems: new Map(), Wallets: new Map([['42', 123n]]) };
    const Purchased = { item: AutomaticOwnedItems[0].item, price: '777', purchaseType: '0x00000001' };
    const Exclusive = { item: '0x817649DE', price: '100', purchaseType: null };
    Context.OwnedItems.set(OwnedKey(Context), [Purchased, Exclusive]);
    const Before = JSON.stringify([...Context.OwnedItems]);
    const Result = InventoryFor(Context);
    Assert.equal(Result.length, 28471);
    Assert.equal(
        Result.find((Entry) => Entry.item === Purchased.item),
        Purchased,
    );
    Assert.ok(Result.includes(Exclusive));
    const Other = InventoryFor({ ...Context, userId: 43n });
    Assert.equal(Other.length, 28470);
    Assert.ok(!Other.includes(Exclusive));
    Assert.deepEqual(InventoryFor({ ...Context, userId: null }), []);
    Assert.equal(JSON.stringify([...Context.OwnedItems]), Before);
    Assert.equal(Context.Wallets.get('42'), 123n);
    Assert.deepEqual(InventoryFor({ ...Context, AutomaticOwnedItems: [] }), [Purchased, Exclusive]);
});

Test('all 28,470 items survive the native compressed inventory response without truncation', () => {
    const AutomaticOwnedItems = LoadAutomaticItems(CatalogPath);
    const Context = { userId: 42n, AutomaticOwnedItems, OwnedItems: new Map() };
    const Reply = Inventory.Build({}, Context);
    const Outer = Parse(Reply.Body, { FieldListSize: Reply.FieldListSize }).Fields;
    const Blobs = Outer.filter((Field) => Field.Crc === 0x9cc95621);
    const Sizes = Outer.filter((Field) => Field.Crc === 0x634465d8);
    Assert.equal(Blobs.length, 56);
    Assert.equal(Sizes.length, Blobs.length);
    const Received = [];
    Blobs.forEach((BlobData, Index) => {
        const Raw = Zlib.inflateSync(BlobData.Raw);
        Assert.equal(Sizes[Index].Type, Types.U64);
        Assert.equal(BigInt(Raw.length), Sizes[Index].value);
        const Inner = Parse(Raw).Fields;
        const Items = Inner.filter((Field) => Field.Crc === 0xfd76cfbd);
        const Masks = Inner.filter((Field) => Field.Crc === 0xfbe14f6f);
        Assert.ok(Items.length <= 512);
        Assert.equal(Items.length, Masks.length);
        Items.forEach((Item, Occurrence) => {
            Assert.equal(Item.Type, Types.StringCrc);
            Assert.equal(Masks[Occurrence].Type, Types.U64);
            Assert.equal(Masks[Occurrence].value, 1n);
            Received.push(Item.Data1);
        });
    });
    Assert.deepEqual(
        Received,
        AutomaticOwnedItems.map((Entry) => Number(Entry.item)),
    );
    const Legacy = Parse(StoreOwned.Build({}, Context).Body)
        .Fields.filter((Field) => Field.Crc === 0xfd76cfbd)
        .map((Field) => Field.Data1);
    Assert.deepEqual(Legacy, Received);
});
