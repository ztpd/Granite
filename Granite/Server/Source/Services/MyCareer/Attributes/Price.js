// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const {
    AttributeIds,
    Name,
    Level,
    PriceCount,
    ToLevel,
    Price,
    SecondPrice,
    AttributesFor,
    AsBigInt,
} = require('./Constants');

const DefaultPriceBase = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_BASE || 100, 100n);
const DefaultPriceStep = AsBigInt(process.env.GRANITE_ATTRIBUTE_PRICE_STEP || 25, 25n);

function PriceForLevel(LevelValue, Context = {}) {
    const Custom = Context.AttributePrices;
    if (Custom instanceof Map && Custom.has(Number(LevelValue))) return AsBigInt(Custom.get(Number(LevelValue)));
    return DefaultPriceBase + (BigInt(LevelValue) - 1n) * DefaultPriceStep;
}

function RequestedLevels(Fields) {
    const Levels = GetFields(Fields, Level);
    return AttributeIds.map((_, Index) => {
        const Field = Levels[Index];
        if (!Field) return 0n;
        return (BigInt(Field.Data1 >>> 0) << 32n) | BigInt(Field.Data2 >>> 0);
    });
}

function RequestedIds(Fields) {
    const Ids = GetFields(Fields, Name).map((Field) => Field.Data1 >>> 0);
    return Ids.length ? Ids : AttributeIds.slice();
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Ids = RequestedIds(Fields);
    const Levels = RequestedLevels(Fields);
    const Live = AttributesFor(Context);
    let Adopted = 0;
    if (GetFields(Fields, Level).length) {
        const ByIdForAdopt = new Map(Live.map((Item) => [Item.id >>> 0, Item]));
        for (let Index = 0; Index < Ids.length && Index < Levels.length; Index++) {
            const Item = ByIdForAdopt.get(Ids[Index] >>> 0);
            if (!Item) continue;
            const Asserted = Levels[Index];
            if (Asserted <= Item.level) continue;
            const Ceiling = Item.maxLevel !== undefined && Item.maxLevel < 25n ? Item.maxLevel : 25n;
            const Next = Asserted > Ceiling ? Ceiling : Asserted;
            if (Next > Item.level) {
                Item.level = Next;
                Adopted++;
            }
        }
        if (Adopted && typeof Context.SaveCareers === 'function') Context.SaveCareers();
    }
    const ById = new Map(Live.map((Item) => [Item.id >>> 0, Item]));
    const Reply = new Builder();
    const Sections = [];

    for (let Index = 0; Index < Ids.length && Index < 16; Index++) {
        const Id = Ids[Index] >>> 0;
        const Current = AsBigInt(Levels[Index]);
        const Attribute = ById.get(Id);
        const Maximum = Attribute && Attribute.maxLevel !== undefined ? AsBigInt(Attribute.maxLevel, 25n) : 25n;
        const Cap = Maximum < 0n ? 0n : Maximum > 25n ? 25n : Maximum;
        const Start = Current < 0n ? 0 : Number(Current > Cap ? Cap : Current);
        const Count = Math.max(0, Number(Cap) - Start);
        Sections.push({ id: Id, Current, Start, cap: Cap, Count });
    }

    for (const Section of Sections) {
        Reply.AddU32(Name, Section.id).AddU64(Level, Section.Current).AddU64(PriceCount, Section.Count);
    }
    for (const Section of Sections) {
        for (let To = Section.Start + 1; To <= Number(Section.cap); To++) {
            const PriceValue = PriceForLevel(To, Context);
            Reply.AddU64(ToLevel, To).AddU64(Price, PriceValue).AddU64(SecondPrice, PriceValue);
        }
    }
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    Price: Build,
    Status: 'CONFIRMED_2K19_PRICE_RESPONSE_SHAPE_PROVISIONAL_VALUES',
};
