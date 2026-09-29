// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Log = require('../Source/Core/Log');
const PlayerBody = require('../Source/Protocol/PlayerBody');
const PlayerObject = require('../Source/Protocol/PlayerObject');
const Position = require('../Source/Protocol/Position');
const Roster = require('../Source/Protocol/Roster');
const WorldState = require('../Source/Protocol/WorldState');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const Websocket = require('../Source/Net/Websocket');
const { Connection, State } = require('../Source/Protocol/Connection');

Log.SetLevel(Log.Level.Error);

const Frames = Fs.readFileSync(Path.join(__dirname, 'Frames', 'AppearanceUpdates20260913.txt'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((Line) => {
        const [, Type, , Hex] = Line.split(' ');
        return { Type, Frame: Buffer.from(Hex, 'hex') };
    });
const Handshake = Frames.find((F) => F.Type === '366444c1').Frame;
const Updates = Frames.filter((F) => F.Type === 'fef2dd68').map((F) => F.Frame);

const Socket = (Sink) => ({
    destroyed: false,
    write: (B) => Sink.push(B),
    end() {},
    destroy() {
        this.destroyed = true;
    },
});

function Registered(Sink) {
    const HandshakeData = PlayerObject.ExtractHandshakeBody(Handshake);
    const C = new Connection(Socket(Sink), {}, 20054);
    C.Puid = HandshakeData.PlayerId;
    C.ClaimedPuid = HandshakeData.PlayerId;
    C.MachineId = 0x10000001n;
    C.State = State.Active;
    C.PlayerBody = PlayerBody.Trim(PlayerBody.SetShow(HandshakeData.Body).Body).Body;
    C.PlayerRevision = HandshakeData.Body.readBigUInt64BE(8);
    return C;
}

function Partial(Frame) {
    return Frame.subarray(42, 42 + Frame.readUInt16BE(40));
}

function BodyIn(Written, Puid) {
    const Decoded = Websocket.Decode(Written);
    Assert.equal(Decoded.Messages.length, 1, 'one websocket message');
    const Frame = Decoded.Messages[0].Payload;
    Assert.equal(Frame.readBigUInt64BE(ObjectFrame.Layout.Nineteen.ObjectId), Puid, 'the frame is this player object');
    return Frame.subarray(ObjectFrame.Layout.Nineteen.Payload);
}

function Values(Body) {
    const Decoded = PlayerBody.Decode(Body);
    Assert.ok(Decoded.Ok, Decoded.Reason);
    const Fields = [...Decoded.Offsets.keys()].sort((A, B) => A - B);
    return new Map(
        Fields.map((Field, I) => [
            Field,
            Body.subarray(
                Decoded.Offsets.get(Field),
                I + 1 < Fields.length ? Decoded.Offsets.get(Fields[I + 1]) : Decoded.Length,
            ),
        ]),
    );
}

Test('the captured session sends closet changes as field 136, beyond the old 0..95 merge', () => {
    const Closet = Updates.map(Partial)
        .map((P) => [...Values(P).keys()])
        .filter((F) => F.includes(136));
    Assert.ok(Closet.length >= 5, 'captured closet updates');
    for (const Fields of Closet) Assert.deepEqual(Fields, [136]);
});

Test('every captured update merges into the cached body; server-owned fields 0, 1 and 84 are kept', () => {
    const C = Registered([]);
    const Show = Values(C.PlayerBody).get(PlayerBody.ShowField);
    const Identity = Values(C.PlayerBody).get(0);
    for (const Frame of Updates) {
        const Before = Values(C.PlayerBody);
        const Incoming = Values(Partial(Frame));
        PlayerObject.ApplyAppearanceUpdate(C, Frame);
        const After = Values(C.PlayerBody);
        for (const [Field, Value] of Incoming) {
            if (PlayerObject.ServerOwnedFields.has(Field)) continue;
            Assert.ok(After.get(Field).equals(Value), `field ${Field} holds the client's latest value`);
        }
        for (const [Field, Value] of Before) {
            if (Incoming.has(Field) || PlayerObject.ServerOwnedFields.has(Field)) continue;
            Assert.ok(After.get(Field).equals(Value), `field ${Field} not in the partial is unchanged`);
        }
        Assert.ok(After.get(PlayerBody.ShowField).equals(Show), 'visibility flag stays as the server set it');
        Assert.ok(After.get(0).equals(Identity), 'PUID stays as the server set it');
        Assert.equal(After.size, 149, 'the published body keeps all 149 fields');
    }
});

Test('the echo to the owner carries the new closet (field 136), so its rebuild shows the change', () => {
    const Sent = [];
    const C = Registered(Sent);
    const Closet = Updates.find((F) => F.length === 554 && [...Values(Partial(F)).keys()].join() === '136');
    const Old136 = Values(C.PlayerBody).get(136);
    const New136 = Values(Partial(Closet)).get(136);
    Assert.ok(!Old136.equals(New136), 'the capture changes the closet');

    PlayerObject.ApplyAppearanceUpdate(C, Closet);
    Assert.equal(WorldState.Echo(C, Closet), true);
    const Echoed = Values(BodyIn(Sent[Sent.length - 1], C.Puid));
    Assert.ok(Echoed.get(136).equals(New136), 'echoed PLAYER field 136 is the new closet');
    Assert.equal(Echoed.size, 149);
});

Test('an update inside the echo floor is answered when the floor ends, with the latest merged body', async () => {
    const Sent = [];
    const C = Registered(Sent);
    const Closets = Updates.filter((F) => [...Values(Partial(F)).keys()].join() === '136');
    const First = Closets[0];
    const Last = Closets.find(
        (F) =>
            !Values(Partial(F))
                .get(136)
                .equals(Values(Partial(First)).get(136)),
    );

    PlayerObject.ApplyAppearanceUpdate(C, First);
    Assert.equal(WorldState.Echo(C, First), true);
    const Count = Sent.length;

    PlayerObject.ApplyAppearanceUpdate(C, Last);
    Assert.equal(WorldState.Echo(C, Last), false, 'inside the floor');
    Assert.equal(Sent.length, Count, 'not sent immediately');

    await new Promise((Resolve) => setTimeout(Resolve, WorldState.MinIntervalMs + 50));
    Assert.equal(Sent.length, Count + 1, 'the deferred reply went out');
    Assert.ok(
        Values(BodyIn(Sent[Sent.length - 1], C.Puid))
            .get(136)
            .equals(Values(Partial(Last)).get(136)),
        'it carries the latest closet',
    );
    Assert.ok(C.PlayerRevision > Partial(Last).readBigUInt64BE(8), 'at a revision above the client update');
    C.Close('test');
});

Test('closing a connection cancels a pending deferred echo', async () => {
    const Sent = [];
    const C = Registered(Sent);
    WorldState.Echo(C, Updates[0]);
    WorldState.Echo(C, Updates[1]);
    Assert.ok(C.PendingEchoTimer, 'a reply is pending');
    C.Close('test');
    Assert.equal(C.PendingEchoTimer, null);
});

Test('a customizer rebuild is followed by the player exact cached position on every peer', () => {
    Roster.Players.clear();
    const SourceWrites = [];
    const PeerWrites = [];
    const Source = Registered(SourceWrites);
    const Peer = Registered(PeerWrites);
    Source.ActivityKey = Peer.ActivityKey = 0x3cf672c2;
    Peer.Puid = 0x0110000100000999n;
    Source.Position = { X: -281, Y: 17, Z: 629, Heading: 0x73, Flags: 0 };
    Peer.KnownPlayers.add(Source.Id);
    Roster.Add(Source);
    Roster.Add(Peer);

    try {
        const Closet = Updates.find((F) => [...Values(Partial(F)).keys()].join() === '136');
        Assert.equal(PlayerObject.ApplyAppearanceUpdate(Source, Closet), 1);
        Assert.equal(PeerWrites.length, 2, 'PLAYER rebuild then cached position replay');

        const PlayerMessage = Websocket.Decode(PeerWrites[0]).Messages[0].Payload;
        const PositionMessage = Websocket.Decode(PeerWrites[1]).Messages[0].Payload;
        Assert.equal(PlayerMessage.readUInt32BE(4), PlayerObject.ObjectDataPacket);
        Assert.ok(
            PositionMessage.equals(Position.Build(Source.Puid, Source.Position)),
            'the replay uses the last client-reported coordinates byte for byte',
        );
    } finally {
        Source.Close('test');
        Peer.Close('test');
        Roster.Players.clear();
    }
});
