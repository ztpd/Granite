// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');

const Log = require('../Source/Core/Log');
const CourtData = require('../Source/Protocol/CourtData');
const Courts = require('../Source/Protocol/Courts');
const CourtTables = require('../Source/Activity/CourtTables');
const Roster = require('../Source/Protocol/Roster');
const Boulevard = require('../Source/Activity/StageSpots/BoulevardCourts2K19');
const { Connection, State } = require('../Source/Protocol/Connection');

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
    destroy() {
        this.destroyed = true;
    },
});

const FixturePayload =
    '00000000c5c723c70000000000000000e00000000000003f8000000000000004000000000080bf000000000000008000000000000000000000803f00000000000000000000000000000000000080bf00000000008022c5000000000080bb440000803fc723c7c50300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000c0dbc4000000005c0f41440000000000000000000000000000f0c20000000000c0ffff00000000000000000000000000c0c7c4000000005c0f41440000000000000000000000000000f0c20000000000c0ffff0000000000000000000000000060c3c45c0f5f440060c3c4b81ece430060e1c4b81ece430060e1c45c0f5f440300000000010000000000000000000000c0dbc400000000293c1a450000000000000000000000000000f0c20000000000c0ffff00000000000000000000000000c0c7c400000000293c1a450000000000000000000000000000f0c20000000000c0ffff0000000000000000000000000060c3c429bc21450060c3c429bc03450060e1c429bc03450060e1c429bc21450300000000000000000000000000000000c0dbc4000000000080ca440000000000000000000000000000f0c20000000000c0ffff00000000000000000000000000c0c7c4000000000080ca440000000000000000000000000000f0c20000000000c0ffff0000000000000000000000000060c3c40080d9440060c3c400809d440060e1c400809d440060e1c40080d94403000000010000000000000000000000';

const RecapBytes = 2 * (16 + 16 + 4);
const RecapMask = 0x7e;

function Entry(Name) {
    const E = Boulevard.BoulevardCourts.find((C) => C.name === Name);
    Assert.ok(E, 'retail table has ' + Name);
    return E;
}

function Unwrap(Buf) {
    for (let Off = 0; Off <= 14; Off++) {
        if (Buf.length - Off >= 4 && Buf.readUInt32LE(Off) === Buf.length - Off) {
            return Buf.slice(Off);
        }
    }
    throw new Error('no websocket payload found');
}

Test('the bitstream payload is byte-identical to the proven FreeBuff bytes', () => {
    const E = Entry('SHORT_BOTTOM_LEFT');
    const Layout = {
        CourtType: E.CourtType,
        size: E.TeamSize,
        position: E.Pos.slice(),
        Yaw: E.YawDeg,
        Locations: E.Locations.slice(),
    };
    const SetupRecords = Layout.Locations.map((_, I) => CourtData.BuildSetupRecord(Layout, I));
    const SpotRecords = Layout.Locations.map((_, I) => CourtData.BuildOccupancyRecord(Layout, I));
    const Payload = CourtData.BuildGotNextCourtDataPayload({
        CourtId: BigInt(E.id),
        OwnerId: 0n,
        CourtType: Layout.CourtType,
        CourtTransform: CourtData.CourtTransform(Layout),
        CourtObjectId: E.id >>> 0,
        Count: SetupRecords.length,
        SpotRecords,
        SetupRecords,
    });
    Assert.strictEqual(Payload.toString('hex'), FixturePayload);
});

