// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');
const Log = require('../Source/Core/Log');
const { Crc32, Hex } = require('../Source/Core/Crc32');
const { Crc, Describe } = require('../Source/Core/Names');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Roster = require('../Source/Protocol/Roster');
const Squad = require('../Source/Protocol/Squad');
const PlayerBody = require('../Source/Protocol/PlayerBody');
const PlayerObject = require('../Source/Protocol/PlayerObject');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const Websocket = require('../Source/Net/Websocket');
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
const HandshakeLine = Fs.readFileSync(Path.join(__dirname, 'Frames', 'AppearanceUpdates20260913.txt'), 'utf8')
    .split(/\r?\n/)
    .find((Line) => Line.includes(' 366444c1 '));
const CapturedHandshake = Buffer.from(HandshakeLine.split(' ')[3], 'hex');
const CapturedPlayer = PlayerObject.ExtractHandshakeBody(CapturedHandshake);

function BodyFor(Puid) {
    const Stamped = PlayerObject.StampIdentity(CapturedPlayer.Body, CapturedPlayer.PlayerId, Puid).Body;
    return PlayerBody.Trim(PlayerBody.SetShow(Stamped).Body).Body;
}

function CommandFrame(Command, Field, Value) {
    const Body = new FieldList.Builder().AddU32('COMMAND', Command);
    if (Field) Body.AddU64(Field, Value);
    return Frame.Build(Squad.CommandPacket, Buffer.alloc(8), Body.Build(), Frame.InnerHeader.Pending);
}

function Payload(Wrapped, Size) {
    return Wrapped.slice(Wrapped.length - Size);
}

function Pair() {
    Roster.Players.clear();
    const Inbox = [],
        Sent = [];
    const A = new Connection(Socket(Sent), {}, 20054);
    A.Puid = 0x0110000179701382n;
    A.ActivityKey = 0x3cf672c2;
    A.State = State.Active;
    A.MachineId = 0x68fan;
    A.PlayerBody = BodyFor(A.Puid);
    const B = new Connection(Socket(Inbox), {}, 20054);
    B.Puid = 0x0110000110ccc7e2n;
    B.ActivityKey = 0x3cf672c2;
    B.State = State.Active;
    B.MachineId = 0x68fbn;
    B.PlayerBody = BodyFor(B.Puid);
    Roster.Add(A);
    Roster.Add(B);
    return { A, B, Inbox, Sent };
}

Test('the squad commands are crc32 of their names', () => {
    Assert.strictEqual(Crc32('SQUAD_INVITE'), 0xe1463584);
    Assert.strictEqual(Crc32('SQUAD_ACCEPT'), 0x9584c867);
    Assert.strictEqual(Crc32('SQUAD_LEAVE'), 0xe6a57fc0);
    Assert.strictEqual(Crc32('USER'), 0xbb063bfd, 'the field an invite names');
    Assert.strictEqual(Crc32('FROM'), 0x8f8f4cc4, 'the field an acceptance names');
});

Test('a squad frame is recognised however the list is positioned', () => {
    for (const Inner of [Frame.InnerHeader.None, Frame.InnerHeader.Pending, Frame.InnerHeader.Object]) {
        const Body = new FieldList.Builder()
            .AddU32('COMMAND', Squad.Command.Invite)
            .AddU64('USER', 0x0110000110ccc7e2n)
            .Build();
        const FrameData = Frame.Build(Squad.CommandPacket, Buffer.alloc(8), Body, Inner);
        const Read = Squad.Read(FrameData);
        Assert.ok(Read, `inner header ${Inner}`);
        Assert.strictEqual(Read.Command, Squad.Command.Invite);
        Assert.strictEqual(Read.User, 0x0110000110ccc7e2n);
    }
});

Test('a command that is not a squad command is left alone', () => {
    const Body = new FieldList.Builder().AddU32('COMMAND', 0x5bb78c48).Build();
    const FrameData = Frame.Build(Squad.CommandPacket, Buffer.alloc(8), Body, Frame.InnerHeader.Pending);
    Assert.strictEqual(Squad.Read(FrameData), null, 'start connection is not a squad command');
    Assert.strictEqual(Squad.Handle({ Identifier: 'x' }, FrameData), false);
});

