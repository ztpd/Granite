// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');
const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc } = require('../VirtualCurrency/Purchase');
const { InventoryFor } = require('../../Storage/AutomaticOwnership');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');
const CompressedItem = 0x9cc95621;
const UncompressedSize = 0x634465d8;
const OwnershipMask = 0xfbe14f6f;
const Owned = 1n;

function BuildBlock(Items) {
    const ListBuilder = new Builder();
    for (const Item of Items) ListBuilder.AddU64(OwnershipMask, Owned);
    for (const Item of Items) ListBuilder.AddStringCrc(ItemCrc, Number(Item) >>> 0);
    const Inner = ListBuilder.Build().Body;
    return { Inner, Compressed: Zlib.deflateSync(Inner, { level: 9 }) };
}

function BuildItem(Item) {
    return BuildBlock([Item]);
}

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const OwnedSet = InventoryFor(Context);
    const Items = [];
    for (let Offset = 0; Offset < OwnedSet.length; Offset += 512)
        Items.push(BuildBlock(OwnedSet.slice(Offset, Offset + 512).map((Entry) => Entry.item)));
    for (const Item of Items) Reply.AddU64(UncompressedSize, BigInt(Item.Inner.length));
    for (const Item of Items) Reply.AddBinary(CompressedItem, Item.Compressed);
    Reply.AddU32(Result, Success);
    return Reply.Build();
}

module.exports = {
    Build,
    GetWithTag: Build,
    BuildItem,
    Fields: { CompressedItem, UncompressedSize, OwnershipMask, ItemCrc },
    Status: 'IDA_EXACT_2K19_GETSTRINGCRC_INVENTORY_ENTRY_SCHEMA',
};
