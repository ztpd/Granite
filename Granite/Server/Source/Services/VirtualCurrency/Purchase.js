// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder, GetFields, GetField, Types } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { AttributeIds, AttributesFor, AsBigInt, CareerKey } = require('../MyCareer/Attributes/Constants');
const { BalanceFor, StartingBalance, IsStaticBalance } = require('./Balance');
const { OwnedKey, RememberOwnedItem } = require('../../Storage/OwnedItems');
const { TransactionFields, TransactionModes } = require('./GetPrices');

const ItemCrc = 0xfd76cfbd;
const PurchaseType = 0xc1ed2239;
const CloudSaveId = 0xd5e5f21d;
const BalanceCrc = 0x93b1e1e4;
const ConsumablePurchaseType = 0x4feaedaa;
const ExpectedPriceField = (Index) => Crc32(`ITEM${Index}_EXPECTED_PRICE`);

const FromLevel = 0x97aadcfc;
const SubmittedPrice = 0xfee529c4;
const RequestToLevel = 0xb2080f36;
const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');
const InsufficientFunds = 0xf4e7a9b4;

const CartToLevelFields = Object.freeze([
    0xb2080f36, 0x5dca6408, 0xb6fddf0b, 0x593fb435, 0xbbe3af4c, 0x5421c472, 0xbf167f71, 0x50d4144f, 0xa1df4fc2,
    0x4e1d24fc, 0x42049ca6, 0xadc6f798, 0x46f14c9b, 0xa93327a5, 0x4bef3cdc, 0xa42d57e2,
]);
const CartPriceFields = Object.freeze([
    0xfee529c4, 0x58922270, 0x697a38ed, 0xcf0d3359, 0x0aaa0dd7, 0xacdd0663, 0x9d351cfe, 0x3b42174a, 0xcd0a67a3,
    0x6b7d6c17, 0xae5496fb, 0x08239d4f, 0x39cb87d2, 0x9fbc8c66, 0x5a1bb2e8, 0xfc6cb95c,
]);
const CartFromLevelFields = Object.freeze([0x97aadcfc, 0x0c0f9093]);

function U64(Field) {
    return Field ? (BigInt(Field.Data1 >>> 0) << 32n) | BigInt(Field.Data2 >>> 0) : null;
}

function NativeCatalogPrice(Item, Context = {}) {
    const Catalog = Context.StoreCatalogPrices;
    return Catalog instanceof Map && Catalog.has(Item >>> 0) ? Catalog.get(Item >>> 0) : null;
}

function PriceFor(Item, Index, Fields, Context = {}) {
    const TypeField = GetField(Fields, PurchaseType, Index);
    if (TypeField && TypeField.Data1 >>> 0 === ConsumablePurchaseType) {
        const Native = NativeCatalogPrice(Item, Context);
        if (Native !== null) return Native;
        const Expected = U64(GetField(Fields, ExpectedPriceField(Index)));
        if (Expected !== null && Expected > 0n) return Expected;
    }
    const SubmittedCrc = CartPriceFields[Index];
    const Submitted = SubmittedCrc === undefined ? null : U64(GetField(Fields, SubmittedCrc));
    if (Submitted !== null) return Submitted;
    const Catalog = Context.VcPrices;
    if (Catalog instanceof Map && Catalog.has(Item)) {
        const Entry = Catalog.get(Item);
        return AsBigInt(Entry && typeof Entry === 'object' ? (Entry.price ?? Entry.finalPrice) : Entry, 100n);
    }
    return AsBigInt(Context.DefaultPurchasePrice, 100n);
}

function PricesFor(Items, Fields, Context = {}) {
    return Items.map((Item, Index) => PriceFor(Item, Index, Fields, Context));
}

function CatalogPriceFor(Item, Context = {}) {
    const Native = NativeCatalogPrice(Item, Context);
    if (Native !== null) return Native;
    const Catalog = Context.VcPrices;
    if (Catalog instanceof Map && Catalog.has(Item >>> 0)) {
        const Entry = Catalog.get(Item >>> 0);
        return AsBigInt(Entry && typeof Entry === 'object' ? (Entry.price ?? Entry.finalPrice) : Entry, 100n);
    }
    return AsBigInt(Context.DefaultPurchasePrice, 100n);
}

function AppendMissingU32(Records, Fields, Crc, Values) {
    const Present = GetFields(Fields, Crc).length;
    for (let Index = Present; Index < Values.length; Index++) {
        Records.push({ Crc, Type: Types.StringCrc, Data1: Number(Values[Index]) >>> 0, Data2: 0 });
    }
}

function AppendMissingU64(Records, Fields, Crc, Values) {
    const Present = GetFields(Fields, Crc).length;
    for (let Index = Present; Index < Values.length; Index++) {
        const Value = BigInt.asUintN(64, BigInt(Values[Index]));
        Records.push({
            Crc,
            Type: Types.U64,
            Data1: Number(Value >> 32n) >>> 0,
            Data2: Number(Value & 0xffffffffn) >>> 0,
        });
    }
}

