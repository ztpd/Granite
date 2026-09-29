// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const Roster = require('./Roster');
const ObjectFrame = require('../Codec/ObjectFrame');

const PositionClass = 0x36bf2a26;
const UpdateListPacket = 0x618ec78c;
const ObjectDataPacket = 0x9c72247c;
const MovementPacket = 0xce1c9e8c;

const EnableCreate = false;
const CreateResendMs = Math.max(0, Number(process.env.OPAL_MOVEMENT_CREATE_RESEND_MS) || 0);

const Entry = { Count: 16, Class: 17, Span: 21, Key: 23, Length: 31, Payload: 32 };

const SpanOverhead = 16;

const Movement = { X: 16, Y: 18, Z: 20, Heading: 22, World: 23, Flags: 29 };

const SentinelAxis = 10000;

function IsSentinel(P) {
    return P.X === P.Y && P.Y === P.Z && Math.abs(P.X) > SentinelAxis;
}

const FlagBits = 25;
const FlagBytes = 4;
const HasPosition = 0x80;
const HasHeading = 0x40;

const EnablePlacement = process.env.OPAL_ENABLE_PLACEMENT === '1';

const StateClass = 0x287e7375;
const StateFlagBits = 25;
const StateFlagBytes = 4;
const StateHasPosition = 0x80;

const PlacementMs = 1000;

const BroadcastMs = 80;

const DrainIntervalMs = 250;

function ReadMovement(Bytes) {
    if (!Bytes || Bytes.length < 30) return null;
    if (Bytes.readUInt32BE(4) !== MovementPacket) return null;
    return {
        X: Bytes.readInt16BE(Movement.X),
        Y: Bytes.readInt16BE(Movement.Y),
        Z: Bytes.readInt16BE(Movement.Z),
        Heading: Bytes.readUInt8(Movement.Heading),
        World: Bytes.readUInt32BE(Movement.World),
        Flags: Bytes.readUInt8(Movement.Flags),
    };
}

const RelayExtraState = false;
const HasExtraState = 0x20;

function Body(Position) {
    const Extra = RelayExtraState && Position.Flags !== undefined;
    const BodyData = Buffer.alloc(FlagBytes + 6 + 1 + (Extra ? 1 : 0));
    BodyData.writeUInt8(HasPosition | HasHeading | (Extra ? HasExtraState : 0), 0);
    BodyData.writeUInt8(0, 1);
    BodyData.writeInt16BE(Position.X, FlagBytes + 0);
    BodyData.writeInt16BE(Position.Y, FlagBytes + 2);
    BodyData.writeInt16BE(Position.Z, FlagBytes + 4);
    BodyData.writeUInt8(Position.Heading & 0xff, FlagBytes + 6);
    if (Extra) BodyData.writeUInt8(Position.Flags & 0xff, FlagBytes + 7);
    return BodyData;
}

function Build(PlayerId, Position) {
    const BodyData = Body(Position);

    const Frame = Buffer.alloc(Entry.Payload + BodyData.length);
    Frame.writeUInt32LE(Frame.length, 0);
    Frame.writeUInt32BE(UpdateListPacket, 4);
    Frame.writeUInt8(1, Entry.Count);
    Frame.writeUInt32BE(PositionClass, Entry.Class);
    Frame.writeUInt16BE(BodyData.length + SpanOverhead, Entry.Span);
    Frame.writeBigUInt64BE(BigInt(PlayerId), Entry.Key);
    Frame.writeUInt8(BodyData.length, Entry.Length);
    BodyData.copy(Frame, Entry.Payload);
    return Frame;
}

function BuildWarp(PlayerId, Position) {
    return Build(PlayerId, Position);
}

function FacingUnitsForSpot(Spot, CourtPos) {
    const Dx = (CourtPos ? CourtPos[0] : 0) - Spot[0];
    const Dz = (CourtPos ? CourtPos[2] : 0) - Spot[2];
    return (Math.atan2(Dx, Dz) * 32768.0) / Math.PI;
}

function FacingByteForSpot(Spot, CourtPos) {
    const Units = FacingUnitsForSpot(Spot, CourtPos);
    const Byte = Math.round((Units + 32768.0) / 255.0);
    return Math.max(0, Math.min(255, Byte)) & 0xff;
}