Test('an invite is delivered in the invitee PLAYER fields 97..101', () => {
    const { A, B, Inbox } = Pair();
    Assert.strictEqual(Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid)), true);
    Assert.ok(B.PendingInvites.has(A.Puid), 'the invite is held against the invitee');
    Assert.strictEqual(Inbox.length, 1, 'the invitee receives its changed PLAYER object');

    const DecodedWs = Websocket.Decode(Inbox[0]);
    const ObjectValue = DecodedWs.Messages[0].Payload;
    Assert.strictEqual(ObjectValue.readUInt32BE(4), PlayerObject.ObjectDataPacket);
    const Body = ObjectValue.subarray(ObjectFrame.Layout.Nineteen.Payload);
    const Parsed = PlayerBody.Decode(Body);
    Assert.ok(Parsed.Ok, Parsed.Reason);
    Assert.strictEqual(
        Body.readBigUInt64LE(Parsed.Offsets.get(97)),
        A.Puid,
        'first native incoming-invite slot contains the inviter',
    );
    for (const Field of [98, 99, 100, 101]) {
        Assert.strictEqual(Body.readBigUInt64LE(Parsed.Offsets.get(Field)), 0n, `unused invite slot ${Field} is clear`);
    }
});

Test('an invite to somebody absent is reported, not sent into the void', () => {
    const { A, Inbox } = Pair();
    const Before = Inbox.length;
    Assert.strictEqual(Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', 0x99n)), true);
    Assert.strictEqual(Inbox.length, Before, 'nothing was delivered');
});

function Frames(Sink) {
    const Out = [];
    for (const Chunk of Sink) for (const M of Websocket.Decode(Chunk).Messages) Out.push(M.Payload);
    return Out;
}

function SquadObjects(Sink) {
    return Frames(Sink).filter(
        (F) =>
            F.length >= ObjectFrame.Layout.Nineteen.Payload &&
            F.readUInt32BE(4) === PlayerObject.ObjectDataPacket &&
            F.readUInt32BE(ObjectFrame.Layout.Nineteen.Class) === Squad.SquadClass,
    );
}

function Destroys(Sink) {
    return Frames(Sink).filter((F) => F.readUInt32BE(4) === PlayerObject.ObjectDestroyPacket);
}

function PlayerFrames(Sink, Puid) {
    return Frames(Sink).filter(
        (F) =>
            F.length >= ObjectFrame.Layout.Nineteen.Payload &&
            F.readUInt32BE(4) === PlayerObject.ObjectDataPacket &&
            F.readUInt32BE(ObjectFrame.Layout.Nineteen.Class) === PlayerObject.PlayerClass &&
            F.readBigUInt64BE(ObjectFrame.Layout.Nineteen.ObjectId) === Puid,
    );
}

function LastPlayerBody(Sink, Puid) {
    const FrameList = PlayerFrames(Sink, Puid);
    Assert.ok(FrameList.length, 'a PLAYER object was published for ' + Puid.toString(16));
    return FrameList[FrameList.length - 1].subarray(ObjectFrame.Layout.Nineteen.Payload);
}

function DecodeSquad(FrameData) {
    const PayloadValue = FrameData.subarray(ObjectFrame.Layout.Nineteen.Payload);
    const Key = PayloadValue.readBigUInt64BE(0);
    const Version = PayloadValue.readBigUInt64BE(8);
    const Bits = ObjectFrame.ReadFlags(PayloadValue, 16, Squad.SquadFlags);
    let At = 16 + ObjectFrame.FlagBytes(Squad.SquadFlags);
    const Values = new Map();
    for (const Bit of Bits) {
        const Width = Bit >= 10 && Bit <= 15 ? 4 : 8;
        Values.set(Bit, Width === 8 ? PayloadValue.readBigUInt64LE(At) : BigInt(PayloadValue.readUInt32LE(At)));
        At += Width;
    }
    Assert.strictEqual(At, PayloadValue.length, 'the values close the payload exactly');
    return { key: Key, version: Version, Bits, Values };
}

function Known(A, B) {
    A.KnownPlayers = new Set([B.Id]);
    B.KnownPlayers = new Set([A.Id]);
}

Test('the NBA2K19 squad object has 18 presence bits', () => {
    Assert.strictEqual(ObjectFrame.ClassForLayout(0x8033af3b, ObjectFrame.Layout.Nineteen).Flags, 18);
    Assert.strictEqual(Squad.SquadFlags, 18);
});

Test('accepting forms a squad object and writes field 96 on both players', () => {
    Squad.Reset();
    const { A, B, Inbox, Sent } = Pair();
    Known(A, B);
    Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid));
    Inbox.length = 0;
    Sent.length = 0;

    Assert.strictEqual(Squad.Handle(B, CommandFrame(Squad.Command.Accept, 'FROM', A.Puid)), true);
    const SquadData = Squad.SquadOf(A.Puid);
    Assert.ok(SquadData, 'the inviter is in a squad');
    Assert.strictEqual(Squad.SquadOf(B.Puid), SquadData, 'and the invitee is in the same one');

    for (const Sink of [Inbox, Sent]) {
        const Objects = SquadObjects(Sink);
        Assert.ok(Objects.length >= 1, 'each player receives the squad object');
        const Decoded = DecodeSquad(Objects[Objects.length - 1]);
        Assert.strictEqual(Decoded.key, SquadData.Id);
        Assert.deepStrictEqual(Decoded.Bits, [0, 1, 5, 6], 'slots 0..1 and 5..6 are present');
        Assert.deepStrictEqual([Decoded.Values.get(0), Decoded.Values.get(1)], [A.Puid, B.Puid]);
        Assert.deepStrictEqual([Decoded.Values.get(5), Decoded.Values.get(6)], [A.Puid, B.Puid]);
    }
    for (const [Sink, Who] of [
        [Inbox, B],
        [Sent, A],
        [Inbox, A],
        [Sent, B],
    ]) {
        const Body = LastPlayerBody(Sink, Who.Puid);
        Assert.strictEqual(
            PlayerBody.ReadU64Field(Body, PlayerBody.Field.SquadId),
            SquadData.Id,
            'field 96 names the squad object',
        );
    }
    const Invitee = LastPlayerBody(Inbox, B.Puid);
    for (const Field of PlayerBody.Field.SquadInvites) {
        Assert.strictEqual(PlayerBody.ReadU64Field(Invitee, Field), 0n, 'the accepted invite slot was cleared');
    }
    const FrameList = Frames(Inbox);
    const ObjectAt = FrameList.findIndex((F) => F.readUInt32BE(ObjectFrame.Layout.Nineteen.Class) === Squad.SquadClass);
    const FieldAt = FrameList.findIndex(
        (F) =>
            F.readUInt32BE(ObjectFrame.Layout.Nineteen.Class) === PlayerObject.PlayerClass &&
            PlayerBody.ReadU64Field(F.subarray(ObjectFrame.Layout.Nineteen.Payload), PlayerBody.Field.SquadId) ===
                SquadData.Id,
    );
    Assert.ok(ObjectAt >= 0 && ObjectAt < FieldAt, 'the squad object arrives before the PLAYER object that names it');
});

