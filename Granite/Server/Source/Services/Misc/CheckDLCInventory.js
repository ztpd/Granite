// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU32, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const C = Object.freeze({
    OrderResult: Crc32('ORDER_RESULT'),
    PurchaseLocation: Crc32('PURCHASE_LOCATION'),
    Result: Crc32('RESULT'),
    Success: Crc32('SUCCESS'),
});

function Build(Input) {
    const Fields = Input?.Parsed?.Fields || [];
    const Reply = new Builder().AddU64(C.OrderResult, GetU64(Fields, C.OrderResult) ?? 0n);
    const Where = GetU32(Fields, C.PurchaseLocation);
    if (Where !== null) Reply.AddU32(C.PurchaseLocation, Where);
    return Reply.AddU32(C.Result, C.Success).Build();
}

module.exports = { Build, CheckDLCInventory: Build, Status: 'VERIFIED_EMPTY_INVENTORY' };
