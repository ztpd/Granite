// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Path = require('path');

const Log = require('../Source/Core/Log');
const Courts = require('../Source/Protocol/Courts');
const Slots = require('../Source/Protocol/Slots');
const CourtTables = require('../Source/Activity/CourtTables');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const Packets = require('../Source/Protocol/Packets');
const Roster = require('../Source/Protocol/Roster');
const { Connection, State, OnConnect } = require('../Source/Protocol/Connection');
const Position = require('../Source/Protocol/Position');
const Frame = require('../Source/Codec/Frame');
const Samples = require('./Samples');

Log.SetLevel(Log.Level.Error);

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}

const Socket = (Sink) => ({
    destroyed: false,
    write: (B) => Sink.push(B),
    end() {},
    destroy() {
        this.destroyed = true;
    },
});

function GroupsIn(World) {
    const W = CourtTables.For(World);
    return W.Courts.flatMap((C) => Courts.GroupsFor(C, W.Room, W.SeqBase));
}

Test('a court is home, away and a squad mat in the middle', () => {
    Assert.strictEqual(Courts.SendSquadObjects, true);
    const Shape = {};
    for (const World of ['neighborhood', 'stage', 'cages']) {
        const W = CourtTables.For(World);
        for (const Raw of W.Courts) {
            const G = Courts.GroupsFor(Raw, W.Room, W.SeqBase);
            const Kinds = Raw.TeamSize < 2 || Raw.NoSquad ? ['gotnext', 'gotnext'] : ['gotnext', 'gotnext', 'squad'];
            Assert.deepStrictEqual(
                G.map((X) => X.Kind),
                Kinds,
                Raw.Name,
            );
            Shape[Raw.TeamSize] = G.reduce((T, X) => T + X.Anchors.length, 0);
        }
    }
    Assert.strictEqual(Shape[3], 7, '3 home, 3 away, 1 squad');
    Assert.strictEqual(Shape[2], 5);
    Assert.strictEqual(Shape[1], 2, 'no squad mat on a 1v1');
});

Test('the presence bitmap is 147 bits', () => {
    Assert.strictEqual(Courts.Flags, 147, 'two bits out and the client answers ERROR deserializing');
    Assert.strictEqual(ObjectFrame.FlagBytes(Courts.Flags), 19);
});

Test('the court mode is the full requirement and is never three', () => {
    for (const Size of [1, 2, 3]) {
        Assert.strictEqual(Courts.CourtMode(Size), Size * 2);
        Assert.notStrictEqual(
            Courts.CourtMode(Size),
            3,
            'three flags a game in progress and paints a scoreboard over the caption',
        );
    }
});

Test('park got-next is activity-routed, stage and cages stay 0x08', () => {
    Assert.strictEqual(Courts.RegionType.GotNext, 0x08);
    Assert.strictEqual(Courts.RegionType.ParkGotNext, 0x9705bb0d);
    for (const Activity of [0x0d, 0x13, 0x14, 0x18]) {
        Assert.notStrictEqual(
            Courts.RegionType.GotNext,
            Activity,
            Activity + ' is a workout or minigame, not got-next',
        );
    }
    for (const G of GroupsIn('neighborhood')) {
        if (G.Kind === 'gotnext') Assert.strictEqual(G.RegionType, 0x9705bb0d, G.Name);
        else Assert.strictEqual(G.RegionType, 0x6291f559, G.Name);
    }
    for (const World of ['stage', 'cages']) {
        for (const G of GroupsIn(World)) {
            if (G.Kind === 'gotnext') Assert.strictEqual(G.RegionType, 0x08, G.Name);
        }
    }
});

Test('the known-bad region types are never sent', () => {
    const Sent = new Set([...GroupsIn('stage'), ...GroupsIn('cages')].map((G) => G.RegionType));
    Assert.ok(!Sent.has(Courts.RegionType.Generic), '0x0D draws a dot, not a spot');
    Assert.ok(!Sent.has(Courts.RegionType.BeatsMachine), '0x14 makes the spots disappear');
    Assert.ok(!Sent.has(Courts.RegionType.Airball), 'decimal 24 and 0x24 are different values');
});

