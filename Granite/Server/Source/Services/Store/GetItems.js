// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');
const { Builder, DateToVCDate } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');

const Fields = Object.freeze({
    Date: 0x31de3808,
    Compressed: 0x9cc95621,
    Size: 0x634465d8,
    Item: 0xfd76cfbd,
    Price: 0x3d9ce069,
    FinalPrice: 0x417fe697,
});
const ChunkSize = 512;

function Build(Input, Context = {}) {
    const Reply = new Builder().AddVCDate(Fields.Date, DateToVCDate());
    const Updates = Context.VcPrices instanceof Map ? [...Context.VcPrices] : [];
    for (let Offset = 0; Offset < Updates.length; Offset += ChunkSize) {
        const Block = new Builder();
        for (const [Id, Value] of Updates.slice(Offset, Offset + ChunkSize)) {
            const Entry = Value && typeof Value === 'object' ? Value : { price: Value };
            const Price = BigInt(Entry.price ?? Entry.finalPrice ?? 100);
            const FinalPrice = BigInt(Entry.finalPrice ?? Price);
            if (Price < 0n || Price >= 0x3ffffffn || FinalPrice < 0n || FinalPrice >= 0x3ffffffn)
                throw new RangeError('store price must be between 0 and 67108862');
            Block.AddStringCrc(Fields.Item, Id).AddU64(Fields.Price, Price).AddU64(Fields.FinalPrice, FinalPrice);
        }
        const Raw = Block.Build().Body;
        Reply.AddU64(Fields.Size, BigInt(Raw.length)).AddBinary(Fields.Compressed, Zlib.deflateSync(Raw));
    }
    return Reply.AddStringCrc(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    GetItems: Build,
    Fields,
    EndpointIds: [0x25e937ad],
    Status: 'EXACT_2K19_PRICE_UPDATE_PROTOCOL_NATIVE_CATALOG_FALLBACK',
};
