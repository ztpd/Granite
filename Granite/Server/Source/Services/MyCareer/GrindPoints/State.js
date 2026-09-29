// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { GetU64, GetField } = require('../../../Codec/FieldList');
const { CareerKey } = require('../Attributes/Constants');
const { MaxTotal, MaxCounter, Clamp } = require('../../../Storage/CareerGrind');

const Fields = Object.freeze({
    CareerSaveId: 0xd5e5f21d,
    Category: 0x81bccb52,
    GrindPoints: 0x75c9b54f,
    RawPoints: 0x8ba979e8,
    ClientTotal: 0x479bb1dc,
    CounterIncrement: 0xe52096da,
    Counter: 0xff44548c,
    Flag: 0x3a6ad728,
    Session: 0x36be118e,
    Badge: 0x3073a024,
    BadgeProgress: 0x89097176,
});

function NumberOf(FieldValues, Crc) {
    const Field = GetField(FieldValues, Crc);
    if (!Field) return null;
    const Value = GetU64(FieldValues, Crc);
    return Number(BigInt.asIntN(64, Value));
}

function StateFor(Context = {}) {
    const Key = CareerKey(Context);
    if (!Key || !(Context.CareerGrind instanceof Map)) return null;
    return Context.CareerGrind.get(Key) || null;
}

function Apply(FieldValues, Context = {}) {
    const Key = CareerKey(Context);
    if (!Key || !(Context.CareerGrind instanceof Map)) return null;
    const Previous = Context.CareerGrind.get(Key) || null;
    const Added = Math.max(0, NumberOf(FieldValues, Fields.GrindPoints) ?? 0);
    const ClientTotal = NumberOf(FieldValues, Fields.ClientTotal);
    const Increment = NumberOf(FieldValues, Fields.CounterIncrement) ?? 0;
    const Total = Previous ? Clamp(Previous.total + Added, 0, MaxTotal) : Clamp(ClientTotal ?? Added, 0, MaxTotal);
    const Counter = Clamp((Previous ? Previous.counter : 0) + Increment, 0, MaxCounter);
    const Next = { total: Total, counter: Counter };
    Context.CareerGrind.set(Key, Next);
    return { key: Key, Previous, next: Next, Added, Increment };
}

module.exports = { Fields, StateFor, apply: Apply, NumberOf };
