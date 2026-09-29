// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');

const Log = require('../Source/Core/Log');
const Position = require('../Source/Protocol/Position');
const Roster = require('../Source/Protocol/Roster');
const Samples = require('./Samples');
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

const Socket = (Sink) => ({ destroyed: false, write: (B) => Sink.push(B) });

Test('a movement packet decodes to a position', () => {
    const P = Position.ReadMovement(Samples.Movement);
    Assert.ok(P);
    Assert.strictEqual(P.X, -179);
    Assert.strictEqual(P.Y, 0);
    Assert.strictEqual(P.Z, 18848);
    Assert.strictEqual(P.Heading, 0x83, 'heading is at +22, not +23');
});

Test('anything that is not a movement packet yields nothing', () => {
    Assert.strictEqual(Position.ReadMovement(Samples.AsStandalone(Samples.Connect)), null);
    Assert.strictEqual(Position.ReadMovement(Buffer.alloc(4)), null);
});

Test('the position frame is an update list carrying the position class', () => {
    const E = Position.Entry;
    const Frame = Position.Build(0x0110000100000666n, { X: -803, Y: 0, Z: 1637, Heading: 0x40 });

    Assert.strictEqual(Frame.readUInt32LE(0), Frame.length, 'declared length closes');
    Assert.strictEqual(Frame.readUInt32BE(4), Position.UpdateListPacket);
    Assert.strictEqual(Frame.readBigUInt64BE(8), 0n, 'connection id is zero');
    Assert.strictEqual(Frame.readUInt8(E.Count), 1, 'one entry');
    Assert.strictEqual(Frame.readUInt32BE(E.Class) >>> 0, Position.PositionClass);
    Assert.strictEqual(Frame.readUInt16BE(E.Span), 11 + Position.SpanOverhead);
    Assert.strictEqual(Frame.readBigUInt64BE(E.Key), 0x0110000100000666n, 'keyed by the puid');
    Assert.strictEqual(Frame.readUInt8(E.Length), 11, 'body length');

    const F = Position.FlagBytes;
    Assert.strictEqual(F, 4, '25 flag bits plus seven pad bits is four bytes');
    Assert.strictEqual(Frame.readUInt8(E.Payload), 0xc0, 'position and heading both present');
    Assert.deepStrictEqual(Frame.subarray(E.Payload + 1, E.Payload + 4), Buffer.alloc(3));
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 0), -803);
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 2), 0);
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 4), 1637);
    Assert.strictEqual(Frame.readUInt8(E.Payload + F + 6), 0x40);
});

Test('the class sits at +17 in the legacy NBA2K19 update-list envelope', () => {
    const Frame = Position.Build(0x0110000100000666n, { X: 1, Y: 2, Z: 3, Heading: 4 });
    Assert.strictEqual(
        Frame.readUInt32BE(17) >>> 0,
        Position.PositionClass,
        'the type must be readable at +17 or the frame is rejected outright',
    );
    Assert.notStrictEqual(
        Frame.readUInt32BE(17) >>> 0,
        1,
        'reading 0x00000001 here is the signature of the 2K26 sequence being present',
    );
    Assert.strictEqual(Frame.length, 43, '2K19 uses a 32-byte envelope plus 11-byte body');
});

Test('coordinates are forwarded as they arrived, not rescaled', () => {
    const Movement = Position.ReadMovement(Samples.Movement);
    const Frame = Position.Build(1n, Movement);
    const F = Position.FlagBytes;
    Assert.strictEqual(
        Frame.readInt16BE(Position.Entry.Payload + F + 0),
        Movement.X,
        'the packet and the frame use the same encoding, so rescaling would double it',
    );
    Assert.strictEqual(Frame.readInt16BE(Position.Entry.Payload + F + 4), Movement.Z);
});

Test('the diagnostic movement-create fixture uses the exact delta body', () => {
    const Id = 0x0110000100000666n;
    const P = { X: -803, Y: 0, Z: 1637, Heading: 0x40 };
    const Create = Position.BuildCreate(Id, P);
    const Update = Position.Build(Id, P);

    Assert.strictEqual(Create.readUInt32BE(4), Position.ObjectDataPacket);
    Assert.strictEqual(Create.readBigUInt64BE(8), 0n, 'server object connection id is zero');
    Assert.strictEqual(Create.readBigUInt64BE(16), Id);
    Assert.strictEqual(Create.readUInt32BE(24), Position.PositionClass);
    Assert.strictEqual(Create.readUInt32BE(28), Position.Body(P).length);
    Assert.deepStrictEqual(
        Create.subarray(32),
        Update.subarray(Position.Entry.Payload),
        'registration and delta must never drift into different encodings',
    );
});

