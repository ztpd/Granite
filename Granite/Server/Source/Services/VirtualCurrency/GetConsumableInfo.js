// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetU32, GetU64 } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const Balance = require('./Balance');
const { TransactionFields, TransactionModes, SortRecords } = require('./GetPrices');

const ExtraInfo = 0xedfb4014;
const BalanceField = 0x93b1e1e4;

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Reply = new Builder();
    Reply.AddU32(TransactionFields.Mode, TransactionModes.Purchasable)
        .AddU64(TransactionFields.Quantity, 0n)
        .AddU64(TransactionFields.CareerKey, GetU64(Fields, TransactionFields.CareerKey) ?? 0n)
        .AddU64(BalanceField, Balance.BalanceFor(Context))
        .AddU64(TransactionFields.Price, GetU64(Fields, TransactionFields.Price) ?? 0n)
        .AddU32(TransactionFields.Item, GetU32(Fields, TransactionFields.Item) ?? 0)
        .AddU64(ExtraInfo, 0n)
        .AddU32(Crc32('RESULT'), Crc32('SUCCESS'));
    return SortRecords(Reply).Build();
}

module.exports = {
    Build,
    GetConsumableInfo: Build,
    Consume: Build,
    Status: 'IDA_EXACT_2K19_CONSUMABLE_TRANSACTION_FIELDS',
};