Test('an acceptance without a delivered invite forms nothing', () => {
    Squad.Reset();
    const { A, B } = Pair();
    Assert.strictEqual(Squad.Handle(B, CommandFrame(Squad.Command.Accept, 'FROM', A.Puid)), true);
    Assert.strictEqual(Squad.SquadOf(A.Puid), null);
    Assert.strictEqual(Squad.SquadOf(B.Puid), null);
});

Test('leaving a two-player squad destroys the object and clears field 96 for both', () => {
    Squad.Reset();
    const { A, B, Inbox, Sent } = Pair();
    Known(A, B);
    Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid));
    Squad.Handle(B, CommandFrame(Squad.Command.Accept, 'FROM', A.Puid));
    const Id = Squad.SquadOf(A.Puid).Id;
    Inbox.length = 0;
    Sent.length = 0;

    Assert.strictEqual(Squad.Handle(B, CommandFrame(Squad.Command.Leave, null, null)), true);
    Assert.strictEqual(Squad.SquadOf(A.Puid), null);
    Assert.strictEqual(Squad.SquadOf(B.Puid), null);
    for (const [Sink, Self] of [
        [Inbox, B],
        [Sent, A],
    ]) {
        const DestroyList = Destroys(Sink);
        Assert.strictEqual(DestroyList.length, 1, 'HandleObjectDestroyPacket gets the squad id');
        Assert.strictEqual(DestroyList[0].readBigUInt64BE(DestroyList[0].length - 8), Id);
        Assert.strictEqual(PlayerBody.ReadU64Field(LastPlayerBody(Sink, Self.Puid), PlayerBody.Field.SquadId), 0n);
    }
});

