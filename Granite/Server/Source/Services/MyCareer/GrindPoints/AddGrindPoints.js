// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../../Codec/FieldList');
const { Crc32 } = require('../../../Core/Crc32');
const Logger = require('../../../Core/Logger');
const { AppendAttributeRows } = require('../Attributes/Get');
const State = require('./State');

const EndpointIds = Object.freeze([0x24601bc2]);
const Result = Crc32('RESULT');
const Success = Crc32('SUCCESS');

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const Applied = State.apply(Fields, Context);
    const Reply = new Builder();
    AppendAttributeRows(Reply, Context);
    const StateData = Applied
        ? Applied.next
        : { total: Math.max(0, State.NumberOf(Fields, State.Fields.ClientTotal) ?? 0), counter: 0 };
    Reply.AddU64(State.Fields.GrindPoints, BigInt(StateData.total)).AddU64(
        State.Fields.Counter,
        BigInt(StateData.counter),
    );
    if (Applied) {
        Logger.Info(
            `grind points for ${Applied.key}: +${Applied.Added} -> ${StateData.total} ` +
                `(counter +${Applied.Increment} -> ${StateData.counter})`,
        );
        if (typeof Context.SaveCareerGrind === 'function') {
            try {
                Context.SaveCareerGrind();
            } catch (Failure) {
                Logger.Error(`could not save grind points: ${Failure.message}`);
            }
        }
    } else {
        Logger.Error('AddGrindPoints without a career key; replied with the client total and did not store it');
    }
    return Reply.AddU32(Result, Success).Build();
}

module.exports = { Build, AddGrindPoints: Build, EndpointIds, Status: 'IDA_TRACED_2K19_GRIND_POINTS_REPLY' };
