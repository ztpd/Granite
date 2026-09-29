// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');
const Log = require('../Source/Core/Log');
const GotNext = require('../Source/Protocol/GotNext');
const { Crc32 } = require('../Source/Core/Crc32');
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

const Captured = Buffer.from(
    'ec000000ce148fb1d2f5ae6e0008001900000000000000050000000000000000' +
        '00364f6300000006000000c0' +
        'b18f14ce1423add21ef4356302000000' +
        'cc9ecd843d9e508900364a2600008d0a' +
        'e101d0dc3d9e50890000000000000001' +
        'ea7e897936182e830000000000000070',
    'hex',
);

const Dir = Path.join(__dirname, '..', 'Capture');
function CapturedFrames(Op) {
    if (!Fs.existsSync(Dir)) return [];
    const Out = [];
    for (const File of Fs.readdirSync(Dir)
        .filter((F) => F.endsWith('.txt'))
        .sort()) {
        for (const Line of Fs.readFileSync(Path.join(Dir, File), 'utf8').split(/\r?\n/)) {
            const Parts = Line.split(' ');
            if (Parts[1] === Op && Parts[3]) Out.push(Buffer.from(Parts[3], 'hex'));
        }
    }
    return Out;
}

Test('the got-next command is crc32 of JOIN', () => {
    Assert.strictEqual(GotNext.Command >>> 0, 0x1ef43563);
    Assert.strictEqual(Crc32('JOIN'), 0x1ef43563);
});

Test('a captured 2K26 grab decodes to a player and a slot', () => {
    const Grab = GotNext.Read(Captured);
    Assert.ok(Grab);
    Assert.strictEqual(Grab.PlayerKey, 0x00364a2600008d0an);
    Assert.strictEqual(Grab.SlotIndex, 1n);
});

Test('the court key offset is the 2K21 one, not the 2K26 one', () => {
    Assert.strictEqual(GotNext.CourtKeyOffset, 24);
});

const Grabs = CapturedFrames('ce148fb1');
const DecodedGrabs = Grabs.map((F) => GotNext.Read(F)).filter(Boolean);
if (DecodedGrabs.length) {
    Test('every live grab names a court this server can resolve', () => {
        const Worlds = ['neighborhood', 'stage'];
        for (const G of DecodedGrabs) {
            let Group = null;
            for (const Activity of Worlds) {
                Group =
                    GotNext.GroupFor({ ActivityName: Activity }, G.CourtKey) ||
                    GotNext.GroupForLoose({ ActivityName: Activity }, G.CourtKey);
                if (Group) break;
            }
            Assert.ok(Group, 'grab key ' + G.CourtKey.toString(16) + ' resolves to a group');
            if (!G.Leaving) Assert.ok(G.SlotIndex !== null, 'a grab carries the slot index');
        }
    });

    Test('the capture holds real leaves, not just grabs', () => {
        const Leaves = DecodedGrabs.filter((G) => G.Leaving);
        Assert.ok(Leaves.length, 'no LEAVE in any capture — the court lookup is failing again');
        for (const G of Leaves) {
            Assert.strictEqual(G.SlotIndex, null, 'a leave gives up whatever it holds');
            let Group = null;
            for (const Activity of ['neighborhood', 'stage']) {
                Group =
                    GotNext.GroupFor({ ActivityName: Activity }, G.CourtKey) ||
                    GotNext.GroupForLoose({ ActivityName: Activity }, G.CourtKey);
                if (Group) break;
            }
            Assert.ok(Group, 'leave key ' + G.CourtKey.toString(16) + ' still names a court');
        }
    });

    Test('a travel command is not mistaken for a grab', () => {
        Assert.ok(
            Grabs.some((F) => GotNext.Read(F) === null),
            'the change-server request is also a MATCH_REQUEST',
        );
    });
}

Test('a command that is not JOIN is not a grab', () => {
    const Other = Buffer.from(Captured);
    Other.writeUInt32BE(0x5bb78c48, Captured.indexOf(Buffer.from('1ef43563', 'hex')));
    Assert.strictEqual(GotNext.Read(Other), null);
});