Test('the envelope is the IDA-proven 32-byte form and closes', () => {
    const { Guid, Frame } = CourtData.BuildParkCourt(Entry('SHORT_BOTTOM_LEFT'));
    Assert.strictEqual(
        Frame.length,
        32 + 752 + 4 + RecapBytes,
        'native game-state DWORD and recap winner/loser lines added to placement',
    );
    Assert.strictEqual(Frame.readUInt32LE(0), Frame.length, 'declared length closes');
    Assert.strictEqual(Frame.readUInt32BE(4) >>> 0, 0x9c72247c);
    Assert.strictEqual(Frame.readBigUInt64BE(8), 0n, 'connection id is zero');
    Assert.strictEqual(Frame.readBigUInt64BE(16), Guid, 'plain crc32 court id at +16');
    Assert.strictEqual(Frame.readUInt32BE(24) >>> 0, CourtData.CourtClass);
    Assert.strictEqual(Frame.readUInt32BE(28), 756 + RecapBytes, 'u32 length at +28');
    const Body = Buffer.from(Frame.subarray(32));
    Assert.equal(Body[17] & 4, 4, 'native bit 13 is present');
    Assert.equal(Body[24] & RecapMask, RecapMask, 'native bits 65..70 (recap lines) are present');
    Assert.equal(Body.readUInt32LE(103), 0, 'idle game-state before got-next records');
    Body[17] &= ~4;
    Body[24] &= ~RecapMask;
    Assert.strictEqual(
        Buffer.concat([Body.subarray(0, 103), Body.subarray(107, Body.length - RecapBytes)]).toString('hex'),
        FixturePayload,
        'apart from native game-state and recap lines, placement geometry stays byte-identical',
    );
});

Test('recap winner/loser lines use the native present bytes 0x500..0x568', () => {
    const MapValue = CourtData.BuildPresentFlagMap();
    Assert.deepStrictEqual(
        [65, 66, 67, 68, 69, 70].map((Bit) => MapValue[Bit]),
        [0x500, 0x520, 0x528, 0x540, 0x560, 0x568],
    );
    Assert.deepStrictEqual(CourtData.Bit.WinnersLocation, [65, 66, 67]);
    Assert.deepStrictEqual(CourtData.Bit.LosersLocation, [68, 69, 70]);
    Assert.strictEqual(
        CourtData.PostGameLocations({ Activity: 'neighborhood', name: 'NOT_A_COURT' }),
        null,
        'an unresolvable court is published without recap lines rather than failing',
    );
});

Test('park publishes 8 bitstream courts and no queues', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.ActivityName = 'neighborhood';
    C.State = State.Active;

    Assert.strictEqual(Courts.Publish(C), 8);
    Assert.strictEqual(Sent.length, 8, 'courts only — the 2K19 queue lives in the payload');
    Assert.strictEqual(C.CourtsPublished, true);
    Assert.strictEqual(Courts.Publish(C), 0, 'a second call sends nothing');

    const Frames = Sent.map(Unwrap);
    const CourtNeedle = Buffer.alloc(4);
    CourtNeedle.writeUInt32BE(CourtData.CourtClass >>> 0, 0);
    const SlotNeedle = Buffer.alloc(4);
    SlotNeedle.writeUInt32BE(0x90acaee4, 0);
    for (const F of Frames) {
        Assert.ok(F.includes(CourtNeedle), 'a COURT object');
        Assert.ok(!F.includes(SlotNeedle), 'and no standalone SLOT object');
    }
    const Ids = Frames.map((F) => F.readBigUInt64BE(16).toString(16));
    Assert.deepStrictEqual(
        Ids,
        Boulevard.BoulevardCourts.map((E) => BigInt(E.id).toString(16)),
        'plain crc32 ids, the keys the client hands back on grab',
    );
});

Test('park refresh re-sends identical bytes, not new versions', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.ActivityName = 'neighborhood';
    C.State = State.Active;

    Assert.strictEqual(Courts.Publish(C), 8);
    const First = Sent.map(Unwrap).map((B) => B.toString('hex'));
    Assert.strictEqual(Courts.RepublishAll(C), 8);
    const Second = Sent.map(Unwrap)
        .map((B) => B.toString('hex'))
        .slice(8);
    Assert.deepStrictEqual(Second, First, 'the bitstream carries no versions; re-send applies');
    Assert.strictEqual(C.CourtVersions.size, 0, 'no version bookkeeping on this path');
});

