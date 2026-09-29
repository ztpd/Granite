// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { ItemCrc, PurchaseType } = require('../VirtualCurrency/Purchase');
const { InventoryFor } = require('../../Storage/AutomaticOwnership');

const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const Owned = InventoryFor(Context);
    for (const Entry of Owned) {
        Reply.AddStringCrc(ItemCrc, Number(Entry.item));
        if (Entry.purchaseType) Reply.AddStringCrc(PurchaseType, Number(Entry.purchaseType));
    }
    Reply.AddU32(Result, Success);
    return Reply.Build();
}

module.exports = {
    Build,
    GetOwnedItems: Build,
    Status: 'OWNED_ITEMS_ECHO_SEMANTICS_PROVISIONAL_SCHEMA',
};