Test('an unrelated frame is left alone rather than misread', () => {
    Assert.strictEqual(GotNext.Read(Buffer.alloc(64)), null);
    Assert.strictEqual(GotNext.Read(Buffer.alloc(8)), null);
    Assert.strictEqual(GotNext.Handle({ Identifier: 'x' }, Buffer.alloc(64)), false);
});

Test('the state is little endian, and lives in the player object', () => {
    Assert.strictEqual(GotNext.StateEndian, 'LE');
    Assert.strictEqual(GotNext.State.GotNext >>> 0, 0xca9b2162);
    Assert.strictEqual(Crc32('GOT_NEXT'), GotNext.State.GotNext >>> 0);

    const Body = Buffer.alloc(64);
    Body.writeUInt32LE(GotNext.State.None, 20);
    Assert.strictEqual(GotNext.FindState(Body), 20);

    const Wrong = Buffer.alloc(64);
    Wrong.writeUInt32BE(GotNext.State.None, 20);
    Assert.strictEqual(GotNext.FindState(Wrong), -1, 'the endianness has regressed');

    const Patch = GotNext.Grant(Body);
    Assert.ok(Patch.Patched);
    Assert.strictEqual(Patch.Frame.readUInt32LE(20) >>> 0, 0xca9b2162);
    Assert.strictEqual(Body.readUInt32LE(20) >>> 0, 0x9705bb0d, 'the original is untouched');
});

const Hello = CapturedFrames('366444c1')[0];
const Updates = CapturedFrames('fef2dd68');
if (Hello) {
    Test('a real handshake carries the state and a real world state does not', () => {
        Assert.ok(GotNext.FindState(Hello) > 0, 'the handshake is where it lives');
        for (const U of Updates) {
            Assert.strictEqual(GotNext.FindState(U), -1, 'granting on the world state echo could never have worked');
        }
        const Patch = GotNext.Grant(Hello);
        Assert.ok(Patch.Patched);
        Assert.strictEqual(Patch.Frame.readUInt32LE(Patch.At) >>> 0, 0xca9b2162);
    });
}

Test('a body with no state to replace is reported, not silently mangled', () => {
    Assert.strictEqual(GotNext.Grant(Buffer.alloc(64)).Patched, false);
});

Test('a grab is recorded on the connection', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    Assert.strictEqual(GotNext.Handle(C, Captured), true);
    Assert.ok(C.GotNext, 'the grant is state the player object then carries');
});

Test('a granted player is sent their own object carrying GOT_NEXT', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.PlayerBody = Buffer.alloc(200);
    C.PlayerBody.writeUInt32LE(GotNext.State.None, 120);

    Assert.strictEqual(GotNext.Deliver(C), true);
    Assert.strictEqual(Sent.length, 1, 'the grant is a player object, not a reply packet');
    Assert.strictEqual(
        C.PlayerBody.readUInt32LE(120) >>> 0,
        GotNext.State.GotNext,
        'and the stored body keeps it, so later replays agree',
    );
});

Test('delivering with no player body says so instead of throwing', () => {
    const C = new Connection(Socket([]), {}, 20054);
    C.State = State.Active;
    Assert.strictEqual(GotNext.Deliver(C), false);
});

const CourtTables = require('../Source/Activity/CourtTables');
const Courts = require('../Source/Protocol/Courts');
const Slots = require('../Source/Protocol/Slots');
const Position = require('../Source/Protocol/Position');

Test('the slot names the queue, and the queues are the two windings', () => {
    const W = CourtTables.For('neighborhood');
    const Queues = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext');
    Assert.strictEqual(Queues.length, 2, 'a court publishes both windings as queues');

    const Conn = { ActivityName: 'neighborhood' };
    Assert.deepStrictEqual(GotNext.SpotFor(Conn, Queues[0].ObjectId, 0), Queues[0].Anchors[0]);
    Assert.deepStrictEqual(
        GotNext.SpotFor(Conn, Queues[0].ObjectId, 1),
        Queues[1].Anchors[0],
        'slot 1 is the other winding, not the second mat of the first',
    );
    Assert.notDeepStrictEqual(Queues[0].Anchors[0], Queues[1].Anchors[0]);
});