Test('the status window governs spot counts, not the prompt label', () => {
    Assert.deepStrictEqual(Courts.RegionType.StatusWindow, [15, 30]);
    Assert.ok(
        !Courts.ReadsSpotCounts(Courts.RegionType.GotNext),
        'got-next is outside it, so the NEED n caption will not render — a separate problem',
    );
    Assert.ok(
        Courts.ReadsSpotCounts(Courts.RegionType.MiniBasketball),
        'and the band is activities, which is what 24 turned out to be',
    );
});

Test('only a squad object sets +0x38 in the occupancy record', () => {
    const Occupancy = Courts.Field.Occupancy;
    for (const World of ['neighborhood', 'stage', 'cages']) {
        for (const G of GroupsIn(World)) {
            const Body = Courts.Build(G).slice(ObjectFrame.Layout.TwentyOne.Payload);
            const Flags = ObjectFrame.ReadFlags(Body, 16, Courts.Flags);
            if (G.Kind === 'squad') {
                Assert.ok(Flags.includes(Occupancy), G.Name + ' must carry it');
                Assert.strictEqual(
                    Courts.Occupancy(Courts.Eligibility.Joinable).readUInt32LE(0x38),
                    1,
                    'the squad marker',
                );
            } else {
                const Records = Flags.filter((F) => F >= Occupancy && F < Courts.Field.Setup);
                Assert.strictEqual(
                    Records.length,
                    Math.min(G.Anchors.length, Courts.MaxSpots),
                    G.Name + ' describes each of its spots exactly once',
                );
            }
        }
    }

    for (const Holder of [null, 0x0110000100000666n]) {
        const Record = Courts.Held(Holder);
        Assert.strictEqual(Record.length, 72);
        Assert.strictEqual(
            Record.readUInt32LE(0x38),
            0,
            'setting this is what made every park spot read "squads only"',
        );
    }
});

Test('a freed spot sends an EMPTY record rather than dropping the flag', () => {
    const W = CourtTables.For('neighborhood');
    const G = Courts.GroupsFor(W.Courts[0], W.Room, W.SeqBase)[0];
    const Spots = G.Anchors.length;

    for (const Seats of [[], new Array(Spots).fill(0n)]) {
        const Body = Courts.Build(G, 1n, Seats).slice(ObjectFrame.Layout.TwentyOne.Payload);
        const Flags = ObjectFrame.ReadFlags(Body, 16, Courts.Flags);
        for (let I = 0; I < Spots; I++) {
            Assert.ok(Flags.includes(Courts.Field.Occupancy + I), `spot ${I} must still be described when it is free`);
        }
    }
});

Test('record+16 is left alone — it is a direction, not a position', () => {
    const Base = [-1907, 0, -2570];
    const Record = Courts.Setup(
        [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ],
        Base,
    );

    Assert.strictEqual(Record.readFloatLE(0), Base[0], 'the position still goes at +0');
    Assert.strictEqual(Record.readFloatLE(4), Base[1]);
    Assert.strictEqual(Record.readFloatLE(8), Base[2]);

    for (let At = 16; At < 32; At += 4) {
        Assert.strictEqual(Record.readFloatLE(At), 0, 'record+' + At + ' must stay zero or the squad decals rotate');
    }
});

Test('the setup record carries the spot type, not a facing correction', () => {
    Assert.strictEqual(Courts.SpotType.GotNext, 0);
    Assert.strictEqual(Courts.SpotType.Squad, 1);

    const W = CourtTables.For('neighborhood');
    const Groups = Courts.GroupsFor(W.Courts[0], W.Room, W.SeqBase);
    const SetupAt = (G) => 16 + 19 + 4 + 64 + 4 + 4 + 4 + (G.Kind === 'squad' ? 72 : 0) + 1;
    for (const G of Groups) {
        const Body = Courts.Build(G).slice(ObjectFrame.Layout.TwentyOne.Payload);
        const Expected = G.Kind === 'squad' ? Courts.SpotType.Squad : Courts.SpotType.GotNext;
        Assert.strictEqual(Body.readUInt8(SetupAt(G) + 132), Expected, G.Name);
    }
});