Test('a position is only dirty when it actually changed', () => {
    const C = new Connection(Socket([]), {}, 20054);
    Assert.strictEqual(Position.Note(C, Samples.Movement), true, 'the first one is new');
    Assert.strictEqual(Position.Note(C, Samples.Movement), false, 'the same one is not');
});

Test('only peers in the activity are told, and only once per change', () => {
    Roster.Players.clear();
    const Inbox = [];

    const Mover = new Connection(Socket([]), {}, 20054);
    Mover.Puid = 0x0110000100000666n;
    Mover.ActivityKey = 0x3cf672c2;
    Mover.State = State.Active;

    const Peer = new Connection(Socket(Inbox), {}, 20054);
    Peer.ActivityKey = 0x3cf672c2;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Mover.Id);
    Mover.Userdata = Buffer.alloc(1);

    const Elsewhere = [];
    const Other = new Connection(Socket(Elsewhere), {}, 20054);
    Other.ActivityKey = 0xfc9797cf;
    Other.State = State.Active;

    Roster.Add(Mover);
    Roster.Add(Peer);
    Roster.Add(Other);

    Position.Note(Mover, Samples.Movement);
    Position.Publish();

    const E = Position.Entry;
    const Unwrap = (Buf) => {
        for (let Off = 0; Off <= 14; Off++)
            if (Buf.length - Off >= 4 && Buf.readUInt32LE(Off) === Buf.length - Off) return Buf.slice(Off);
        throw new Error('no websocket payload found');
    };
    const Frames = Inbox.map(Unwrap);
    Assert.strictEqual(Inbox.length, 1, 'the peer was told the first movement delta');
    Assert.strictEqual(Frames[0].readUInt32BE(4), Position.UpdateListPacket);
    Assert.strictEqual(Frames[0].readUInt32BE(E.Class), Position.PositionClass);
    Assert.strictEqual(Elsewhere.length, 0, 'someone in another activity was not');

    Position.Publish();
    Assert.strictEqual(Inbox.length, 1, 'nothing further while the position is unchanged and placement is not due');
});

const Dir = Path.join(__dirname, '..', 'Capture');
if (Fs.existsSync(Dir)) {
    const Files = Fs.readdirSync(Dir).sort();
    if (Files.length) {
        const Lines = Fs.readFileSync(Path.join(Dir, Files[Files.length - 1]), 'utf8')
            .trim()
            .split('\n');
        const Frames = Lines.filter((L) => L.split(' ')[1] === 'ce1c9e8c').map((L) =>
            Buffer.from(L.split(' ')[3], 'hex'),
        );

        if (Frames.length) {
            Test('every captured movement frame decodes, and the player moves', () => {
                const Seen = new Set();
                for (const Frame of Frames) {
                    const P = Position.ReadMovement(Frame);
                    Assert.ok(P, 'each captured frame decodes');
                    Seen.add(`${P.X},${P.Y},${P.Z}`);
                }
                Assert.ok(Seen.size > 1, `a walking player should occupy more than one position, saw ${Seen.size}`);
            });
        }
    }
}