Test('the mat within a queue is the one the player is standing on', () => {
    const W = CourtTables.For('neighborhood');
    const Queue = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext')[0];
    Assert.ok(Queue.Anchors.length >= 3, 'a park trio has three mats');

    for (const Want of [0, 1, 2]) {
        const On = Queue.Anchors[Want];
        const Conn = {
            ActivityName: 'neighborhood',
            Position: { X: Math.round(On[0]), Y: 0, Z: Math.round(On[2]) },
        };
        Assert.deepStrictEqual(
            GotNext.SpotFor(Conn, Queue.ObjectId, Queue.Winding),
            On,
            `standing on mat ${Want} grabs mat ${Want}`,
        );
    }

    Assert.deepStrictEqual(
        GotNext.SpotFor({ ActivityName: 'neighborhood' }, Queue.ObjectId, Queue.Winding),
        Queue.Anchors[0],
    );
});

Test('a slot past the end of the queues clamps rather than throwing', () => {
    const W = CourtTables.For('neighborhood');
    const Queues = Courts.GroupsFor(W.Courts[0], W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext');
    Assert.deepStrictEqual(
        GotNext.SpotFor({ ActivityName: 'neighborhood' }, Queues[0].ObjectId, 99),
        Queues[Queues.length - 1].Anchors[0],
    );
});

Test('an unknown court yields nothing rather than a wrong position', () => {
    Assert.strictEqual(GotNext.SpotFor({ ActivityName: 'neighborhood' }, 999n, 0), null);
    Assert.strictEqual(GotNext.SpotFor({ ActivityName: 'mycourt' }, 999n, 0), null);
});

Test('granting warps the player onto the spot, in world units', () => {
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];

    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    C.GotNext = { Court: Group.ObjectId, Slot: 0 };

    Assert.strictEqual(GotNext.Warp(C), true);
    Assert.strictEqual(Sent.length, 1);

    const Unwrap = (Buf) => {
        for (let Off = 0; Off <= 14; Off++)
            if (Buf.length - Off >= 4 && Buf.readUInt32LE(Off) === Buf.length - Off) return Buf.slice(Off);
        throw new Error('no websocket payload found');
    };
    const Frame = Unwrap(Sent[0]);
    Assert.strictEqual(Frame.readUInt32BE(4) >>> 0, Position.UpdateListPacket);
    const E = Position.Entry;
    const F = Position.FlagBytes;
    Assert.strictEqual(
        Frame.readInt16BE(E.Payload + F + 0),
        Math.round(Group.Anchors[0][0]),
        'the wire carries world units, the same ones the client reports',
    );
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 4), Math.round(Group.Anchors[0][2]));
});

