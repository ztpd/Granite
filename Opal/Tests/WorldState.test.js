// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Log = require('../Source/Core/Log');
const WorldState = require('../Source/Protocol/WorldState');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const { Connection, State } = require('../Source/Protocol/Connection');
const Fs = require('fs');
const Path = require('path');

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

function Update(Version, Key = 0x0110000100000666n) {
    const B = Buffer.alloc(80);
    B.writeUInt32LE(80, 0);
    B.writeUInt32BE(WorldState.Packet, 4);
    B.writeBigUInt64BE(Key, WorldState.KeyOffset);
    B.writeBigUInt64BE(BigInt(Version), WorldState.VersionOffset);
    return B;
}

Test('the version is bumped past what the client captured when it sent the request', () => {
    const Built = WorldState.Build(Update(1000));
    Assert.strictEqual(Built.From, 1000n);
    Assert.strictEqual(Built.To, 1000n + WorldState.VersionStep);
    Assert.strictEqual(Built.Frame.readBigUInt64BE(WorldState.VersionOffset), Built.To);
    Assert.ok(Built.To > Built.From, 'an equal or lower version is not an agreement');
});

Test('the version comes from the layout, and it is not inside the object key', () => {
    Assert.strictEqual(WorldState.KeyOffset, 42);
    Assert.strictEqual(WorldState.VersionOffset, 50);
    Assert.strictEqual(WorldState.KeyOffset, ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Key);
    Assert.strictEqual(WorldState.VersionOffset, ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Version);
    Assert.ok(
        WorldState.VersionOffset >= WorldState.KeyOffset + 8,
        'the version must start after the key ends, or the bump corrupts the key',
    );
});

Test('the object key survives the echo untouched', () => {
    const Built = WorldState.Build(Update(3, 0x01100001772ca2dan));
    Assert.strictEqual(Built.Key, 0x01100001772ca2dan);
    Assert.strictEqual(
        Built.Frame.readBigUInt64BE(WorldState.KeyOffset),
        0x01100001772ca2dan,
        'a mangled key means the client cannot match the object to its own player',
    );
});

const Dir = Path.join(__dirname, '..', 'Capture');
if (Fs.existsSync(Dir)) {
    const Captured = [];
    for (const File of Fs.readdirSync(Dir)
        .filter((F) => F.endsWith('.txt'))
        .sort()) {
        for (const Line of Fs.readFileSync(Path.join(Dir, File), 'utf8').split(/\r?\n/)) {
            const Parts = Line.split(' ');
            if (Parts[1] === 'fef2dd68' && Parts[3]) Captured.push(Buffer.from(Parts[3], 'hex'));
        }
    }

    if (Captured.length) {
        Test('every captured update keeps its key and gains version, not the other way round', () => {
            for (const Frame of Captured) {
                const Built = WorldState.Build(Frame);
                Assert.strictEqual(
                    Built.Frame.readBigUInt64BE(WorldState.KeyOffset),
                    Frame.readBigUInt64BE(WorldState.KeyOffset),
                    'key changed',
                );
                Assert.strictEqual(Built.To, Built.From + WorldState.VersionStep);
            }
            const Keys = Captured.map((F) => WorldState.Build(F).Key);
            Assert.ok(
                Keys.some((K) => K >> 32n === 0x01100001n),
                'some are player objects',
            );
        });
    }
}

Test('the original frame is left alone, because the relay path still needs it', () => {
    const Original = Update(7);
    WorldState.Build(Original);
    Assert.strictEqual(Original.readBigUInt64BE(WorldState.VersionOffset), 7n);
});

Test('a frame too short to carry a version is echoed unchanged rather than dropped', () => {
    const Short = Buffer.alloc(20);
    const Built = WorldState.Build(Short);
    Assert.strictEqual(Built.From, null);
    Assert.strictEqual(Built.Frame, Short);
});

const Puid = 0x0110000100000666n;

function Known(Sink, Revision = 1n) {
    const C = new Connection(Socket(Sink), {}, 20054);
    C.Puid = Puid;
    C.State = State.Active;
    C.PlayerBody = Buffer.alloc(200);
    C.PlayerBody.writeUInt32LE(0x9705bb0d, 120);
    C.PlayerRevision = Revision;
    return C;
}

Test('the reply goes back to the sender', () => {
    const Sent = [];
    Assert.strictEqual(WorldState.Echo(Known(Sent), Update(500)), true);
    Assert.strictEqual(Sent.length, 1, 'the sender is the one who needs to see it');
});

Test('the reply is the player object at a STRICTLY GREATER version', () => {
    const Sent = [];
    const C = Known(Sent, 2n);
    Assert.strictEqual(WorldState.Echo(C, Update(2)), true);
    Assert.ok(C.PlayerRevision > 2n, `revision ${C.PlayerRevision} does not exceed the client's 2`);
});

Test('a client whose version has run ahead is still answered above it', () => {
    const Sent = [];
    const C = Known(Sent, 2n);
    Assert.strictEqual(WorldState.Echo(C, Update(900)), true);
    Assert.ok(C.PlayerRevision > 900n, `revision ${C.PlayerRevision} is behind the client's 900`);
});

Test('an update for somebody else’s object is not answered', () => {
    const Sent = [];
    const C = Known(Sent);
    Assert.strictEqual(
        WorldState.Echo(C, Update(5, 0x0000010800000308n)),
        false,
        'this server only holds the body of the player on this connection',
    );
    Assert.strictEqual(Sent.length, 0);
});

Test('a connection with no player body yet is not answered', () => {
    const Sent = [];
    const C = new Connection(Socket(Sent), {}, 20054);
    C.Puid = Puid;
    C.State = State.Active;
    Assert.strictEqual(WorldState.Echo(C, Update(1)), false);
    Assert.strictEqual(Sent.length, 0);
});

Test('replies are rate limited per connection', () => {
    const Sent = [];
    const C = Known(Sent);

    Assert.strictEqual(WorldState.Echo(C, Update(1)), true);
    Assert.strictEqual(WorldState.Echo(C, Update(2)), false, 'the second is inside the floor');
    Assert.strictEqual(Sent.length, 1);

    C.LastEchoMs -= WorldState.MinIntervalMs + 1;
    Assert.strictEqual(WorldState.Echo(C, Update(3)), true);
    Assert.strictEqual(Sent.length, 2);
});

Test('one connection being rate limited does not silence another', () => {
    const A = [],
        B = [];
    const First = Known(A);
    const Second = Known(B);
    WorldState.Echo(First, Update(1));
    WorldState.Echo(First, Update(2));
    Assert.strictEqual(WorldState.Echo(Second, Update(3)), true);
    Assert.strictEqual(A.length, 1);
    Assert.strictEqual(B.length, 1);
});

Test('a closed connection is not echoed to', () => {
    const Sent = [];
    const C = Known(Sent);
    C.Close('test');
    const AfterClose = Sent.length;
    Assert.strictEqual(WorldState.Echo(C, Update(1)), false);
    Assert.strictEqual(Sent.length, AfterClose, 'nothing further went out');
});

process.stdout.write(`\n${Passed} passing\n`);
