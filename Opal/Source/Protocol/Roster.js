// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Players = new Map();

const MachineIdBase = 0x68fan;

const SyntheticPuidBase = 0x0110000100001000n;

function MachineIdFor(ConnectionId) {
    return MachineIdBase + BigInt(ConnectionId - 1);
}

function CollisionFor(Connection, Puid, ActivityKey = Connection.ActivityKey) {
    if (Puid === null || Puid === undefined) return null;
    return (
        Active().find((C) => C.Id !== Connection.Id && C.ActivityKey === ActivityKey >>> 0 && C.Puid === Puid) || null
    );
}

function AssignPuid(Connection, Claimed, ActivityKey = Connection.ActivityKey) {
    if (Claimed === null || Claimed === undefined) {
        return { Puid: Connection.Puid, Collision: null, Rewritten: false };
    }

    const Value = BigInt.asUintN(64, BigInt(Claimed));
    if (Connection.ClaimedPuid === null || Connection.ClaimedPuid === undefined) {
        Connection.ClaimedPuid = Value;
    }

    if (Connection.Puid !== null && Connection.Puid !== undefined) {
        return { Puid: Connection.Puid, Collision: null, Rewritten: Connection.Puid !== Value };
    }

    const Collision = CollisionFor(Connection, Value, ActivityKey);
    let Assigned = Value;
    if (Collision) {
        Assigned = SyntheticPuidBase + BigInt(Connection.Id - 1);
        while (CollisionFor(Connection, Assigned, ActivityKey)) Assigned += 1n;
    }
    Connection.Puid = Assigned;
    return { Puid: Assigned, Collision: Collision, Rewritten: Assigned !== Value };
}

function Add(Connection) {
    Players.set(Connection.Id, Connection);
}

function Remove(Connection) {
    Players.delete(Connection.Id);
}

function Active() {
    return [...Players.values()].filter((C) => !C.Closed && C.State === 2);
}

function InActivity(ActivityKey, RoomScope = undefined) {
    if (ActivityKey === null || ActivityKey === undefined) return [];
    return Active().filter(
        (C) =>
            C.ActivityKey === ActivityKey >>> 0 &&
            (RoomScope === undefined || (C.RoomScope || null) === (RoomScope || null)),
    );
}

function Peers(Connection) {
    return InActivity(Connection.ActivityKey, Connection.RoomScope || null).filter((C) => C.Id !== Connection.Id);
}

function EntriesFor(ActivityKey, Including = null, RoomScope = undefined) {
    const Members = InActivity(ActivityKey, RoomScope);
    if (Including && !Members.some((C) => C.Id === Including.Id)) Members.push(Including);
    const { Packaged } = require('./Userdata');
    return Members.map((C) => ({
        AccountId: C.Puid !== null ? C.Puid : C.MachineId,
        MachineId: C.MachineId,
        TeamId: C.TeamId || 0n,
        Gamertag: C.Gamertag || '',
        Userdata: Packaged(C),
        Connection: C,
    }));
}

function Count() {
    return Players.size;
}

module.exports = {
    Players,
    MachineIdBase,
    SyntheticPuidBase,
    MachineIdFor,
    CollisionFor,
    AssignPuid,
    Add,
    Remove,
    Active,
    InActivity,
    Peers,
    EntriesFor,
    Count,
};
