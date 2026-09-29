// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const { Parse, GetU64, GetU32, Crc32 } = require('../Source/Codec/FieldList');
const AddGrindPoints = require('../Source/Services/MyCareer/GrindPoints/AddGrindPoints');
const State = require('../Source/Services/MyCareer/GrindPoints/State');
const Get = require('../Source/Services/MyCareer/Attributes/Get');
const Constants = require('../Source/Services/MyCareer/Attributes/Constants');

const Captures = ['000634', '000734', '000805', '000955', '001037'].map((Name) =>
    Fs.readFileSync(Path.join(__dirname, 'Fixtures', 'GrindPoints', `${Name}.bin`)),
);

function Context(Grind, Saves = []) {
    return { userId: 76561198673346977n, Careers: new Map(), CareerGrind: Grind, SaveCareerGrind: () => Saves.push(1) };
}

function Reply(Body, Ctx) {
    const Built = AddGrindPoints.Build({ Body, Parsed: Parse(Body) }, Ctx);
    return Parse(Built.Body, { FieldListSize: Built.FieldListSize }).Fields;
}

Test('the captured requests carry the fields the job builder writes', () => {
    const Fields = Parse(Captures[4]).Fields;
    Assert.equal(GetU64(Fields, State.Fields.GrindPoints), 2170n);
    Assert.equal(GetU64(Fields, State.Fields.ClientTotal), 2170n);
    Assert.equal(GetU32(Fields, State.Fields.Category), Crc32('PARK_2V2'));
    Assert.equal(State.NumberOf(Fields, State.Fields.CounterIncrement), 1);
});

Test('each reply carries the running grind total, the clamped counter, and all sixteen attribute rows', () => {
    const Grind = new Map();
    const Saves = [];
    const Totals = [];
    const Counters = [];
    for (const Body of Captures) {
        const Fields = Reply(Body, Context(Grind, Saves));
        Assert.equal(GetU32(Fields, Crc32('RESULT')), Crc32('SUCCESS'));
        Assert.equal(Fields.filter((F) => F.Crc === Constants.Name).length, 16, 'attribute rows present');
        Assert.equal(Fields.filter((F) => F.Crc === Constants.Level).length, 16);
        Assert.equal(Fields.filter((F) => F.Crc === Constants.CurrentCap).length, 16);
        Totals.push(GetU64(Fields, State.Fields.GrindPoints));
        Counters.push(GetU64(Fields, State.Fields.Counter));
    }
    Assert.deepEqual(Totals, [1495n, 3785n, 3825n, 4595n, 6765n], 'the server total accumulates each game');
    Assert.deepEqual(Counters, [1n, 2n, 3n, 4n, 4n], 'the counter follows sub_140EB4950 and stops at 4');
    Assert.equal(Saves.length, 5, 'the state is saved after every request');
});

Test('Attributes/get repeats the stored grind state once the server holds it', () => {
    const Grind = new Map();
    const Ctx = Context(Grind);
    const Before = Get.Build({ Parsed: { Fields: [] } }, Ctx);
    Assert.equal(
        GetU64(Parse(Before.Body, { FieldListSize: Before.FieldListSize }).Fields, State.Fields.GrindPoints),
        null,
        'nothing is sent before the server has a value (sub_140317030 checks presence)',
    );
    Reply(Captures[0], Ctx);
    const After = Get.Build({ Parsed: { Fields: [] } }, Ctx);
    const Fields = Parse(After.Body, { FieldListSize: After.FieldListSize }).Fields;
    Assert.equal(GetU64(Fields, State.Fields.GrindPoints), 1495n);
    Assert.equal(GetU64(Fields, State.Fields.Counter), 1n);
});

Test('grind state survives a save and reload', () => {
    const Os = require('node:os');
    const { LoadCareerGrind, SaveCareerGrind } = require('../Source/Storage/CareerGrind');
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-grind-'));
    try {
        const File = Path.join(Root, 'grind-points.json');
        const Grind = new Map();
        Reply(Captures[0], Context(Grind));
        SaveCareerGrind(File, Grind);
        Assert.deepEqual([...LoadCareerGrind(File).entries()], [['76561198673346977:0', { total: 1495, counter: 1 }]]);
    } finally {
        Fs.rmSync(Root, { recursive: true, force: true });
    }
});