const SuppressMs = 1200;
function Suppress(Connection) {
    Connection.WarpSuppressUntil = Date.now() + SuppressMs;
}

function BuildCreate(PlayerId, Position) {
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId: PlayerId,
        ClassCrc: PositionClass,
        Payload: Body(Position),
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function BuildPlacement(PlayerId, Position) {
    const BodyData = Buffer.alloc(StateFlagBytes + 6);
    BodyData.writeUInt8(StateHasPosition, 0);
    BodyData.writeUInt8(0, 1);
    BodyData.writeUInt8(0, 2);
    BodyData.writeUInt8(0, 3);
    BodyData.writeInt16BE(Position.X, StateFlagBytes + 0);
    BodyData.writeInt16BE(Position.Y, StateFlagBytes + 2);
    BodyData.writeInt16BE(Position.Z, StateFlagBytes + 4);

    const Frame = Buffer.alloc(Entry.Payload + BodyData.length);
    Frame.writeUInt32LE(Frame.length, 0);
    Frame.writeUInt32BE(UpdateListPacket, 4);
    Frame.writeUInt8(1, Entry.Count);
    Frame.writeUInt32BE(StateClass, Entry.Class);
    Frame.writeUInt16BE(BodyData.length + SpanOverhead, Entry.Span);
    Frame.writeBigUInt64BE(BigInt(PlayerId), Entry.Key);
    Frame.writeUInt8(BodyData.length, Entry.Length);
    BodyData.copy(Frame, Entry.Payload);
    return Frame;
}

const EnableRawRelay = false;
let RelayAnnounced = false;

function Relay(Connection, Bytes) {
    if (!EnableRawRelay) return 0;
    if (!Connection.Userdata) return 0;
    if (!Bytes || Bytes.length < 30) return 0;
    if (Bytes.readUInt32BE(4) !== MovementPacket) return 0;

    const Position = ReadMovement(Bytes);
    if (!Position || IsSentinel(Position)) return 0;

    let Sent = 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer.State !== 2) continue;
        if (!Peer.KnownPlayers || !Peer.KnownPlayers.has(Connection.Id)) continue;
        if (Peer.Send(Bytes)) Sent++;
    }

    if (Sent && !RelayAnnounced) {
        RelayAnnounced = true;
        Log.Info(
            `${Connection.Identifier} movement is being forwarded to ${Sent} ` +
                `${Sent === 1 ? 'player' : 'players'} in the client's own frame @ ${Log.Clock()}`,
        );
    }
    return Sent;
}

function Note(Connection, Bytes) {
    const Position = ReadMovement(Bytes);
    if (!Position) return false;

    Connection.World = Position.World;

    if (IsSentinel(Position)) {
        if (!Connection.SentinelSeen) {
            Connection.SentinelSeen = true;
            Log.Verbose(
                `  ${Connection.Identifier} reported a nowhere-sentinel ` +
                    `(${Position.X}, ${Position.Y}, ${Position.Z}) — not relayed`,
            );
        }
        return false;
    }

    const Previous = Connection.Position;
    Connection.Position = Position;
    Connection.PositionDirty =
        !Previous ||
        Previous.X !== Position.X ||
        Previous.Y !== Position.Y ||
        Previous.Z !== Position.Z ||
        Previous.Heading !== Position.Heading;

    if (Connection.PositionDirty && !Connection.CourtsMoveRefreshed && !Connection.Closed) {
        try {
            if (require('./CourtData').IsBitstreamWorld(Connection.ActivityName)) {
                Connection.CourtsMoveRefreshed = true;
                require('./Courts').RepublishAll(Connection);
            }
        } catch (_) {}
    }
    return Connection.PositionDirty;
}