Test('the spot geometry is the known-good calibration, not the earlier hand tuning', () => {
    const Threes = Courts.SpotOptions('3s', [-1000, 0, 0]);
    Assert.strictEqual(Threes.Spots, 3);
    Assert.strictEqual(Threes.Dx, 850, 'NEAR_WIDTH, toward the walkway');
    Assert.strictEqual(Threes.SideOffset, 850, 'CORNER_LEN');
    Assert.strictEqual(Threes.PairSpacing, 130, 'ROW_SPACING');
    Assert.strictEqual(Courts.SpotOptions('3s', [1000, 0, 0]).Dx, -850, 'the sign follows the row');

    const Twos = Courts.SpotOptions('2s', [-1000, 0, 0]);
    Assert.strictEqual(Twos.Dx, -700);
    Assert.strictEqual(Twos.SideOffset, -520, 'signed: unsigned mirrored one whole row');
    Assert.strictEqual(Twos.PairSpacing, -120);
});

Test('the detection box is small, and narrower along the row', () => {
    const H3 = Courts.SpotBoxHalves(Courts.SpotOptions('3s', [-1000, 0, 0]));
    Assert.strictEqual(H3.Hx, 140);
    Assert.strictEqual(H3.Hz, 75, '130 / 2 + 10');

    const H2 = Courts.SpotBoxHalves(Courts.SpotOptions('2s', [-1000, 0, 0]));
    Assert.strictEqual(H2.Hx, 70, '120 / 2 + 10');
    Assert.strictEqual(H2.Hz, 140);
});

