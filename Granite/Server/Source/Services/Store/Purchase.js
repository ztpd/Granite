// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields, GetField, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc, PurchaseType } = require('../VirtualCurrency/Purchase');
const { OwnedKey, RememberOwnedItem } = require('../../Storage/OwnedItems');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Items = GetFields(Fields, ItemCrc).map((Field) => Field.Data1 >>> 0);
    if (Items.length && Context.OwnedItems instanceof Map) {
        const Key = OwnedKey(Context);
        if (Key) {
            for (let Index = 0; Index < Items.length; Index++) {
                const TypeField = GetField(Fields, PurchaseType, Index);
                RememberOwnedItem(Context.OwnedItems, Key, {
                    item: Items[Index] >>> 0,
                    purchaseType: TypeField ? TypeField.Data1 >>> 0 : null,
                    price: 0n,
                });
            }
            if (typeof Context.SaveOwnedItems === 'function') Context.SaveOwnedItems();
        }
    }
    if (Context.Purchases instanceof Map) {
        for (let Index = 0; Index < Items.length; Index++) {
            Context.Purchases.set(`store:${Items[Index] >>> 0}:${Date.now()}:${Index}`, { item: Items[Index] });
        }
    }
    const Echo = Fields.map((Field) => ({
        Crc: Field.Crc >>> 0,
        Type: Field.Type >>> 0,
        Data1: Field.Data1 >>> 0,
        Data2: Field.Data2 >>> 0,
    }));
    Echo.push({ Crc: Result, Type: Types.StringCrc, Data1: Success >>> 0, Data2: 0 });
    Echo.sort((A, B) => A.Crc - B.Crc);
    const Reply = new Builder();
    for (const Record of Echo) Reply.Record(Record.Crc, Record.Type, Record.Data1, Record.Data2);
    return Reply.Build();
}

module.exports = {
    Build,
    Purchase: Build,
    Status: 'OWNED_ITEMS_RECORDED_PRICE_VALIDATION_PROVISIONAL',
};