Test('the placement frame carries the player-state class with four flag bytes', () => {
    const E = Position.Entry;
    const Frame = Position.BuildPlacement(0x0110000100000666n, { X: -803, Y: -5, Z: 1637, Heading: 0 });

    Assert.strictEqual(Frame.readUInt32LE(0), Frame.length, 'declared length closes');
    Assert.strictEqual(Frame.readUInt32BE(4), Position.UpdateListPacket);
    Assert.strictEqual(Frame.readUInt32BE(E.Class) >>> 0, Position.StateClass);
    Assert.strictEqual(
        Frame.readUInt32BE(17) >>> 0,
        Position.StateClass,
        'the type must be readable at +17 or the frame is rejected outright',
    );
    Assert.strictEqual(Frame.readBigUInt64BE(E.Key), 0x0110000100000666n, 'keyed by the puid');

    Assert.strictEqual(Position.StateFlagBytes, 4);
    Assert.strictEqual(
        (Position.StateFlagBits + (-Position.StateFlagBits & 7)) / 8,
        Position.StateFlagBytes,
        'flag byte count follows from the bit count',
    );

    const F = Position.StateFlagBytes;
    Assert.strictEqual(Frame.readUInt8(E.Payload + 0), 0x80, 'bit 0 = position present');
    Assert.strictEqual(Frame.readUInt8(E.Payload + 1), 0x00, 'no other field asserted');
    Assert.strictEqual(Frame.readUInt8(E.Payload + 2), 0x00);
    Assert.strictEqual(Frame.readUInt8(E.Payload + 3), 0x00);
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 0), -803);
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 2), -5, 'Y must survive — the whole point');
    Assert.strictEqual(Frame.readInt16BE(E.Payload + F + 4), 1637);

    Assert.strictEqual(Frame.readUInt8(E.Length), F + 6, 'body length');
    Assert.strictEqual(Frame.readUInt16BE(E.Span), F + 6 + Position.SpanOverhead);
    Assert.strictEqual(Frame.readUInt16BE(E.Span), Frame.length - 16, 'span closes on the frame');
});

Test('placement and movement differ only in class and body, not in envelope', () => {
    const P = { X: 1, Y: 2, Z: 3, Heading: 4 };
    const Move = Position.Build(7n, P);
    const Place = Position.BuildPlacement(7n, P);
    const E = Position.Entry;
    Assert.strictEqual(Move.readUInt32BE(4), Place.readUInt32BE(4), 'same packet id');
    Assert.strictEqual(Move.readBigUInt64BE(E.Key), Place.readBigUInt64BE(E.Key), 'same object key');
    Assert.strictEqual(Move.readUInt8(E.Count), Place.readUInt8(E.Count), 'one entry each');
    Assert.notStrictEqual(Move.readUInt32BE(E.Class), Place.readUInt32BE(E.Class), 'different class');
});

Test('the client flag byte is NOT relayed by default', () => {
    const E = Position.Entry;
    const F = Position.Build(9n, { X: -803, Y: -5, Z: 1637, Heading: 0x40, Flags: 0x58 });
    Assert.strictEqual(Position.RelayExtraState, false, 'extra state stays off until derived');
    Assert.strictEqual(F.readUInt8(E.Payload), 0xc0, 'position and heading only');
    Assert.strictEqual(F.readUInt8(E.Length), 11, '2K19 11-byte body');
    Assert.strictEqual(F.length, 43, '2K19 43-byte frame');
});

Test('without a flag byte the frame is byte-identical to the old one', () => {
    const E = Position.Entry;
    const F = Position.Build(9n, { X: -803, Y: -5, Z: 1637, Heading: 0x40 });
    Assert.strictEqual(F.readUInt8(E.Payload), 0xc0, 'only position and heading');
    Assert.strictEqual(F.readUInt8(E.Length), 11, '2K19 11-byte body');
    Assert.strictEqual(F.length, 43, '2K19 43-byte frame');
});

Test('peers are never filtered on the heartbeat world field', () => {
    Roster.Players.clear();
    const Inbox = [];
    const Mover = new Connection(Socket([]), {}, 20054);
    Mover.Puid = 0x0110000100000666n;
    Mover.ActivityKey = 0x3cf672c2;
    Mover.State = State.Active;
    const Peer = new Connection(Socket(Inbox), {}, 20054);
    Peer.ActivityKey = 0x3cf672c2;
    Peer.State = State.Active;
    Peer.KnownPlayers.add(Mover.Id);
    Mover.Userdata = Buffer.alloc(1);
    Roster.Add(Mover);
    Roster.Add(Peer);

    Mover.World = 0x3cf672c2;
    Peer.World = 0x3370ebeb;
    Position.Note(Mover, Samples.Movement);
    Position.Publish();
    Assert.ok(Inbox.length > 0, 'a peer whose +23 differs must STILL be told — filtering on it broke the relay');
});

process.stdout.write(`\n${Passed} passing\n`);