Test('park groups carry the retail anchors verbatim', () => {
    const Boulevard = require('../Source/Activity/StageSpots/BoulevardCourts2K19');
    const W = CourtTables.For('neighborhood');
    Assert.strictEqual(W.Courts.length, Boulevard.BoulevardCourts.length);
    for (const Raw of W.Courts) {
        const Entry = Boulevard.BoulevardCourts.find((E) => E.name === Raw.Name);
        Assert.ok(Entry, Raw.Name + ' is a retail Boulevard court');
        const Groups = Courts.GroupsFor(Raw, W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext');
        Assert.strictEqual(Groups.length, 2, Raw.Name + ' has one group per basket end');
        for (const Winding of [0, 1]) {
            const Want = Boulevard.SpotAnchorsFor(Entry, Winding).map((A) => A.map(Math.round));
            const Got = Groups[Winding].Anchors.map((A) => A.map(Math.round));
            Assert.deepStrictEqual(Got, Want, Raw.Name + ' winding ' + Winding);
            Assert.strictEqual(Got.length, Entry.TeamSize, Raw.Name + ' carries a dot per team slot');
        }
    }
});

Test('the frame is an OBJECT_DATA carrying the court class, and it closes', () => {
    const FrameData = Courts.Build(GroupsIn('stage')[0]);
    const L = ObjectFrame.Layout.TwentyOne;
    Assert.strictEqual(FrameData.readUInt32LE(0), FrameData.length, 'declared length closes');
    Assert.strictEqual(FrameData.readUInt32BE(4) >>> 0, Packets.Wire('OBJECT_DATA'));
    Assert.strictEqual(FrameData.readUInt32BE(L.Class) >>> 0, Courts.CourtClass);
    Assert.strictEqual(L.Payload + FrameData.readUInt32BE(L.Length), FrameData.length);
});

Test('a measured court id drives both the region id and the court id', () => {
    const RegionIdAt = 16 + 19;
    const CourtIdAt = 16 + 19 + 4 + 64;
    const W = CourtTables.For('stage');
    const Raw = W.Courts[1];

    const Fallback = Courts.GroupsFor(Raw, W.Room, W.SeqBase)[0];
    const Low = CourtTables.StageLowFor(Raw.Name);
    Assert.strictEqual(Fallback.CourtId >>> 0, Low >>> 0, 'stage CourtId is the plain low id');
    const A = Courts.Build(Fallback).slice(ObjectFrame.Layout.TwentyOne.Payload);
    Assert.strictEqual(A.readUInt32LE(RegionIdAt) >>> 0, Low >>> 0);

    const Measured = Courts.GroupsFor({ ...Raw, CourtId: 0xab684ae2 }, W.Room, W.SeqBase)[0];
    const B = Courts.Build(Measured).slice(ObjectFrame.Layout.TwentyOne.Payload);
    Assert.strictEqual(B.readUInt32LE(RegionIdAt) >>> 0, 0xab684ae2);
    Assert.strictEqual(B.readUInt32LE(CourtIdAt) >>> 0, 0xab684ae2);
});

Test('every world has courts, and every one is a size we can lay out', () => {
    const Expected = { neighborhood: 8, stage: 8, cages: 6 };
    for (const [World, Count] of Object.entries(Expected)) {
        const W = CourtTables.For(World);
        Assert.strictEqual(W.Courts.length, Count, World);
        for (const C of W.Courts) {
            Assert.ok(Courts.SpotOptions(Courts.ModeFor(C.TeamSize), C.Pos), C.Name + ' has a spot layout');
            Assert.ok(Number.isFinite(C.Yaw), C.Name + ' has a facing');
            Assert.ok(Number.isFinite(C.SpotYaw), C.Name + ' has a spot rotation');
        }
    }
    Assert.strictEqual(CourtTables.For('mycourt'), null);
});

Test('the stage sends marker coordinates unchanged', () => {
    const W = CourtTables.For('stage');
    Assert.deepStrictEqual(W.Offset, [0, 0, 0]);
    for (const C of W.Courts) Assert.deepStrictEqual(C.Pos, C.MarkerPos);
});

Test('the cages offset puts a court where a player was actually standing', () => {
    const W = CourtTables.For('cages');
    const Near = W.Courts.filter((C) => Math.abs(C.Pos[2] - 9168) < 50);
    Assert.ok(Near.length > 0, 'two players logged world Z 9168 in cages');
});

Test('object ids are unique, and the worlds do not collide', () => {
    const All = [];
    for (const World of ['neighborhood', 'stage', 'cages']) {
        const Ids = GroupsIn(World).map((G) => String(G.ObjectId));
        Assert.strictEqual(new Set(Ids).size, Ids.length, World + ' has a collision');
        All.push(...Ids);
    }
    Assert.strictEqual(new Set(All).size, All.length, 'two worlds share an object id');
});

Test('the slot table is sent, with only the flag indices that are known', () => {
    Assert.strictEqual(Courts.Field.SlotCount, 99, 'court+1661, the loop bound');
    Assert.strictEqual(Courts.Field.SlotType, 100, 'court+1671 + k');
    Assert.strictEqual(Courts.Field.SlotIdA, 108, 'court+1688 + 8k');
    Assert.strictEqual(
        Courts.SlotType,
        0xff,
        'the only byte that skips the descriptor lookup instead of indexing it out of bounds',
    );

    for (const G of GroupsIn('stage')) {
        Assert.ok(G.SlotIds.length > 0, G.Name + ' carries slots');
        Assert.ok(G.SlotIds.length <= Courts.MaxSlots, 'the table holds at most eight');
    }
});

Test('the slot table is emitted, so the spot actors exist', () => {
    Assert.strictEqual(Courts.SendSlotTable, true);

    for (const World of ['neighborhood', 'stage', 'cages']) {
        for (const Group of GroupsIn(World)) {
            const FrameData = Courts.Build(Group);
            const L = ObjectFrame.Layout.TwentyOne;
            const Body = FrameData.slice(L.Payload, L.Payload + FrameData.readUInt32BE(L.Length));
            const SetValue = ObjectFrame.ReadFlags(Body, ObjectFrame.Body.Flags, Courts.Flags);

            Assert.ok(
                SetValue.includes(Courts.Field.SlotCount),
                `${Group.Name} must send court+1661 or the spawn loop never runs`,
            );
            Assert.ok(SetValue.includes(Courts.Field.SlotIdA), `${Group.Name} must name its queue`);
            Assert.ok(SetValue.includes(Courts.Field.Setup), `${Group.Name} lost its spot geometry`);
        }
    }
});

Test('the slot table names the queue, and each sideline has its own', () => {
    const W = CourtTables.For('stage');
    const Threes = W.Courts.find((C) => C.TeamSize === 3);
    const [A, B] = Courts.GroupsFor(Threes, W.Room, W.SeqBase);

    Assert.deepStrictEqual(A.SlotIds, [A.SlotObjectId], 'one entry, and it is the queue');
    Assert.deepStrictEqual(B.SlotIds, [B.SlotObjectId]);
    Assert.notStrictEqual(
        A.SlotObjectId,
        B.SlotObjectId,
        'the two sidelines are separate queues, so they cannot share one slot set',
    );
});

Test('slot ids are distinct across courts and clear of the court object ids', () => {
    const Groups = [...GroupsIn('neighborhood'), ...GroupsIn('stage'), ...GroupsIn('cages')];
    const PerCourt = new Map();
    for (const G of Groups) {
        const Key = G.CourtName + '|' + G.Kind;
        if (!PerCourt.has(Key)) PerCourt.set(Key, G.SlotIds);
    }
    const All = [...PerCourt.values()].flat().map(String);
    Assert.strictEqual(new Set(All).size, All.length, 'two courts share a slot id');

    const CourtIds = new Set(Groups.map((G) => String(G.ObjectId)));
    Assert.strictEqual(
        All.filter((Id) => CourtIds.has(Id)).length,
        0,
        'a slot id must never collide with a court object id',
    );
});

function Active(ActivityName) {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.ActivityName = ActivityName;
    C.State = State.Active;
    return { C, Sent };
}

Test('a world with courts gets every object, once', () => {
    const { C, Sent } = Active('cages');
    const Expected = GroupsIn('cages').length;
    Assert.strictEqual(Courts.Publish(C), Expected);
    Assert.strictEqual(Sent.length, Expected * 2, 'a court and a queue for each group');

    Assert.strictEqual(Courts.Publish(C), 0, 'a second call sends nothing');
    Assert.strictEqual(Sent.length, Expected * 2);
});

Test('every court is accompanied by a queue carrying its name', () => {
    const Groups = GroupsIn('neighborhood');
    for (const Group of Groups) {
        const Slot = Slots.Build(Group, 1n);
        const Name = Buffer.alloc(4);
        Name.writeUInt32LE(Courts.IdentityOf(Group) >>> 0, 0);
        Assert.ok(Slot.includes(Name), `${Group.Name}'s queue does not carry its court id`);

        const Cls = Buffer.alloc(4);
        Cls.writeUInt32BE(Slots.SlotClass, 0);
        Assert.ok(Slot.includes(Cls), 'and it is a SLOT object');
    }
    Assert.strictEqual(
        new Set(Groups.map((G) => G.SlotObjectId)).size,
        Groups.length,
        'each group owns a distinct queue, or two courts share one line',
    );
});

Test('the park and the stage each get their own objects', () => {
    for (const World of ['neighborhood', 'stage']) {
        const { C, Sent } = Active(World);
        const CourtList = CourtTables.For(World).Courts.length;
        Assert.strictEqual(Courts.Publish(C), CourtList, World);
        Assert.strictEqual(Sent.length, CourtList, World + ' sends one frame per court, no queues');
        Assert.strictEqual(Courts.Publish(C), 0, World + ' publishes once');
    }
});

Test('a world with no courts is left alone', () => {
    const { C, Sent } = Active('mycourt');
    Assert.strictEqual(Courts.Publish(C), 0);
    Assert.strictEqual(Sent.length, 0);
    Assert.strictEqual(C.CourtsPublished, false);
});

Test('courts are refused before the connection is active', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.ActivityName = 'cages';
    C.State = State.Pending;
    Assert.strictEqual(Courts.Publish(C), 0, 'SendObject refuses while the client node is not state 2');
    Assert.strictEqual(Sent.length, 0);
});

