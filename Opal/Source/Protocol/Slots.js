// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const Packets = require('./Packets');
const ObjectFrame = require('../Codec/ObjectFrame');

const SlotClass = 0x90acaee4;
const DataPacket = Packets.Wire('OBJECT_DATA');

const MaxSeats = 5;

const Flags = 8;
const Field = {
    Name: 0,
    SeatCount: 1,
    Seats: 2,
};

const SeatEndian = 'LE';

const Occupancy = new Map();

function StateFor(SlotId, Seats = 1) {
    let State = Occupancy.get(SlotId);
    if (!State) {
        State = {
            Seats: new Array(Math.max(1, Math.min(MaxSeats, Seats))).fill(0n),
            Revision: 1n,
        };
        Occupancy.set(SlotId, State);
    }
    return State;
}

function Release(PlayerId, Except) {
    const Touched = [];
    if (!PlayerId) return Touched;

    for (const [SlotId, State] of Occupancy) {
        if (Except !== undefined && SlotId === Except) continue;
        let Hit = false;
        for (let I = 0; I < State.Seats.length; I++) {
            if (State.Seats[I] === PlayerId) {
                State.Seats[I] = 0n;
                Hit = true;
            }
        }
        if (Hit) Touched.push(SlotId);
    }
    return Touched;
}

function ReleaseFrom(SlotId, PlayerId) {
    const State = Occupancy.get(SlotId);
    if (!State || !PlayerId) return false;
    let Hit = false;
    for (let I = 0; I < State.Seats.length; I++) {
        if (State.Seats[I] !== PlayerId) continue;
        State.Seats[I] = 0n;
        Hit = true;
    }
    return Hit;
}

function Occupy(SlotId, PlayerId, Seats, Preferred = -1) {
    if (!PlayerId) return null;
    const State = StateFor(SlotId, Seats);
    const Freed = Release(PlayerId, SlotId);

    for (let I = 0; I < State.Seats.length; I++) {
        if (State.Seats[I] === PlayerId) State.Seats[I] = 0n;
    }

    let Index = -1;
    if (Preferred >= 0 && Preferred < State.Seats.length && State.Seats[Preferred] === 0n) {
        Index = Preferred;
    } else {
        Index = State.Seats.findIndex((S) => S === 0n);
    }
    if (Index < 0) return null;

    State.Seats[Index] = PlayerId;
    return { Index: Index, Freed: Freed };
}

function SeatsOf(SlotId) {
    const State = Occupancy.get(SlotId);
    return State ? State.Seats.slice() : [];
}

function Forget() {
    Occupancy.clear();
}

function BuildBody(SlotId, Name, Seats, Revision) {
    const Head = Buffer.alloc(16);
    Head.writeBigUInt64BE(BigInt.asUintN(64, SlotId), 0);
    Head.writeBigUInt64BE(BigInt.asUintN(64, Revision), 8);

    const Indices = [Field.Name, Field.SeatCount];
    for (let I = 0; I < MaxSeats; I++) Indices.push(Field.Seats + I);
    const Bitmap = ObjectFrame.WriteFlags(Indices, Flags);

    const Values = Buffer.alloc(4 + 1 + MaxSeats * 8);
    Values.writeUInt32LE(Name >>> 0, 0);
    Values.writeUInt8(Math.min(Seats.length, MaxSeats), 4);
    for (let I = 0; I < Seats.length && I < MaxSeats; I++) {
        Values.writeBigUInt64LE(BigInt.asUintN(64, Seats[I]), 5 + I * 8);
    }

    return Buffer.concat([Head, Bitmap, Values]);
}

function Build(Group, Revision) {
    const State = StateFor(Group.SlotObjectId, Group.Anchors.length);
    return ObjectFrame.Build({
        PacketId: DataPacket,
        ConnectionId: null,
        ObjectId: Group.SlotObjectId,
        ClassCrc: SlotClass,
        Payload: BuildBody(
            Group.SlotObjectId,
            Group.SlotName,
            State.Seats,
            Revision === undefined ? State.Revision : Revision,
        ),
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function Publish(Connection, Group) {
    const State = StateFor(Group.SlotObjectId, Group.Anchors.length);
    State.Revision += 1n;
    return Connection.SendObject(Build(Group, State.Revision));
}

module.exports = {
    SlotClass,
    DataPacket,
    MaxSeats,
    Flags,
    Field,
    SeatEndian,
    Occupancy,
    StateFor,
    Occupy,
    Release,
    ReleaseFrom,
    SeatsOf,
    Forget,
    BuildBody,
    Build,
    Publish,
};
