// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Log = require('../Source/Core/Log');
const { Crc } = require('../Source/Core/Names');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const ObjectFrame = require('../Source/Codec/ObjectFrame');
const WebSocket = require('../Source/Net/Websocket');
const Roster = require('../Source/Protocol/Roster');
const MyCourt = require('../Source/Protocol/MyCourt');
const Squad = require('../Source/Protocol/Squad');
const { Connection, State, OnConnect } = require('../Source/Protocol/Connection');

Log.SetLevel(Log.Level.Error);

const CapturedMatchType = 0x0ad66d71ca210651n;

function FakeSocket(Sink) {
    return { destroyed: false, localAddress: '127.0.0.1', write: (B) => Sink.push(B), end() {}, destroy() {} };
}

function MyCourtConnect(Puid) {
    const Body = new FieldList.Builder()
        .AddU64('MATCH_TYPE', CapturedMatchType)
        .AddU64('USER_ID_LIST', Puid)
        .AddU32(0x4b7ad8c3, 0xfeac4070)
        .AddU32('LOCATION', Crc('CRIB'))
        .Build();
    return Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);
}

function Enter(Puid, Sink) {
    const C = new Connection(FakeSocket(Sink), {}, 20054);
    const FrameData = MyCourtConnect(Puid);
    OnConnect(C, Frame.Parse(FrameData), FrameData);
    return C;
}

function Payloads(Sink) {
    const Out = [];
    for (const Wire of Sink) for (const M of WebSocket.Decode(Wire).Messages) Out.push(M.Payload);
    return Out;
}

function Inits(Sink) {
    return Payloads(Sink).filter((P) => P.length >= 8 && P.readUInt32BE(4) === 0x9d32c5b4);
}

function Token(Init) {
    const List = FieldList.Parse(Init, Frame.HeaderSize);
    const Reference = FieldList.Find(List, 0xae6eea84);
    Assert.ok(Reference, 'the init reply names its relay token');
    const Data = List.Payload.subarray(List.DataOffset);
    return Data.subarray(Reference.Data1 >>> 0, (Reference.Data1 >>> 0) + (Reference.Data2 >>> 0));
}

Test('two players entering MyCourt get separate rooms, rosters and relay tokens', (T) => {
    Roster.Players.clear();
    MyCourt.Rooms.clear();
    MyCourt.RoomStates.clear();
    T.after(() => {
        Roster.Players.clear();
        MyCourt.Rooms.clear();
        MyCourt.RoomStates.clear();
    });
    const First = [],
        Second = [];
    const A = Enter(0x0110000100000001n, First);
    const B = Enter(0x0110000100000002n, Second);

    Assert.equal(A.State, State.Active);
    Assert.equal(B.State, State.Active);
    Assert.equal(A.ActivityName, 'mycourt');
    Assert.notEqual(A.RoomScope, B.RoomScope);
    Assert.deepEqual(Roster.Peers(A), [], 'nobody else is in the first court');
    Assert.deepEqual(Roster.Peers(B), [], 'nobody else is in the second court');

    const AInits = Inits(First);
    const BInits = Inits(Second);
    Assert.equal(AInits.length, 1, 'the first player is not re-sent a roster when the second enters their own court');
    for (const [Init, Puid] of [
        [AInits[0], 0x0110000100000001n],
        [BInits[0], 0x0110000100000002n],
    ]) {
        const Users = FieldList.Parse(Init, Frame.HeaderSize).Fields.filter((F) => F.Crc === Crc('USER_ID_LIST'));
        Assert.deepEqual(
            Users.map((F) => F.Value),
            [Puid],
            'each roster names only its owner',
        );
    }
    Assert.ok(!Token(AInits[0]).equals(Token(BInits[0])), 'the relay groups the two courts separately');
    Assert.equal(Token(AInits[0]).length, 16);
});

Test('a room object from one court never reaches another court', (T) => {
    Roster.Players.clear();
    MyCourt.Rooms.clear();
    T.after(() => {
        Roster.Players.clear();
        MyCourt.Rooms.clear();
    });
    const First = [],
        Second = [];
    const A = Enter(0x0110000100000011n, First);
    const B = Enter(0x0110000100000012n, Second);
    const Payload = ObjectFrame.BuildPayload({
        key: 0xaa01n,
        version: 1n,
        ClassCrc: MyCourt.RoomClass,
        Bits: [],
        Values: Buffer.alloc(0),
    });
    const Room = ObjectFrame.Build({
        PacketId: MyCourt.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: 0xaa01n,
        ClassCrc: MyCourt.RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
    Second.length = 0;

    Assert.ok(MyCourt.Relay(A, Room, MyCourt.ObjectDataPacket));
    Assert.equal(Payloads(Second).filter((P) => P.equals(Room)).length, 0, 'the other owner did not receive it');
    Assert.equal(MyCourt.ReplayTo(B), 0, 'and it is not replayed into their court');
    Assert.equal(MyCourt.ReplayTo(A), 1, 'the owner still gets their own room back');
});

Test('the same player reconnecting lands in the same court', (T) => {
    Roster.Players.clear();
    T.after(() => {
        Roster.Players.clear();
        Squad.Reset();
    });
    const A = Enter(0x0110000100000021n, []);
    const Scope = A.RoomScope;
    A.Close('test');
    const Again = Enter(0x0110000100000021n, []);
    Assert.equal(Again.RoomScope, Scope);
});
