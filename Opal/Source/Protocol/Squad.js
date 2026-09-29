// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Crc } = require('../Core/Names');
const FieldList = require('../Codec/FieldList');
const Frame = require('../Codec/Frame');
const ObjectFrame = require('../Codec/ObjectFrame');
const Roster = require('./Roster');
const PlayerBody = require('./PlayerBody');
const PlayerObject = require('./PlayerObject');

const CommandPacket = 0xce148fb1;

const Command = {
    Invite: Crc('SQUAD_INVITE'),
    Accept: Crc('SQUAD_ACCEPT'),
    Leave: Crc('SQUAD_LEAVE'),
};

const SquadClass = 0x8033af3b;
const SquadFlags = 18;
const MaxMembers = 5;
const Bits = Object.freeze({ PlayerId: 0, MemberKey: 5 });

const SquadIdPrefix = 0x53514144n << 32n;

const DepartureGraceMs = 60000;

const Squads = new Map();
const Membership = new Map();
const Departures = new Map();
let NextSquad = 1n;

const Key = (Value) => BigInt.asUintN(64, BigInt(Value)).toString(16).padStart(16, '0');
const IsSquadCommand = (Value) => Object.values(Command).includes(Value >>> 0);

function Read(Bytes) {
    const CommandData = FieldList.Scan(Bytes, 'COMMAND');
    if (!CommandData || !IsSquadCommand(CommandData.Data1)) return null;

    const User = FieldList.Scan(Bytes, 'USER');
    const From = FieldList.Scan(Bytes, 'FROM');
    return {
        Command: CommandData.Data1 >>> 0,
        User: User ? (User.Value !== undefined ? User.Value : BigInt(User.Data1 >>> 0)) : null,
        From: From ? (From.Value !== undefined ? From.Value : BigInt(From.Data1 >>> 0)) : null,
    };
}

function FindByPuid(Connection, Puid) {
    if (Puid === null) return null;
    return Roster.Peers(Connection).find((P) => P.Puid !== null && P.Puid === Puid) || null;
}

function ActiveByPuid(Puid) {
    return Roster.Active().find((C) => C.Puid !== null && C.Puid === Puid) || null;
}

function SquadOf(Puid) {
    if (Puid === null || Puid === undefined) return null;
    const Id = Membership.get(Key(Puid));
    return Id === undefined ? null : Squads.get(Key(Id)) || null;
}

