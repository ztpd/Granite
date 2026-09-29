// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const Logger = require('../../../Core/Logger');
const { Name, Level, CurrentCap, AttributesFor, CareerKey } = require('./Constants');
const GrindPoints = require('../GrindPoints/State');

const FeatureUnlock = 0xae72731a;
const JumpshotCreator = 0xf1a265a3;
const JumpshotCreatorMinOvr = 75;
const ShirtOff = 0x6e884a7f;
const ShirtOffMinOvr = 91;
const CareerStartOvr = 60;
const ObservedCapOvr = 98;

function EstimateOverallForUnlocks(Attributes) {
    let Purchased = 0;
    let Available = 0;
    for (const Item of Attributes || []) {
        const Maximum = Math.max(0, Math.min(25, Number(Item.maxLevel ?? 0n)));
        const Current = Math.max(0, Math.min(Maximum, Number(Item.level ?? 0n)));
        Purchased += Current;
        Available += Maximum;
    }
    if (!Available) return CareerStartOvr;
    const Progress = Math.max(0, Math.min(1, Purchased / Available));
    return Math.floor(CareerStartOvr + Progress * (ObservedCapOvr - CareerStartOvr));
}

function ReportedOverallFor(Context = {}) {
    const Key = CareerKey(Context);
    const Overall = Key && Context.CareerOveralls instanceof Map ? Context.CareerOveralls.get(Key) : undefined;
    return Number.isInteger(Overall) ? Overall : null;
}

function AppendAttributeRows(Reply, Context = {}) {
    const Attributes = AttributesFor(Context);
    for (const Item of Attributes) {
        Reply.AddU32(Name, Item.id).AddU64(Level, Item.level).AddU64(CurrentCap, Item.maxLevel);
    }
    return Attributes;
}

function Build(Input, Context = {}) {
    const Reply = new Builder();
    const Attributes = AppendAttributeRows(Reply, Context);

    const UnlockOverall = EstimateOverallForUnlocks(Attributes);
    if (UnlockOverall >= JumpshotCreatorMinOvr) {
        Reply.AddU32(FeatureUnlock, JumpshotCreator);
        Logger.Verbose(`career unlock estimate ${UnlockOverall} OVR: JUMPSHOT_CREATOR supplied`);
    }

    const ReportedOverall = ReportedOverallFor(Context);
    if (ReportedOverall !== null && ReportedOverall >= ShirtOffMinOvr) {
        Reply.AddU32(FeatureUnlock, ShirtOff);
        Logger.Verbose(`career reported ${ReportedOverall} OVR: SHIRT_OFF supplied`);
    }

    const Grind = GrindPoints.StateFor(Context);
    if (Grind) {
        Reply.AddU64(GrindPoints.Fields.GrindPoints, BigInt(Grind.total)).AddU64(
            GrindPoints.Fields.Counter,
            BigInt(Grind.counter),
        );
    }
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = {
    Build,
    Get: Build,
    EstimateOverallForUnlocks,
    AppendAttributeRows,
    FeatureUnlock,
    JumpshotCreator,
    JumpshotCreatorMinOvr,
    ShirtOff,
    ShirtOffMinOvr,
    ReportedOverallFor,
    Status: 'CONFIRMED_2K19_ATTRIBUTES_AND_UNLOCKABLE_FEATURE_ARRAYS',
};