function Publish() {
    const Now = Date.now();
    for (const Connection of Roster.Active()) {
        if (!Connection.Position || Connection.Puid === null || !Connection.Userdata) continue;

        if (Connection.WarpSuppressUntil && Now < Connection.WarpSuppressUntil) continue;

        const Peers = Roster.Peers(Connection).filter(
            (Peer) => Peer.KnownPlayers && Peer.KnownPlayers.has(Connection.Id),
        );
        if (!Peers.length) continue;

        const Snapshotted = new Set();
        if (!Connection.CreatedFor) Connection.CreatedFor = new Map();
        for (const Peer of Peers) {
            const Last = Connection.CreatedFor.get(Peer.Id);
            const Due = Last === undefined || (CreateResendMs > 0 && Now - Last >= CreateResendMs);
            if (!Due) continue;

            if (EnableCreate && !Peer.SendObject(BuildCreate(Connection.Puid, Connection.Position))) {
                continue;
            }
            if (!Peer.SendObject(Build(Connection.Puid, Connection.Position))) continue;
            Connection.CreatedFor.set(Peer.Id, Now);
            Snapshotted.add(Peer.Id);
        }
        if (Snapshotted.size && !Connection.CreateAnnounced) {
            Connection.CreateAnnounced = true;
            const P = Connection.Position;
            Log.Info(
                `${Connection.Identifier} placed on ${Snapshotted.size} new ` +
                    `${Snapshotted.size === 1 ? 'peer' : 'peers'} at ` +
                    `(${P.X}, ${P.Y}, ${P.Z}) @ ${Log.Clock()}`,
            );
        }

        if (EnablePlacement && (!Connection.PlacedAt || Now - Connection.PlacedAt >= PlacementMs)) {
            Connection.PlacedAt = Now;
            const Placement = BuildPlacement(Connection.Puid, Connection.Position);
            for (const Peer of Peers) Peer.SendObject(Placement);
        }

        if (!Connection.PositionDirty) continue;
        Connection.PositionDirty = false;

        const Frame = Build(Connection.Puid, Connection.Position);
        let Sent = 0;
        for (const Peer of Peers) {
            if (Snapshotted.has(Peer.Id)) continue;
            if (Peer.SendObject(Frame)) Sent++;
        }

        if (!Connection.PositionAnnounced && Sent) {
            Connection.PositionAnnounced = true;
            const P = Connection.Position;
            Log.Info(
                `${Connection.Identifier} is moving at (${P.X}, ${P.Y}, ${P.Z}) ` +
                    `and ${Sent} ${Sent === 1 ? 'player' : 'players'} can now follow them @ ${Log.Clock()}`,
            );
        }

        const Queued = Sent || Snapshotted.size;
        if (Queued && (!Connection.DrainAt || Now - Connection.DrainAt >= DrainIntervalMs)) {
            Connection.DrainAt = Now;
            const Drain = require('./PlayerObject').DrainFrameFor(Connection);
            let Drained = 0;
            if (Drain)
                for (const Peer of Peers) {
                    if (Peer.SendObject(Drain)) Drained++;
                }
            if (Drained && !Connection.DrainAnnounced) {
                Connection.DrainAnnounced = true;
                Log.Info(
                    `${Connection.Identifier}'s player object now rides with its movement ` +
                        `to ${Drained} ${Drained === 1 ? 'peer' : 'peers'}, which is what makes ` +
                        `ProcessPlayerServerObject drain the queued movement @ ${Log.Clock()}`,
                );
            }
        }
    }
}

let Timer = null;

function Start() {
    if (Timer) return Timer;
    Timer = setInterval(Publish, BroadcastMs);
    if (Timer.unref) Timer.unref();
    return Timer;
}

function Stop() {
    if (Timer) clearInterval(Timer);
    Timer = null;
}

module.exports = {
    Entry,
    SpanOverhead,
    FlagBits,
    FlagBytes,
    HasPosition,
    HasHeading,
    StateClass,
    StateFlagBits,
    StateFlagBytes,
    StateHasPosition,
    PlacementMs,
    EnablePlacement,
    PositionClass,
    UpdateListPacket,
    ObjectDataPacket,
    MovementPacket,
    BroadcastMs,
    DrainIntervalMs,
    SuppressMs,
    EnableCreate,
    CreateResendMs,
    Body,
    BuildCreate,
    Relay,
    ReadMovement,
    Build,
    BuildWarp,
    FacingByteForSpot,
    FacingUnitsForSpot,
    Suppress,
    BuildPlacement,
    Note,
    Publish,
    Start,
    Stop,
    IsSentinel,
    SentinelAxis,
    Movement,
    RelayExtraState,
    HasExtraState,
};