function BuildObject(Squad) {
    const Members = Squad.Members.slice(0, MaxMembers);
    const BitsValue = [];
    const Values = [];
    Members.forEach((Puid, I) => {
        BitsValue.push(Bits.PlayerId + I);
        const Value = Buffer.alloc(8);
        Value.writeBigUInt64LE(BigInt.asUintN(64, Puid));
        Values.push(Value);
    });
    Members.forEach((Puid, I) => {
        BitsValue.push(Bits.MemberKey + I);
        const Value = Buffer.alloc(8);
        Value.writeBigUInt64LE(BigInt.asUintN(64, Puid));
        Values.push(Value);
    });
    const Head = Buffer.alloc(ObjectFrame.Body.Flags);
    Head.writeBigUInt64BE(Squad.Id, ObjectFrame.Body.Key);
    Head.writeBigUInt64BE(Squad.Version, ObjectFrame.Body.Version);
    const Payload = Buffer.concat([Head, ObjectFrame.WriteFlags(BitsValue, SquadFlags), ...Values]);
    return ObjectFrame.Build({
        PacketId: PlayerObject.ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Squad.Id,
        ClassCrc: SquadClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function BuildDestroy(Id) {
    const Body = Buffer.alloc(8);
    Body.writeBigUInt64BE(BigInt.asUintN(64, Id));
    return Frame.Build(PlayerObject.ObjectDestroyPacket, null, Body, Frame.InnerHeader.None);
}

function Audience(Puids) {
    const Seen = new Map();
    for (const Puid of Puids) {
        const Member = ActiveByPuid(Puid);
        if (!Member) continue;
        for (const C of Roster.InActivity(Member.ActivityKey, Member.RoomScope || null)) Seen.set(C.Id, C);
    }
    return [...Seen.values()];
}

function SendSquad(Squad, Recipients) {
    const FrameData = BuildObject(Squad);
    let Sent = 0;
    for (const C of Recipients) if (C.SendObject(FrameData)) Sent++;
    return Sent;
}

function PublishMembership(Connection) {
    if (!Connection || !Connection.PlayerBody) return false;
    const Squad = SquadOf(Connection.Puid);
    const Patched = PlayerBody.SetSquadId(Connection.PlayerBody, Squad ? Squad.Id : 0n);
    if (!Patched.Ok) {
        Log.Error(`${Connection.Identifier}: squad field 96 was not updated: ${Patched.Reason}`);
        return false;
    }
    Connection.PlayerBody = Patched.Body;
    PlayerObject.BestBodies.set(Key(Connection.Puid), Patched.Body);
    const FrameData = PlayerObject.FrameFor(Connection);
    if (!FrameData) return false;
    Connection.SendObject(FrameData);
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer.KnownPlayers && Peer.KnownPlayers.has(Connection.Id)) Peer.SendObject(FrameData);
    }
    return true;
}

function PublishInvites(Connection) {
    if (!Connection || !Connection.PlayerBody) return false;
    const Patched = PlayerBody.SetSquadInvites(Connection.PlayerBody, Connection.PendingInvites);
    if (!Patched.Ok) {
        Log.Error(`${Connection.Identifier}: squad invite fields were not updated: ${Patched.Reason}`);
        return false;
    }
    Connection.PlayerBody = Patched.Body;
    if (Connection.Puid !== null && Connection.Puid !== undefined) {
        PlayerObject.BestBodies.set(Key(Connection.Puid), Patched.Body);
    }
    const FrameData = PlayerObject.FrameFor(Connection);
    return Boolean(FrameData && Connection.SendObject(FrameData));
}

function Create(Founder) {
    const Id = SquadIdPrefix | NextSquad++;
    const Squad = { Id: Id, Members: [Founder], Version: 1n };
    Squads.set(Key(Id), Squad);
    Membership.set(Key(Founder), Id);
    return Squad;
}

function RemoveMember(Squad, Puid) {
    const AudienceList = Audience([...Squad.Members]);
    Squad.Members = Squad.Members.filter((M) => M !== Puid);
    Membership.delete(Key(Puid));
    const Leaver = ActiveByPuid(Puid);

    if (Squad.Members.length < 2) {
        Squads.delete(Key(Squad.Id));
        const Remaining = Squad.Members.map(ActiveByPuid).filter(Boolean);
        for (const M of Squad.Members) Membership.delete(Key(M));
        Squad.Members = [];
        const Destroy = BuildDestroy(Squad.Id);
        for (const C of AudienceList) C.SendObject(Destroy);
        if (Leaver) PublishMembership(Leaver);
        for (const C of Remaining) PublishMembership(C);
        Log.Info(`squad ${Key(Squad.Id).toUpperCase()} dissolved @ ${Log.Clock()}`);
        return;
    }

    Squad.Version += 1n;
    SendSquad(Squad, AudienceList);
    if (Leaver) PublishMembership(Leaver);
    Log.Info(
        `${Key(Puid).toUpperCase()} left squad ${Key(Squad.Id).toUpperCase()}, ` +
            `${Squad.Members.length} remain @ ${Log.Clock()}`,
    );
}

function Join(Inviter, Invitee) {
    let Squad = SquadOf(Inviter.Puid);
    if (Squad && Squad.Members.includes(Invitee.Puid)) return Squad;
    if (Squad && Squad.Members.length >= MaxMembers) {
        Log.Error(`${Invitee.Identifier} accepted ${Inviter.Identifier}'s invite, but that squad is full.`);
        return null;
    }
    const Previous = SquadOf(Invitee.Puid);
    if (Previous && Previous !== Squad) RemoveMember(Previous, Invitee.Puid);
    if (!Squad) Squad = Create(Inviter.Puid);

    Squad.Members.push(Invitee.Puid);
    Membership.set(Key(Invitee.Puid), Squad.Id);
    Squad.Version += 1n;

    const AudienceList = Audience(Squad.Members);
    SendSquad(Squad, AudienceList);
    for (const Puid of Squad.Members) {
        const Member = ActiveByPuid(Puid);
        if (Member) PublishMembership(Member);
    }
    return Squad;
}

function Handle(Connection, Bytes) {
    const Squad = Read(Bytes);
    if (!Squad) return false;

    if (Squad.Command === Command.Invite) return Invite(Connection, Squad);
    if (Squad.Command === Command.Accept) return Accept(Connection, Squad);
    if (Squad.Command === Command.Leave) return Leave(Connection);
    return false;
}

function Invite(Connection, Squad) {
    const Target = FindByPuid(Connection, Squad.User);
    if (!Target) {
        Log.Error(
            `${Connection.Identifier} invited ${Squad.User === null ? 'nobody' : Squad.User.toString(16).toUpperCase()} ` +
                `to a squad, who is not in ${Connection.Activity}.`,
        );
        return true;
    }

    Target.PendingInvites.add(Connection.Puid);
    const Delivered = PublishInvites(Target);
    if (Delivered) {
        Log.Info(
            `${Connection.Identifier} invited ${Target.Identifier} to a squad; ` +
                `PLAYER fields 97..101 were delivered @ ${Log.Clock()}`,
        );
    } else {
        Log.Error(`squad invite for ${Target.Identifier} could not be written to its PLAYER object.`);
    }
    return true;
}

function Accept(Connection, Squad) {
    const Inviter = FindByPuid(Connection, Squad.From);
    if (!Inviter) {
        Log.Error(
            `${Connection.Identifier} accepted a squad invite from ` +
                `${Squad.From === null ? 'nobody' : Squad.From.toString(16).toUpperCase()}, ` +
                `who is not in ${Connection.Activity}.`,
        );
        return true;
    }
    if (!Connection.PendingInvites.has(Inviter.Puid)) {
        Log.Error(
            `${Connection.Identifier} accepted a squad invite from ${Inviter.Identifier} ` +
                `that this server never delivered; ignored.`,
        );
        return true;
    }

    Connection.PendingInvites.delete(Inviter.Puid);
    PublishInvites(Connection);

    const Joined = Join(Inviter, Connection);
    if (Joined) {
        Log.Info(
            `${Connection.Identifier} joined ${Inviter.Identifier}'s squad ` +
                `${Key(Joined.Id).toUpperCase()} (${Joined.Members.length} players) @ ${Log.Clock()}`,
        );
    }
    return true;
}

function Leave(Connection) {
    const Squad = SquadOf(Connection.Puid);
    if (!Squad) {
        PublishMembership(Connection);
        Log.Info(`${Connection.Identifier} left a squad this server does not hold @ ${Log.Clock()}`);
        return true;
    }
    RemoveMember(Squad, Connection.Puid);
    return true;
}

function Reapply(Connection) {
    if (!Connection || !Connection.PlayerBody || Connection.Puid === null) return;
    const Departure = Departures.get(Key(Connection.Puid));
    if (Departure) {
        clearTimeout(Departure);
        Departures.delete(Key(Connection.Puid));
    }
    const Squad = SquadOf(Connection.Puid);
    const Body = Connection.PlayerBody;
    const HasSquadField = PlayerBody.IsPresent(Body, PlayerBody.Field.SquadId);
    if (Squad || HasSquadField) {
        const Patched = PlayerBody.SetSquadId(Body, Squad ? Squad.Id : 0n);
        if (Patched.Ok) Connection.PlayerBody = Patched.Body;
    }
    if (Connection.PendingInvites && Connection.PendingInvites.size) {
        const Patched = PlayerBody.SetSquadInvites(Connection.PlayerBody, Connection.PendingInvites);
        if (Patched.Ok) Connection.PlayerBody = Patched.Body;
    }
    ReplayTo(Connection);
}

function ReplayTo(Connection) {
    let Sent = 0;
    for (const Squad of Squads.values()) {
        const Visible = Squad.Members.some((Puid) => {
            if (Puid === Connection.Puid) return true;
            const Member = ActiveByPuid(Puid);
            return (
                Member &&
                Member.ActivityKey === Connection.ActivityKey &&
                (Member.RoomScope || null) === (Connection.RoomScope || null)
            );
        });
        if (Visible && Connection.SendObject(BuildObject(Squad))) Sent++;
    }
    return Sent;
}

function Disconnect(Connection) {
    if (!Connection || Connection.Puid === null || Connection.Puid === undefined) return;
    const Puid = Connection.Puid;

    for (const Other of Roster.Active()) {
        if (Other === Connection || !Other.PendingInvites || !Other.PendingInvites.has(Puid)) continue;
        Other.PendingInvites.delete(Puid);
        PublishInvites(Other);
    }

    if (!SquadOf(Puid)) return;
    const Previous = Departures.get(Key(Puid));
    if (Previous) clearTimeout(Previous);
    const Timer = setTimeout(() => {
        Departures.delete(Key(Puid));
        if (ActiveByPuid(Puid)) return;
        const Squad = SquadOf(Puid);
        if (Squad) RemoveMember(Squad, Puid);
    }, DepartureGraceMs);
    if (Timer.unref) Timer.unref();
    Departures.set(Key(Puid), Timer);
}

function Reset() {
    for (const Timer of Departures.values()) clearTimeout(Timer);
    Departures.clear();
    Squads.clear();
    Membership.clear();
    NextSquad = 1n;
}

module.exports = {
    CommandPacket,
    Command,
    IsSquadCommand,
    SquadClass,
    SquadFlags,
    MaxMembers,
    Bits,
    DepartureGraceMs,
    Squads,
    Membership,
    Read,
    Handle,
    Invite,
    Accept,
    Leave,
    Join,
    RemoveMember,
    BuildObject,
    BuildDestroy,
    PublishInvites,
    PublishMembership,
    SquadOf,
    Reapply,
    ReplayTo,
    Disconnect,
    Reset,
};