Test('republishing an unknown park court fails, a known one sends', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.ActivityName = 'neighborhood';
    C.State = State.Active;

    Assert.strictEqual(Courts.Republish(C, 0xdeadbeefn), false);
    Assert.strictEqual(Sent.length, 0);
    Assert.strictEqual(Courts.Republish(C, 0xc5c723c7n), true);
    Assert.strictEqual(Sent.length, 1);
});

Test('setup records carry count, squad and winner bytes', () => {
    const E = Entry('SHORT_BOTTOM');
    const Layout = {
        CourtType: E.CourtType,
        size: E.TeamSize,
        position: E.Pos.slice(),
        Yaw: E.YawDeg,
        Locations: E.Locations.slice(),
    };
    Layout.Locations.forEach((_, I) => {
        const R = CourtData.BuildSetupRecord(Layout, I);
        Assert.strictEqual(R.length, 0x90);
        Assert.strictEqual(R.readUInt32LE(0x80), 3, 'trio count');
        Assert.strictEqual(R[0x84], I === 2 ? 1 : 0, 'squad byte');
        Assert.strictEqual(R[0x85], I === 0 ? 1 : 0, 'winner byte');
    });
    Layout.Locations.forEach((_, I) => {
        const R = CourtData.BuildOccupancyRecord(Layout, I);
        Assert.strictEqual(R.length, 0x48);
        Assert.strictEqual(R.readUInt32LE(0x38), I === 2 ? 1 : 0, 'squad mark only');
    });
});

const StagePayload =
    '003a190efa2696b40000000000000000e00000000000003f80000000000000040000000000000000000000000080bf00000000000000000000803f00000000000000000000803f000000000000000000000000aedf45c500000000a470bd400000803fb49626fa03000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000d73f81c5000000001e8550c4000000000000f042000000007bf7adb60000000000000000000000000000000000000000d73f81c5000000001e8578c4000000000000f042000000007bf7adb60000000000000000000000000000000000000000d7ff84c51e4545c4aeff6bc51e4545c4aeff6bc58fa280c4d7ff84c58fa280c403000000000100000000000000000000ae3f18c5000000001f8550c4000000000000f042000000007bf7adb60000000000000000000000000000000000000000ae3f18c5000000001f8578c4000000000000f042000000007bf7adb60000000000000000000000000000000000000000aebf1fc51f4545c4aebf01c51f4545c4aebf01c590a280c4aebf1fc590a280c403000000000000000000000000000000aedf45c5000000001f8550c4000000000000c84200000000e7f890b60000000000000000000000000000000000000000aedf45c5000000001f8578c4000000000000c84200000000e7f890b60000000000000000000000000000000000000000ae5f4dc51f4545c4ae5f3ec51f4545c4ae5f3ec58fa280c4ae5f4dc58fa280c401000000010000000000000000000000';

Test('stage preserves the placement fixture and adds only its native price-index field', () => {
    const StageSpots = require('../Source/Activity/StageSpots/GamblingCourts2K19');
    const Marker = StageSpots.GamblingCourts.find((C) => C.name === 'GAMBLING_THREE_V_THREE_1');
    const { Frame } = CourtData.BuildStageCourt(Marker);
    const Original = Buffer.from(StagePayload, 'hex');
    const Expected = Buffer.concat([
        Original.subarray(0, 103),
        Buffer.alloc(4),
        Original.subarray(103),
        Buffer.from([1]),
    ]);
    Expected[16 + (13 >> 3)] |= 0x80 >> (13 & 7);
    Expected[16 + (108 >> 3)] |= 0x80 >> (108 & 7);
    const Payload = Buffer.from(Frame.subarray(32));
    Assert.equal(Payload[24] & RecapMask, RecapMask, 'recap winner/loser lines are present');
    Payload[24] &= ~RecapMask;
    const WithoutRecap = Buffer.concat([
        Payload.subarray(0, Payload.length - 1 - RecapBytes),
        Payload.subarray(Payload.length - 1),
    ]);
    Assert.strictEqual(WithoutRecap.toString('hex'), Expected.toString('hex'));
    Assert.strictEqual(Frame.length, 32 + 757 + RecapBytes);
    Assert.strictEqual(Frame.readUInt32BE(28), 757 + RecapBytes, 'u32 length at +28');
});