Test('a later handshake does not revert an active grant to NONE', () => {
    const C = new Connection(Socket([]), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.GotNext = { Court: 1n, Slot: 0, Since: Date.now() };

    const Cached = Buffer.alloc(200);
    Cached.writeUInt32LE(GotNext.State.None, 120);
    C.PlayerBody = Cached;

    Assert.strictEqual(GotNext.Reapply(C), true);
    Assert.strictEqual(C.PlayerBody.readUInt32LE(120) >>> 0, GotNext.State.GotNext);
    Assert.strictEqual(
        Cached.readUInt32LE(120) >>> 0,
        GotNext.State.None,
        'the cached body itself is not mutated, only this connection’s copy',
    );

    Assert.strictEqual(GotNext.Reapply(C), false, 'a body already carrying it is left alone');
});

Test('reapply does nothing without a grant or without a body', () => {
    const C = new Connection(Socket([]), {}, 20054);
    C.State = State.Active;
    C.PlayerBody = Buffer.alloc(200);
    Assert.strictEqual(GotNext.Reapply(C), false, 'no grant');

    C.GotNext = { Court: 1n, Slot: 0, Since: Date.now() };
    C.PlayerBody = null;
    Assert.strictEqual(GotNext.Reapply(C), false, 'no body');
});

Test('the court is re-sent before the player is warped onto it', () => {
    const Carries = (Frame, Crc) => {
        const Needle = Buffer.alloc(4);
        Needle.writeUInt32BE(Crc >>> 0, 0);
        return Frame.includes(Needle);
    };
    const Grant = (Activity) => {
        const C = new Connection(Socket([]), {}, 20054);
        C.Puid = 0x0110000100000666n;
        C.State = State.Active;
        C.ActivityName = Activity;
        C.PlayerBody = Buffer.alloc(200);
        C.PlayerBody.writeUInt32LE(GotNext.State.None, 120);
        return C;
    };

    {
        const W = CourtTables.For('neighborhood');
        const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];
        const Sent = [];
        const C = Grant('neighborhood');
        C.Socket = Socket(Sent);
        C.GotNext = { Court: Group.ObjectId, Slot: 0, Since: Date.now() };

        Assert.strictEqual(GotNext.Deliver(C), true);
        Assert.strictEqual(Sent.length, 4, 'player object, court, mirror, warp');
        Assert.ok(Carries(Sent[1], Courts.CourtClass), 'then the court');
        Assert.ok(Carries(Sent[2], Courts.CourtClass), 'and its physical mirror');
        Assert.ok(Carries(Sent[3], Position.PositionClass), 'and the warp comes last, not before any of them');
    }

    {
        const W = CourtTables.For('cages');
        const Group = Courts.GroupsFor(W.Courts[0], W.Room, W.SeqBase)[0];
        const Sent = [];
        const C = Grant('cages');
        C.Socket = Socket(Sent);
        C.GotNext = { Court: Group.ObjectId, Slot: 0, Since: Date.now() };

        Assert.strictEqual(GotNext.Deliver(C), true);
        Assert.strictEqual(Sent.length, 4, 'player object, queue, court, position');
        Assert.ok(Carries(Sent[1], Slots.SlotClass), 'the queue they were seated in comes second');
        Assert.ok(Carries(Sent[2], Courts.CourtClass), 'then the court');
        Assert.ok(Carries(Sent[3], Position.PositionClass), 'and the warp comes last, not before either of them');
    }
});

Test('re-sending a court raises its version, or the client ignores it', () => {
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];

    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.State = State.Active;
    C.ActivityName = 'neighborhood';

    Assert.strictEqual(Courts.Republish(C, Group.ObjectId), true);
    Assert.strictEqual(Courts.Republish(C, Group.ObjectId), true);
    Assert.strictEqual(C.CourtVersions.get(Group.ObjectId), 3n);

    Assert.strictEqual(Courts.Republish(C, 999n), false, 'an unknown court is not invented');
});

Test('a grab seats the player in that court’s queue', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];

    const C = new Connection(Socket([]), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    const Queues = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase).filter((G) => G.Kind === 'gotnext');
    const StandingOn = Queues[1].Anchors[1];
    C.Position = { X: Math.round(StandingOn[0]), Y: 0, Z: Math.round(StandingOn[2]) };
    C.GotNext = { Court: Group.ObjectId, Slot: 1, Since: Date.now() };

    Assert.strictEqual(GotNext.Seat(C), true);
    Assert.strictEqual(C.GotNext.Seat, 1, 'the seat they walked up to, not just the first free one');
    Assert.strictEqual(
        Slots.SeatsOf(Queues[1].SlotObjectId)[1],
        0x0110000100000666n,
        'seated in the queue they named, not winding 0',
    );
});

Test('a player holds one spot at a time', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const First = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];
    const Second = Courts.GroupsFor(W.Courts[4], W.Room, W.SeqBase)[0];
    const Puid = 0x0110000100000777n;

    Assert.ok(Slots.Occupy(First.SlotObjectId, Puid, First.Anchors.length, 0));
    const Moved = Slots.Occupy(Second.SlotObjectId, Puid, Second.Anchors.length, 0);
    Assert.ok(Moved);
    Assert.deepStrictEqual(Moved.Freed, [First.SlotObjectId], 'the old seat is given up');
    Assert.ok(Slots.SeatsOf(First.SlotObjectId).every((S) => S === 0n));
    Assert.strictEqual(Slots.SeatsOf(Second.SlotObjectId)[0], Puid);
});

Test('pressing again does not take a second seat', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];
    const Puid = 0x0110000100000888n;

    Slots.Occupy(Group.SlotObjectId, Puid, Group.Anchors.length, 0);
    Slots.Occupy(Group.SlotObjectId, Puid, Group.Anchors.length, 2);
    Assert.strictEqual(
        Slots.SeatsOf(Group.SlotObjectId).filter((S) => S === Puid).length,
        1,
        'a repeat press while a request is open would otherwise fill the queue with one player',
    );
});