function RequestLevel(Fields, Crc, Index) {
    if (Crc === RequestToLevel) {
        const SlotCrc = CartToLevelFields[Index];
        return SlotCrc === undefined ? null : U64(GetField(Fields, SlotCrc));
    }
    if (Crc === FromLevel) {
        const SlotCrc = CartFromLevelFields[Index];
        return SlotCrc === undefined ? null : U64(GetField(Fields, SlotCrc));
    }
    return U64(GetField(Fields, Crc, Index));
}

function AttributeForItem(Item, Context) {
    const Catalog = Context.AttributePurchaseByItem;
    const Entry = Catalog instanceof Map ? Catalog.get(Item >>> 0) : null;
    if (Entry && Entry.AttributeId !== undefined) return Number(Entry.AttributeId) >>> 0;
    return AttributeIds.includes(Item >>> 0) ? Item >>> 0 : null;
}

function ApplyKnownAttribute(Item, Index, Fields, Context, Price, Attributes) {
    if (Context.userId === null || Context.userId === undefined || !(Context.Careers instanceof Map)) {
        return { Ok: true, Changed: false };
    }
    const AttributeId = AttributeForItem(Item, Context);
    if (AttributeId === null) return { Ok: true, Changed: false };
    const From = RequestLevel(Fields, FromLevel, Index);
    const Target = RequestLevel(Fields, RequestToLevel, Index);
    const Attribute = Attributes.find((Candidate) => Candidate.id === Number(AttributeId) >>> 0);
    if (!Attribute) return { Ok: false, Reason: 'unknown attribute' };

    if (From !== null && Attribute.level === 0n && From > 0n) Attribute.level = From;
    if (From !== null && From !== Attribute.level) {
        return { Ok: false, Reason: `FROM_LEVEL mismatch (${From} != ${Attribute.level})` };
    }
    const Next = Target === null ? Attribute.level + 1n : Target;
    const MaxLevel =
        Attribute.maxLevel !== undefined
            ? Attribute.maxLevel
            : Attribute.cap >= Attribute.initial
              ? Attribute.cap - Attribute.initial < 25n
                  ? Attribute.cap - Attribute.initial
                  : 25n
              : 0n;
    if (Next < Attribute.level || Next > 25n || Next > MaxLevel) {
        return { Ok: false, Reason: `attribute cap reached (${Next} > ${MaxLevel})` };
    }
    const Previous = Attribute.level;
    Attribute.level = Next;
    return { Ok: true, Changed: Next !== Previous, AttributeId: Attribute.id, FromLevel: Previous, ToLevel: Next };
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Items = GetFields(Fields, ItemCrc).map((Field) => Field.Data1 >>> 0);
    if (!Items.length) return new Builder().AddU32(Result, Success).Build();

    const Prices = PricesFor(Items, Fields, Context);
    const Total = Prices.reduce((Sum, Price) => Sum + Price, 0n);
    const Current = BalanceFor(Context);
    const StaticBalance = IsStaticBalance(Context);
    if (Total > Current) return new Builder().AddU32(Result, InsufficientFunds).Build();

    const Attributes = AttributesFor(Context);
    const OriginalLevels = Attributes.map((Attribute) => Attribute.level);
    const Changes = [];
    for (let Index = 0; Index < Items.length; Index++) {
        const Outcome = ApplyKnownAttribute(Items[Index], Index, Fields, Context, Prices[Index], Attributes);
        if (!Outcome.Ok) {
            Attributes.forEach((Attribute, AttributeIndex) => {
                Attribute.level = OriginalLevels[AttributeIndex];
            });
            return new Builder().AddU32(Result, InsufficientFunds).Build();
        }
        if (Outcome.Changed) Changes.push(Outcome);
    }

    const NextBalance = Current - Total;
    if (Context.Wallets instanceof Map) {
        const Key = Context.userId === null || Context.userId === undefined ? 'anonymous' : String(Context.userId);
        Context.Wallets.set(Key, StaticBalance ? StartingBalance : NextBalance);
    }
    if (Context.OwnedItems instanceof Map) {
        const Key = OwnedKey(Context);
        if (Key) {
            for (let Index = 0; Index < Items.length; Index++) {
                if (AttributeForItem(Items[Index], Context) !== null) continue;
                const TypeField = GetField(Fields, PurchaseType, Index);
                RememberOwnedItem(Context.OwnedItems, Key, {
                    item: Items[Index] >>> 0,
                    purchaseType: TypeField ? TypeField.Data1 >>> 0 : null,
                    price: Prices[Index],
                });
            }
            if (typeof Context.SaveOwnedItems === 'function') Context.SaveOwnedItems();
        }
    }
    if (Changes.length && Context.Careers instanceof Map) {
        const Key = CareerKey(Context);
        if (Key) Context.Careers.set(Key, Attributes);
        if (Key && typeof Context.SaveCareers === 'function') Context.SaveCareers();
        if (Context.Purchases instanceof Map) {
            for (const Change of Changes) {
                Context.Purchases.set(`${Change.AttributeId}:${Date.now()}`, Change);
            }
        }
    }
    if (Context.Purchases instanceof Map) {
        for (let Index = 0; Index < Items.length; Index++) {
            Context.Purchases.set(`${Items[Index] >>> 0}:${Date.now()}:${Index}`, {
                item: Items[Index],
                price: Prices[Index],
            });
        }
    }
    const TouchesAttributes = Items.some((Item) => AttributeForItem(Item, Context) !== null);
    if (!TouchesAttributes) {
        const Echo = Fields.map((Field) => ({
            Crc: Field.Crc >>> 0,
            Type: Field.Type >>> 0,
            Data1: Field.Data1 >>> 0,
            Data2: Field.Data2 >>> 0,
        }));
        AppendMissingU32(Echo, Fields, TransactionFields.Mode, [TransactionModes.Purchasable]);
        AppendMissingU32(Echo, Fields, TransactionFields.Item, Items);
        AppendMissingU64(Echo, Fields, TransactionFields.Price, Prices);
        const RequestCareerKey = U64(GetField(Fields, TransactionFields.CareerKey)) ?? 0n;
        AppendMissingU64(
            Echo,
            Fields,
            TransactionFields.CareerKey,
            Items.map(() => RequestCareerKey),
        );
        AppendMissingU64(
            Echo,
            Fields,
            TransactionFields.Quantity,
            Items.map(() => 1n),
        );
        AppendMissingU64(Echo, Fields, BalanceCrc, [BalanceFor(Context)]);
        Echo.push({ Crc: Result, Type: Types.StringCrc, Data1: Success >>> 0, Data2: 0 });
        Echo.sort((A, B) => A.Crc - B.Crc);
        const Reply = new Builder();
        for (const Record of Echo) Reply.Record(Record.Crc, Record.Type, Record.Data1, Record.Data2);
        return Reply.Build();
    }
    return new Builder().AddU32(Result, Success).Build();
}