Test('stage object ids are session-prefixed, payload ids stay plain', () => {
    const StageSpots = require('../Source/Activity/StageSpots/GamblingCourts2K19');
    Assert.strictEqual(CourtData.StageLowFor('GAMBLING_ONE_V_ONE'), 0x6be0f7b4, 'the 1v1 keys by its allcourts name');
    Assert.strictEqual(CourtData.StageGuidFor('GAMBLING_THREE_V_THREE_1'), (BigInt(0x003a190e) << 32n) | 0xfa2696b4n);
    for (const M of StageSpots.GamblingCourts) {
        const { Guid, Low, Frame } = CourtData.BuildStageCourt(M);
        Assert.strictEqual(Guid, CourtData.StageGuidFor(M.name));
        Assert.strictEqual(Frame.readBigUInt64BE(16), Guid, 'envelope carries the prefixed id');
        Assert.strictEqual(Frame.readUInt32LE(32 + 8 + 8 + 15 + 4 + 64), Low, 'payload court id stays the plain crc32');
    }
});

Test('stage identity agrees between CourtData and CourtTables', () => {
    const StageSpots = require('../Source/Activity/StageSpots/GamblingCourts2K19');
    for (const M of StageSpots.GamblingCourts) {
        Assert.strictEqual(CourtData.StageLowFor(M.name), CourtTables.StageLowFor(M.name), M.name);
        Assert.strictEqual(CourtData.StageGuidFor(M.name), CourtTables.StageGuidFor(M.name), M.name);
    }
});

Test('stage publishes 8 bitstream courts and no queues', () => {
    Roster.Players.clear();
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.ActivityName = 'stage';
    C.State = State.Active;

    Assert.strictEqual(Courts.Publish(C), 8);
    Assert.strictEqual(Sent.length, 8, 'courts only');
    Assert.strictEqual(C.CourtsPublished, true);

    const Frames = Sent.map(Unwrap);
    for (const F of Frames) {
        Assert.strictEqual(F.readUInt32BE(4) >>> 0, 0x9c72247c);
        Assert.strictEqual(F.readUInt32BE(24) >>> 0, CourtData.CourtClass);
        Assert.strictEqual(
            (F.readBigUInt64BE(16) >> 32n) & 0xffffffffn,
            BigInt(CourtData.AnteUpSession),
            'every stage court resolves against the Ante-Up session',
        );
    }
});

Test('live occupancy records carry BE holder GUIDs per mat', () => {
    const E = Entry('SHORT_BOTTOM_LEFT');
    const Layout = {
        CourtType: E.CourtType,
        size: E.TeamSize,
        position: E.Pos.slice(),
        Yaw: E.YawDeg,
        Locations: E.Locations.slice(),
    };
    const Empty = CourtData.LiveSpotRecord(Layout, 0, []);
    Assert.strictEqual(Empty.length, 0x48);
    Assert.strictEqual(Empty.readBigUInt64BE(8), 0n, 'empty mat holds nobody');

    const Held = CourtData.LiveSpotRecord(Layout, 1, [0n, 0x0110000100000666n, 0n]);
    Assert.strictEqual(Held.readBigUInt64BE(8), 0n);
    Assert.strictEqual(Held.readBigUInt64BE(16), 0x0110000100000666n, 'seat 1 holder at +16');
    Assert.strictEqual(Held.readBigUInt64BE(24), 0n);
    Assert.strictEqual(Held.readUInt32LE(0x38), 0, 'got-next record, not squad');
});

process.stdout.write(`\n${Passed} passing\n`);