Test('a full queue refuses the join rather than squeezing one in', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];

    for (let I = 0; I < Group.Anchors.length; I++) {
        Assert.ok(Slots.Occupy(Group.SlotObjectId, BigInt(0x1000 + I), Group.Anchors.length, I));
    }
    Assert.strictEqual(Slots.Occupy(Group.SlotObjectId, 0x9999n, Group.Anchors.length, 0), null);
});

Test('disconnecting gives the seat back', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];

    const C = new Connection(Socket([]), {}, 20054);
    C.Puid = 0x0110000100000999n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    C.GotNext = { Court: Group.ObjectId, Slot: 0, Since: Date.now() };
    GotNext.Seat(C);

    Assert.deepStrictEqual(GotNext.Vacate(C), [Group.SlotObjectId]);
    Assert.strictEqual(C.GotNext, null);
    Assert.ok(
        Slots.SeatsOf(Group.SlotObjectId).every((S) => S === 0n),
        'or the spot stays held by somebody who has left',
    );
});

Test('the queue goes out as a SLOT object naming its court', () => {
    Slots.Forget();
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[3], W.Room, W.SeqBase)[0];
    const Puid = 0x0110000100000aaan;
    Slots.Occupy(Group.SlotObjectId, Puid, Group.Anchors.length, 0);

    const Body = Slots.BuildBody(Group.SlotObjectId, Group.SlotName, Slots.SeatsOf(Group.SlotObjectId), 4n);
    Assert.strictEqual(Body.readBigUInt64BE(0), Group.SlotObjectId);
    Assert.strictEqual(Body.readBigUInt64BE(8), 4n, 'a re-send at the same revision is discarded');
    Assert.strictEqual(Body[16], 0xfe, 'all seven fields, the shape busy ws proved');
    Assert.strictEqual(Body.readUInt32LE(17) >>> 0, Courts.IdentityOf(Group) >>> 0);
    Assert.strictEqual(Body[21], Group.Anchors.length);

    Assert.strictEqual(Body.readBigUInt64LE(22), Puid);
    Assert.notStrictEqual(Body.readBigUInt64BE(22), Puid, 'the endianness has regressed');
    Assert.strictEqual(Body.length, 16 + 1 + 4 + 1 + Slots.MaxSeats * 8);
});

Test('warping without a grant does nothing', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    Assert.strictEqual(GotNext.Warp(C), false);
    Assert.strictEqual(Sent.length, 0);
});

Test('the grant writes the court id as well as the state', () => {
    const Body = Buffer.alloc(200);
    Body.writeUInt32LE(GotNext.State.None, 120);

    const Patch = GotNext.Grant(Body, GotNext.State.GotNext, 0x306);
    Assert.ok(Patch.Patched);
    Assert.strictEqual(Patch.Frame.readUInt32LE(Patch.At) >>> 0, GotNext.State.GotNext);
    Assert.strictEqual(Patch.CourtAt, Patch.At + 4, 'the court is the next value after the state');
    Assert.strictEqual(Patch.Frame.readUInt32LE(Patch.CourtAt) >>> 0, 0x306);
    Assert.strictEqual(GotNext.CourtIdOffset, 4);
    Assert.strictEqual(Body.readUInt32LE(120) >>> 0, GotNext.State.None, 'the original is untouched');
});

Test('a grant with no court id leaves that field alone rather than zeroing it', () => {
    const Body = Buffer.alloc(200);
    Body.writeUInt32LE(GotNext.State.None, 120);
    Body.writeUInt32LE(0xdeadbeef, 124);

    const Patch = GotNext.Grant(Body);
    Assert.strictEqual(Patch.CourtAt, -1, 'nothing was written');
    Assert.strictEqual(Patch.Frame.readUInt32LE(124) >>> 0, 0xdeadbeef);
});

function RealPlayerBody() {
    const Frame = Buffer.from(
        Fs.readFileSync(Path.join(__dirname, 'Frames', 'Handshake2K19.txt'), 'utf8')
            .trim()
            .split(/\s+/)[3],
        'hex',
    );
    const PlayerObject = require('../Source/Protocol/PlayerObject');
    const Handshake = PlayerObject.ExtractHandshakeBody(Frame);
    Assert.ok(Handshake, 'fixture yields a PLAYER body');
    return Handshake.Body;
}