function BuildConsumable(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const ItemField = GetField(Fields, TransactionFields.Item);
    if (!ItemField) return new Builder().AddU32(Result, InsufficientFunds).Build();

    const Item = ItemField.Data1 >>> 0;
    const RequestedQuantity = U64(GetField(Fields, TransactionFields.Quantity));
    const Quantity = RequestedQuantity !== null && RequestedQuantity > 0n ? RequestedQuantity : 1n;
    const UnitPrice = CatalogPriceFor(Item, Context);
    const Total = UnitPrice * Quantity;
    const Current = BalanceFor(Context);
    if (Total > Current) return new Builder().AddU32(Result, InsufficientFunds).Build();

    const StaticBalance = IsStaticBalance(Context);
    const NextBalance = Current - Total;
    if (Context.Wallets instanceof Map) {
        const Key = Context.userId === null || Context.userId === undefined ? 'anonymous' : String(Context.userId);
        Context.Wallets.set(Key, StaticBalance ? StartingBalance : NextBalance);
    }
    if (Context.Purchases instanceof Map) {
        Context.Purchases.set(`consumable:${Item}:${Date.now()}`, {
            item: Item,
            Quantity,
            UnitPrice,
            total: Total,
            CareerKey: U64(GetField(Fields, TransactionFields.CareerKey)) ?? 0n,
        });
    }

    const Records = Fields.map((Field) => ({
        Crc: Field.Crc >>> 0,
        Type: Field.Type >>> 0,
        Data1: Field.Data1 >>> 0,
        Data2: Field.Data2 >>> 0,
    }));
    AppendMissingU32(Records, Fields, TransactionFields.Mode, [TransactionModes.Purchasable]);
    AppendMissingU32(Records, Fields, TransactionFields.Item, [Item]);
    AppendMissingU64(Records, Fields, TransactionFields.Price, [UnitPrice]);
    AppendMissingU64(Records, Fields, TransactionFields.CareerKey, [
        U64(GetField(Fields, TransactionFields.CareerKey)) ?? 0n,
    ]);
    AppendMissingU64(Records, Fields, TransactionFields.Quantity, [Quantity]);
    AppendMissingU64(Records, Fields, BalanceCrc, [BalanceFor(Context)]);
    Records.push({ Crc: Result, Type: Types.StringCrc, Data1: Success >>> 0, Data2: 0 });
    Records.sort((Left, Right) => (Left.Crc >>> 0) - (Right.Crc >>> 0));

    const Reply = new Builder();
    for (const Record of Records) Reply.Record(Record.Crc, Record.Type, Record.Data1, Record.Data2);
    return Reply.Build();
}

module.exports = {
    Build,
    Purchase: Build,
    BuildConsumable,
    ConsumablePurchase: BuildConsumable,
    ItemCrc,
    PurchaseType,
    CloudSaveId,
    BalanceCrc,
    ConsumablePurchaseType,
    FromLevel,
    RequestToLevel,
    SubmittedPrice,
    CartToLevelFields,
    CartPriceFields,
    Status: 'IDA_EXACT_2K19_CONSUMABLE_TRANSACTION_AND_CAPTURED_ATTRIBUTE_CART_VALIDATION',
};
