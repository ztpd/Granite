// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetField } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');
const MaxItems = 512;

function PriceCrc(Prefix, Index) {
    return Crc32(`${Prefix}_${Index}`);
}

function ReadRequestedItems(Fields) {
    const Items = [];
    for (let Index = 0; Index < MaxItems; Index++) {
        const Field = GetField(Fields, PriceCrc('ITEM', Index));
        if (!Field) break;
        Items.push({ index: Index, item: Field.Data1 >>> 0 });
    }
    return Items;
}

function ResolvePrice(Item, Index, Context = {}) {
    const Catalog = Context.VcPrices;
    if (Catalog instanceof Map && Catalog.has(Item)) {
        const Value = Catalog.get(Item);
        return Value && typeof Value === 'object'
            ? BigInt(Value.price ?? Value.finalPrice ?? 100)
            : BigInt(Value ?? 100);
    }
    return 100n + BigInt(Index) * 25n;
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Items = ReadRequestedItems(Fields);
    const Reply = new Builder();
    for (const { index: Index, item: Item } of Items) {
        const Price = ResolvePrice(Item, Index, Context);
        if (Context.VcPrices instanceof Map) Context.VcPrices.set(Item, { price: Price, finalPrice: Price });
        Reply.AddStringCrc(PriceCrc('ITEM', Index), Item)
            .AddU64(PriceCrc('FINAL_PRICE', Index), Price)
            .AddU64(PriceCrc('PRICE', Index), Price)
            .AddU64(PriceCrc('FINAL_MYTEAM_PRICE', Index), Price)
            .AddU64(PriceCrc('MYTEAM_PRICE', Index), Price);
    }
    return Reply.AddU32(Result, Success).Build();
}

const TransactionFields = Object.freeze({
    Mode: 0x54c7104b,
    Item: 0xfd76cfbd,
    Price: 0xfca5f7d2,
    CareerKey: 0x94c3c196,
    Quantity: 0x728d86d2,
});

const TransactionModes = Object.freeze({
    Purchasable: 0x4905ed7b,
    Consume: 0x01ec264b,
});

function SortRecords(ListBuilder) {
    ListBuilder.Fields.sort((Left, Right) => (Left.Crc >>> 0) - (Right.Crc >>> 0));
    return ListBuilder;
}

module.exports = {
    Build,
    GetPrices: Build,
    TransactionFields,
    TransactionModes,
    SortRecords,
    Status: 'EXACT_2K19_STRINGCRC_ITEMS_U64_PRICES_PROVISIONAL_VALUES',
};