Test('a real 2K19 body carries gotNextLocation at the engine default, the world origin', () => {
    const PlayerBody = require('../Source/Protocol/PlayerBody');
    const Body = RealPlayerBody();
    const Decoded = PlayerBody.Decode(Body);
    Assert.ok(Decoded.Ok, Decoded.Reason);
    Assert.strictEqual(Decoded.Present, 149, 'a live client sends all 149 presence bits');

    const At = Decoded.Offsets.get(PlayerBody.Field.GotNextLocation);
    Assert.ok(At !== undefined, 'field 147 is present');
    Assert.strictEqual(Body.readFloatLE(At + 0), 0);
    Assert.strictEqual(Body.readFloatLE(At + 4), 0);
    Assert.strictEqual(Body.readFloatLE(At + 8), 0);
    Assert.strictEqual(
        Body.readFloatLE(At + 12),
        1,
        'xmmword_1426D6A00 = (0, 0, 0, 1): an unset destination IS the world origin',
    );
});

Test('the grant writes the spot into gotNextLocation, PLAYER field 147', () => {
    const PlayerBody = require('../Source/Protocol/PlayerBody');
    const Body = RealPlayerBody();
    const Expected = PlayerBody.Decode(Body).Offsets.get(PlayerBody.Field.GotNextLocation);

    const Spot = [-1907.0, 0.0, -820.0];
    const Patch = GotNext.Grant(Body, GotNext.State.GotNext, 0x306, Spot, -8155);
    Assert.ok(Patch.Patched);
    Assert.strictEqual(Patch.LocAt, Expected, 'the destination is field 147, not an offset from the state');
    Assert.strictEqual(Patch.Frame.readFloatLE(Patch.LocAt + 0), Spot[0]);
    Assert.strictEqual(Patch.Frame.readFloatLE(Patch.LocAt + 4), Spot[1]);
    Assert.strictEqual(Patch.Frame.readFloatLE(Patch.LocAt + 8), Spot[2]);
    Assert.strictEqual(Patch.Frame.readFloatLE(Patch.LocAt + 12), 1, 'w stays 1.0');
    Assert.strictEqual(Patch.Frame.readInt32LE(Patch.FacingAt), -8155, 'gotNextFacing is field 148');
    Assert.strictEqual(Patch.FacingAt, Patch.LocAt + 16, 'field 148 follows field 147');

    Assert.strictEqual(Patch.Frame.readUInt32LE(Patch.At) >>> 0, GotNext.State.GotNext);
    Assert.strictEqual(Patch.Frame.readUInt32LE(Patch.CourtAt) >>> 0, 0x306);
    Assert.strictEqual(Patch.Frame.length, Body.length, 'an in-place overwrite, no reflow');
    Assert.ok(Patch.Frame.subarray(16, 35).equals(Body.subarray(16, 35)), 'bitmap untouched');
});

Test('gotNextLocation is nowhere near the PUID', () => {
    const PlayerBody = require('../Source/Protocol/PlayerBody');
    const Body = RealPlayerBody();
    const Decoded = PlayerBody.Decode(Body);
    const PuidAt = Decoded.Offsets.get(PlayerBody.Field.Puid);
    const LocAt = Decoded.Offsets.get(PlayerBody.Field.GotNextLocation);
    Assert.strictEqual(PuidAt, 35, 'PUID is the first value after the 19-byte bitmap');
    Assert.ok(LocAt > PuidAt + 64, `field 147 (body+${LocAt}) is far past the identity header`);
});

Test('a grant with no location leaves the destination bytes alone', () => {
    const PlayerBody = require('../Source/Protocol/PlayerBody');
    const Body = RealPlayerBody();
    const At = PlayerBody.Decode(Body).Offsets.get(PlayerBody.Field.GotNextLocation);

    const Patch = GotNext.Grant(Body, GotNext.State.GotNext, 0x306);
    Assert.strictEqual(Patch.LocAt, -1, 'nothing was written');
    Assert.ok(Patch.Frame.subarray(At, At + 20).equals(Body.subarray(At, At + 20)));
});