Test('the park spots are the retail Boulevard geometry, to the unit', () => {
    const Boulevard = require('../Source/Activity/StageSpots/BoulevardCourts2K19');
    const W = CourtTables.For('neighborhood');
    Assert.strictEqual(W.Courts.length, Boulevard.BoulevardCourts.length);

    for (const Court of W.Courts) {
        const Entry = Boulevard.BoulevardCourts.find((E) => E.name === Court.Name);
        Assert.ok(Entry, Court.Name + ' is a retail Boulevard court');
        const Sides = Courts.GroupsFor(Court, W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext');
        Assert.strictEqual(Sides.length, 2, Court.Name + ' has one group per basket end');
        for (const Winding of [0, 1]) {
            const Want = Boulevard.SpotAnchorsFor(Entry, Winding).map((A) => A.map(Math.round));
            const Got = Sides[Winding].Anchors.map((X) => X.map(Math.round));
            Assert.deepStrictEqual(Got, Want, Court.Name + ' winding ' + Winding);
        }
    }
});

Test('the squad mats are on the sideline, and one court has none', () => {
    const Boulevard = require('../Source/Activity/StageSpots/BoulevardCourts2K19');
    const W = CourtTables.For('neighborhood');
    let Mats = 0;
    for (const Court of W.Courts) {
        const Entry = Boulevard.BoulevardCourts.find((E) => E.name === Court.Name);
        const Squad = Courts.GroupsFor(Court, W.Room, W.SeqBase).filter((G) => G.Kind === 'squad');
        if (!Boulevard.BoulevardCourtHasSquad(Entry)) {
            Assert.strictEqual(Squad.length, 0, Court.Name + ' should have no squad mat');
            continue;
        }
        Assert.strictEqual(Squad.length, 1, Court.Name);
        const Want = Boulevard.SquadAnchorFor(Entry).map(Math.round);
        Assert.deepStrictEqual(Squad[0].Anchors[0].map(Math.round), Want, Court.Name);
        Mats++;
    }
    Assert.strictEqual(Mats, W.Courts.length - 1, 'every court but SHORT_TOP carries a squad mat');
});

Test('only the park rotates its spots; the stage keeps its measured behaviour', () => {
    for (const World of ['stage', 'cages']) {
        for (const C of CourtTables.For(World).Courts) {
            Assert.strictEqual(C.SpotYaw, 0, `${C.Name} must not rotate its spots`);
        }
    }
    const Yawed = CourtTables.For('stage').Courts.filter((C) => C.Yaw !== 0);
    Assert.ok(Yawed.length, 'the stage does still carry marker yaws for the transform');
});

Test('the park calibration does not leak into the other worlds', () => {
    const Base = Courts.SpotOptions('3s', [-1000, 0, 0]);
    Assert.strictEqual(Base.SideOffset, 850, 'the busy ws default is untouched');
    Assert.strictEqual(Base.PairSpacing, 130);

    for (const World of ['neighborhood', 'stage', 'cages']) {
        for (const C of CourtTables.For(World).Courts) {
            Assert.strictEqual(C.Spots, undefined, `${C.Name} carries no Spots override`);
        }
    }
    const Park = CourtTables.For('neighborhood').Courts;
    Assert.ok(
        Park.every((C) => Array.isArray(C.SpotAnchors) && C.SpotAnchors.length === 2),
        'every park court carries transferred retail anchors',
    );
});

Test('connect publishes the bitstream courts and schedules two refresh backups', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    const Connect = Samples.AsStandalone(Samples.Connect);
    OnConnect(C, Frame.Parse(Connect), Connect);

    Assert.strictEqual(C.CourtsPublished, true, 'park courts published on connect');
    const CourtList = Sent.filter((B) => B.length > 32 && B.readUInt32BE(28) >>> 0 === 0x2c4d49e3);
    Assert.strictEqual(CourtList.length, 8, '8 Boulevard court frames on connect');
    Assert.strictEqual(C.CourtRefreshTimers.length, 2, '+4s and +20s backups scheduled');

    C.Close();
    Assert.strictEqual(C.CourtRefreshTimers.length, 0, 'close cancels the backups');
    Roster.Players.clear();
});

Test('first movement re-sends the courts exactly once', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.ActivityName = 'neighborhood';
    C.State = State.Active;

    Assert.strictEqual(Position.Note(C, Samples.Movement), true, 'first report is new');
    Assert.strictEqual(C.CourtsMoveRefreshed, true);
    Assert.strictEqual(Sent.length, 8, 'one full park refresh on first movement');

    C.Position = null;
    Position.Note(C, Samples.Movement);
    Assert.strictEqual(Sent.length, 8, 'movement refresh fires once per connection');

    const Other = [];
    const D = new Connection(Socket(Other), {}, 20054);
    D.ActivityName = 'cages';
    D.State = State.Active;
    Position.Note(D, Samples.Movement);
    Assert.strictEqual(D.CourtsMoveRefreshed || false, false);
    Assert.strictEqual(Other.length, 0);
    Roster.Players.clear();
});

process.stdout.write(`\n${Passed} passing\n`);