Test('a third player joins the same squad and a later leave keeps the other two', () => {
    Squad.Reset();
    const { A, B } = Pair();
    const Third = [];
    const C = new Connection(Socket(Third), {}, 20054);
    C.Puid = 0x01100001aabbccddn;
    C.ActivityKey = A.ActivityKey;
    C.State = State.Active;
    C.MachineId = 0x68fcn;
    C.PlayerBody = BodyFor(C.Puid);
    Roster.Add(C);
    Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid));
    Squad.Handle(B, CommandFrame(Squad.Command.Accept, 'FROM', A.Puid));
    Squad.Handle(B, CommandFrame(Squad.Command.Invite, 'USER', C.Puid));
    Squad.Handle(C, CommandFrame(Squad.Command.Accept, 'FROM', B.Puid));
    const SquadData = Squad.SquadOf(A.Puid);
    Assert.deepStrictEqual(SquadData.Members, [A.Puid, B.Puid, C.Puid]);
    const Version = SquadData.Version;
    Third.length = 0;

    Squad.Handle(A, CommandFrame(Squad.Command.Leave, null, null));
    Assert.deepStrictEqual(SquadData.Members, [B.Puid, C.Puid]);
    const Decoded = DecodeSquad(SquadObjects(Third).pop());
    Assert.ok(Decoded.version > Version, 'the squad object is re-sent at a higher version');
    Assert.deepStrictEqual(Decoded.Bits, [0, 1, 5, 6]);
    Assert.deepStrictEqual([Decoded.Values.get(5), Decoded.Values.get(6)], [B.Puid, C.Puid]);
});

Test('client partials cannot overwrite the squad fields', () => {
    Assert.ok(PlayerObject.ServerOwnedFields.has(96));
    for (const Field of [97, 98, 99, 100, 101]) Assert.ok(PlayerObject.ServerOwnedFields.has(Field));
});

Test('a re-handshake gets its squad id and the squad object back', () => {
    Squad.Reset();
    const { A, B, Inbox } = Pair();
    Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid));
    Squad.Handle(B, CommandFrame(Squad.Command.Accept, 'FROM', A.Puid));
    const Id = Squad.SquadOf(B.Puid).Id;
    Inbox.length = 0;
    B.PlayerBody = BodyFor(B.Puid);
    Squad.Reapply(B);
    Assert.strictEqual(PlayerBody.ReadU64Field(B.PlayerBody, PlayerBody.Field.SquadId), Id);
    Assert.strictEqual(SquadObjects(Inbox).length, 1, 'the squad object is replayed to the rejoining player');
});

Test('a departed inviter is withdrawn from invite slots', () => {
    Squad.Reset();
    const { A, B, Inbox } = Pair();
    Squad.Handle(A, CommandFrame(Squad.Command.Invite, 'USER', B.Puid));
    Inbox.length = 0;
    Roster.Remove(A);
    Squad.Disconnect(A);
    Assert.strictEqual(B.PendingInvites.has(A.Puid), false);
    Assert.strictEqual(PlayerBody.ReadU64Field(LastPlayerBody(Inbox, B.Puid), 97), 0n);
});

Test('squad constants resolve by name in a log line', () => {
    Assert.strictEqual(Describe(Squad.Command.Invite), 'SquadInvite');
    Assert.strictEqual(Describe(Squad.Command.Accept), 'SquadAccept');
    Assert.strictEqual(Describe(Squad.Command.Leave), 'SquadLeave');
    Assert.strictEqual(Describe(Crc('FROM')), 'From');
});

process.stdout.write(`\n${Passed} passing\n`);