Test('the court id is the one the COURT object publishes as its RegionId', () => {
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[2], W.Room, W.SeqBase)[0];

    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    C.PlayerBody = Buffer.alloc(200);
    C.PlayerBody.writeUInt32LE(GotNext.State.None, 120);
    C.GotNext = { Court: Group.ObjectId, Slot: 0, Since: Date.now() };

    Assert.strictEqual(GotNext.Deliver(C), true);
    Assert.strictEqual(
        C.PlayerBody.readUInt32LE(124) >>> 0,
        Courts.IdentityOf(Group) >>> 0,
        'the stored body carries the court, so replays and Reapply agree',
    );
});

Test('reapplying after the body cache also restores the court id', () => {
    const W = CourtTables.For('neighborhood');
    const Group = Courts.GroupsFor(W.Courts[2], W.Room, W.SeqBase)[0];

    const C = new Connection(Socket([]), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    C.GotNext = { Court: Group.ObjectId, Slot: 0, Since: Date.now() };

    const Cached = Buffer.alloc(200);
    Cached.writeUInt32LE(GotNext.State.None, 120);
    C.PlayerBody = Cached;

    Assert.strictEqual(GotNext.Reapply(C), true);
    Assert.strictEqual(C.PlayerBody.readUInt32LE(120) >>> 0, GotNext.State.GotNext);
    Assert.strictEqual(
        C.PlayerBody.readUInt32LE(124) >>> 0,
        Courts.IdentityOf(Group) >>> 0,
        'or the state comes back without the court and the loop returns',
    );
});

Test('reapplying a postgame winner restores the court and center destination even when GOT_NEXT survived', () => {
    const PlayerBody = require('../Source/Protocol/PlayerBody');
    const W = CourtTables.For('neighborhood');
    const Raw = W.Courts[2];
    const Group = Courts.GroupsFor(Raw, W.Room, W.SeqBase)[0];
    const C = new Connection(Socket([]), {}, 20054);
    C.Puid = 0x0110000100000666n;
    C.State = State.Active;
    C.ActivityName = 'neighborhood';
    C.PlayerBody = RealPlayerBody();
    const StateAt = GotNext.FindState(C.PlayerBody);
    C.PlayerBody.writeUInt32LE(GotNext.State.GotNext, StateAt);
    C.PlayerBody.writeUInt32LE(0, StateAt + GotNext.CourtIdOffset);
    C.GotNext = { Court: Group.ObjectId, Slot: 0, Location: Raw.Pos, PostGameWinner: true, PostGameHold: true };

    Assert.equal(GotNext.Reapply(C), true);
    Assert.equal(C.PlayerBody.readUInt32LE(StateAt + GotNext.CourtIdOffset), Courts.IdentityOf(Group));
    const At = PlayerBody.Decode(C.PlayerBody).Offsets.get(PlayerBody.Field.GotNextLocation);
    Assert.deepStrictEqual(
        [0, 1, 2].map((I) => C.PlayerBody.readFloatLE(At + 4 * I)),
        Raw.Pos.map((V) => Math.fround(V)),
    );
    Assert.equal(GotNext.Reapply(C), false, 'an unchanged winner needs no extra revision');
});

Test('the grant touches the state and the court and NOTHING after them', () => {
    const Body = Buffer.alloc(200);
    Body.writeUInt32LE(GotNext.State.None, 120);
    const After = [2, 393216, 131006464, 2049, 65536];
    After.forEach((V, I) => Body.writeUInt32LE(V, 128 + I * 4));

    const Patch = GotNext.Grant(Body, GotNext.State.GotNext, 0x300);
    Assert.strictEqual(Patch.Frame.readUInt32LE(120) >>> 0, GotNext.State.GotNext);
    Assert.strictEqual(Patch.Frame.readUInt32LE(124) >>> 0, 0x300);
    After.forEach((V, I) =>
        Assert.strictEqual(
            Patch.Frame.readUInt32LE(128 + I * 4),
            V,
            `state+${8 + I * 4} was overwritten — that field is not part of the grant`,
        ),
    );
});

process.stdout.write(`\n${Passed} passing\n`);
