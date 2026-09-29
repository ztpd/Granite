// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const FieldList = require('../Codec/FieldList');
const ObjectFrame = require('../Codec/ObjectFrame');
const Roster = require('./Roster');
const Userdata = require('./Userdata');
const PlayerBody = require('./PlayerBody');

const PlayerClass = 0x2c5d2702;
const ObjectDataPacket = 0x9c72247c;
const ObjectDestroyPacket = 0xa5feca35;
const PlayerUpdatePacket = 0xfef2dd68;
const HandshakePacket = 0x366444c1;
const DataBlobKey = 0x9b661ed7;

const Body = { Key: 0, Revision: 8, Presence: 16, Puid2K19: 35 };

const BestBodies = new Map();

function ExtractHandshakeBody(Frame) {
    if (!Frame || Frame.length < 90 || Frame.readUInt32BE(4) !== HandshakePacket) return null;

    const PlayerId = Frame.readBigUInt64BE(24);
    if (!PlayerId || Frame.readUInt32BE(32) !== PlayerClass) return null;

    let Terminator = -1;
    for (let Offset = 42; Offset + 16 <= Frame.length; Offset += 16) {
        if (Frame.readUInt32BE(Offset) === 0 && Frame.readUInt32BE(Offset + 4) === 0) {
            Terminator = Offset;
            break;
        }
    }
    if (Terminator <= 42) return null;

    const DataBase = Terminator + 16;
    for (let Offset = 42; Offset < Terminator; Offset += 16) {
        if (Frame.readUInt32BE(Offset + 4) !== FieldList.Type.BlobRef) continue;
        const Start = DataBase + Frame.readUInt32BE(Offset + 8);
        const Length = Frame.readUInt32BE(Offset + 12);
        if (Length < 58 || Start + Length > Frame.length) continue;
        if (Frame.readBigUInt64BE(Start) !== PlayerId) continue;
        return {
            PlayerId: PlayerId,
            BlobKey: Frame.readUInt32BE(Offset) >>> 0,
            Body: Buffer.from(Frame.slice(Start, Start + Length)),
        };
    }
    return null;
}

function FindPuidValue(BodyData, Claimed) {
    if (!BodyData || BodyData.length < Body.Presence + 8) return -1;
    const Needle = Buffer.alloc(8);
    Needle.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Claimed)));

    for (const Offset of [Body.Puid2K19, 36]) {
        if (Offset + 8 <= BodyData.length && BodyData.subarray(Offset, Offset + 8).equals(Needle)) {
            return Offset;
        }
    }

    const At = BodyData.subarray(Body.Presence, Math.min(BodyData.length, 64)).indexOf(Needle);
    return At < 0 ? -1 : Body.Presence + At;
}

function StampIdentity(Source, Claimed, Assigned) {
    const BodyData = Buffer.from(Source);
    BodyData.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Assigned)), Body.Key);
    const Offset = FindPuidValue(BodyData, Claimed);
    if (Offset >= 0) BodyData.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Assigned)), Offset);
    return { Body: BodyData, PuidOffset: Offset };
}

function AuthoritativeBody(Connection) {
    const Stamped = PlayerBody.SetMachineId(Connection.PlayerBody, Connection.MachineId);
    if (!Stamped.Ok) {
        if (Stamped.Native) {
            Log.Error(`${Connection.Identifier}: PLAYER publication blocked: ${Stamped.Reason}`);
            return null;
        }
        return Buffer.from(Connection.PlayerBody);
    }
    if (Stamped.Was !== Stamped.MachineId) {
        Log.Verbose(
            `  ${Connection.Identifier}: PLAYER machine field 1 at body+${Stamped.Offset} ` +
                `${Stamped.Was === null ? 'absent' : Stamped.Was.toString(16)} -> ` +
                `${Stamped.MachineId.toString(16)} (GAME roster/self machine)`,
        );
    }
    Connection.PlayerBody = Stamped.Body;
    return Buffer.from(Stamped.Body);
}

function FrameFor(Connection) {
    if (!Connection.PlayerBody) return null;
    const BodyData = AuthoritativeBody(Connection);
    if (!BodyData) return null;
    Connection.PlayerRevision += 1n;
    BodyData.writeBigUInt64BE(Connection.PlayerRevision, Body.Revision);
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Connection.Puid,
        ClassCrc: PlayerClass,
        Payload: BodyData,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function DrainFrameFor(Connection) {
    if (!Connection.PlayerBody) return null;
    const BodyData = AuthoritativeBody(Connection);
    if (!BodyData) return null;
    BodyData.writeBigUInt64BE(Connection.PlayerRevision, Body.Revision);
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId: Connection.Puid,
        ClassCrc: PlayerClass,
        Payload: BodyData,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function ElementFor(Connection) {
    const Frame = FrameFor(Connection);
    if (!Frame || Frame.length < 16) return null;
    return Buffer.concat([Frame.subarray(4, 8), Frame.subarray(16)]);
}

function DestroyFrameFor(Connection) {
    if (!Connection || Connection.Puid === null || Connection.Puid === undefined) return null;
    const BodyData = Buffer.alloc(8);
    BodyData.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Connection.Puid)));
    return require('../Codec/Frame').Build(
        ObjectDestroyPacket,
        null,
        BodyData,
        require('../Codec/Frame').InnerHeader.None,
    );
}

function PublishDestroy(Connection) {
    const Frame = DestroyFrameFor(Connection);
    if (!Frame) return 0;
    let Sent = 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (!Peer.KnownPlayers || !Peer.KnownPlayers.has(Connection.Id)) continue;
        if (!Peer.SendObject(Frame)) continue;
        Peer.KnownPlayers.delete(Connection.Id);
        Sent++;
    }
    if (Sent) Log.Verbose(`  OBJECT_DESTROY for ${Connection.Identifier} -> ${Sent} peers`);
    return Sent;
}

function PuidCollision(Connection) {
    for (const Peer of Roster.Peers(Connection)) {
        if (Peer.Puid !== null && Peer.Puid === Connection.Puid) return Peer;
    }
    return null;
}

function Register(Connection, Frame) {
    const Handshake = ExtractHandshakeBody(Frame);
    if (!Handshake) return 0;

    const Claimed =
        Connection.ClaimedPuid !== null && Connection.ClaimedPuid !== undefined
            ? Connection.ClaimedPuid
            : Connection.Puid;
    if (Claimed !== null && Handshake.PlayerId !== Claimed) {
        Log.Error(
            `${Connection.Identifier} sent a handshake body for ` +
                `${Handshake.PlayerId.toString(16)}, which is not itself.`,
        );
        return 0;
    }
    if (Connection.ClaimedPuid === null || Connection.ClaimedPuid === undefined) {
        Connection.ClaimedPuid = Handshake.PlayerId;
    }
    if (Connection.Puid === null) {
        Roster.AssignPuid(Connection, Handshake.PlayerId, Connection.ActivityKey);
    }

    const Clash = PuidCollision(Connection);
    if (Clash) {
        Connection.Puid = null;
        const Identity = Roster.AssignPuid(Connection, Handshake.PlayerId, Connection.ActivityKey);
        Log.Info(
            `connection ${Connection.Id} shared ${Clash.Identifier}'s client PUID; ` +
                `using ${Identity.Puid.toString(16).toUpperCase().padStart(16, '0')} on the wire`,
        );
    }

    const Stamped = StampIdentity(Handshake.Body, Handshake.PlayerId, Connection.Puid);
    if (Connection.Puid !== Handshake.PlayerId && Stamped.PuidOffset < 0) {
        Log.Error(
            `${Connection.Identifier}'s player body did not contain its claimed PUID in ` +
                `the NBA2K19 header, so an inconsistent peer object was not sent.`,
        );
        return 0;
    }

    const Show = PlayerBody.SetShow(Stamped.Body);
    if (Show.Ok) {
        Stamped.Body = Show.Body;
        Log.Verbose(
            `  PLAYER field 84 at body+${Show.Offset} (object+493) ` +
                `${Show.Inserted ? 'was absent and was inserted as' : `was ${Show.Was} ->`} 1: ` +
                `ProcessPlayerServerObject will call actor vtable +208 (SHOW) for ` +
                `${Connection.Identifier} on every peer.`,
        );
    } else {
        Log.Error(
            `${Connection.Identifier}'s PLAYER body cannot carry field 84 ` +
                `(object+493): ${Show.Reason}. ProcessPlayerServerObject will not call ` +
                `actor vtable +208, so peers will build this player hidden.`,
        );
    }

    const Normalized = PlayerBody.Trim(Stamped.Body);
    if (!Normalized.Ok) {
        Log.Verbose(
            `  PLAYER body boundary was not decoded: ${Normalized.Reason}; ` +
                `retaining all ${Stamped.Body.length} bytes`,
        );
    }

    const Generation = PlayerBody.InspectGeneration(Stamped.Body);
    if (Generation.Ok && !Generation.GenerationOk) {
        Log.Error(
            `${Connection.Identifier}'s PLAYER body cannot enter the NBA2K19 ` + `creation path: ${Generation.Reason}.`,
        );
        return 0;
    }
    if (Generation.Ok) {
        if (Generation.Puid === 0n || Generation.Puid !== Connection.Puid) {
            Log.Error(
                `${Connection.Identifier}'s PLAYER field 0 PUID ` +
                    `${Generation.Puid.toString(16)} does not match assigned World PUID ` +
                    `${Connection.Puid.toString(16)}; object was not published.`,
            );
            return 0;
        }
        if (!Generation.RealPeer) {
            Log.Error(
                `${Connection.Identifier}'s PLAYER body selects the fake-player ` +
                    `generation branch (field 82=${Generation.FakePlayerFlag}, ` +
                    `field 99=${Generation.FakePlayerDataBytes} bytes); object was not published.`,
            );
            return 0;
        }
        Log.Verbose(
            `  PLAYER creation contract: field 0=${Generation.Puid.toString(16)}, ` +
                `field 82=${Generation.FakePlayerFlag}, field 99=` +
                `${Generation.FakePlayerDataBytes} bytes -> REMOTE_PLAYERMANAGER::AddPlayer ` +
                `(normal appearance path eligible)`,
        );
    }

    const Key = Connection.Puid.toString(16).padStart(16, '0');
    const Previous = BestBodies.get(Key);
    const Grew = !Previous || Stamped.Body.length > Previous.length;
    if (Grew) BestBodies.set(Key, Stamped.Body);
    Connection.PlayerBody = BestBodies.get(Key);
    if (!AuthoritativeBody(Connection)) return 0;
    BestBodies.set(Key, Connection.PlayerBody);

    require('./GotNext').Reapply(Connection);
    require('./Shootaround').Reapply(Connection);
    require('./Squad').Reapply(Connection);
    BestBodies.set(Key, Connection.PlayerBody);

    const Revision = Handshake.Body.readBigUInt64BE(Body.Revision);
    if (Revision > Connection.PlayerRevision) Connection.PlayerRevision = Revision;

    Log.Verbose(
        `  handshake body ${Handshake.Body.length} bytes, ` +
            (Normalized.Trimmed
                ? `proven fields 0..110 end at ${Normalized.Body.length}; ` +
                  `all ${Handshake.Body.length} bytes preserved, `
                : '') +
            `key ${Hex(Handshake.BlobKey)}` +
            (Grew
                ? Previous
                    ? `, replacing a shorter ${Previous.length}`
                    : ''
                : `, keeping the fuller ${Previous.length} from earlier`),
    );

    const Peers = Roster.Peers(Connection);
    let Shown = 0,
        Seen = 0;

    const Mine = FrameFor(Connection);
    const MineRevision = Connection.PlayerRevision;
    if (Mine)
        for (const Peer of Peers) {
            if (!Peer.SendObject(Mine)) continue;
            if (!Peer.KnownPlayers) Peer.KnownPlayers = new Set();
            Peer.KnownPlayers.add(Connection.Id);
            Shown++;
            Log.Verbose(
                `  native receive carrier -> ${Peer.Identifier}: PLAYER OBJECT_DATA for ` +
                    `${Connection.Identifier}, ${Mine.length} bytes, key ` +
                    `${Connection.Puid.toString(16)}, revision ${MineRevision}`,
            );
            if (Connection.Userdata && Peer.SendObject(Connection.Userdata)) {
                Log.Verbose(
                    `  native receive carrier -> ${Peer.Identifier}: USERDATA for ` +
                        `${Connection.Identifier}, after PLAYER`,
                );
            }
        }

    for (const Peer of Peers) {
        const Theirs = FrameFor(Peer);
        const TheirsRevision = Peer.PlayerRevision;
        if (!Theirs || !Connection.SendObject(Theirs)) continue;
        if (!Connection.KnownPlayers) Connection.KnownPlayers = new Set();
        Connection.KnownPlayers.add(Peer.Id);
        Seen++;
        Log.Verbose(
            `  native receive carrier -> ${Connection.Identifier}: PLAYER OBJECT_DATA for ` +
                `${Peer.Identifier}, ${Theirs.length} bytes, key ` +
                `${Peer.Puid.toString(16)}, revision ${TheirsRevision}`,
        );
        if (Peer.Userdata && Connection.SendObject(Peer.Userdata)) {
            Log.Verbose(
                `  native receive carrier -> ${Connection.Identifier}: USERDATA for ` +
                    `${Peer.Identifier}, after PLAYER`,
            );
        }
    }

    Log.Info(
        `${Connection.Identifier}'s PLAYER object was published to ${Shown} ` +
            `${Shown === 1 ? 'player' : 'players'} in ${Connection.Activity}, and ${Seen} ` +
            `${Seen === 1 ? 'peer object was' : 'peer objects were'} returned @ ${Log.Clock()}`,
    );

    if (Shown || Seen) ScheduleRepublish(Connection);

    return Shown;
}

const RepublishDelaysMs = [2000, 10000];

function Republish(Connection, AfterMs = 0) {
    if (!Connection || Connection.Closed) return 0;
    if (Roster.Players.get(Connection.Id) !== Connection) return 0;

    const Peers = Roster.Peers(Connection);
    if (!Peers.length) return 0;

    let Sent = 0;
    const Mine = FrameFor(Connection);
    const MineRevision = Connection.PlayerRevision;
    if (Mine)
        for (const Peer of Peers) {
            if (!Peer.KnownPlayers || !Peer.KnownPlayers.has(Connection.Id)) continue;
            if (Peer.SendObject(Mine)) Sent++;
        }
    for (const Peer of Peers) {
        if (!Connection.KnownPlayers || !Connection.KnownPlayers.has(Peer.Id)) continue;
        const Theirs = FrameFor(Peer);
        if (Theirs && Connection.SendObject(Theirs)) Sent++;
    }

    if (Sent) {
        Log.Info(
            `${Connection.Identifier}: re-sent ${Sent} PLAYER ` +
                `${Sent === 1 ? 'object' : 'objects'} (own revision ${MineRevision}) ` +
                `${AfterMs}ms after publish, so ` +
                `ProcessPlayerServerObject re-runs UpdateFromServerObject now that the ` +
                `character container exists @ ${Log.Clock()}`,
        );
    }
    return Sent;
}

function ScheduleRepublish(Connection) {
    return RepublishDelaysMs.map((Delay) => {
        const Timer = setTimeout(() => Republish(Connection, Delay), Delay);
        if (Timer.unref) Timer.unref();
        return Timer;
    });
}

function ReplayTo(Connection) {
    let Sent = 0;
    for (const Peer of Roster.Peers(Connection)) {
        const Frame = FrameFor(Peer);
        if (Frame && Connection.SendObject(Frame)) Sent++;
    }
    if (Sent) {
        Log.Verbose(
            `  ${Connection.Identifier} was given ${Sent} existing ` +
                `${Sent === 1 ? 'body' : 'bodies'} in ${Connection.Activity}`,
        );
    }
    return Sent;
}

const ServerOwnedFields = new Set([
    PlayerBody.Field.Puid,
    PlayerBody.Field.MachineId,
    PlayerBody.ShowField,
    PlayerBody.Field.SquadId,
    ...PlayerBody.Field.SquadInvites,
]);

function PresentBits(BodyData, From, Bytes) {
    const Out = [];
    for (let K = 0; K < Bytes; K++) {
        const O = BodyData[From + K];
        for (let P = 0; P < 8; P++) if (O & (0x80 >> P)) Out.push(K * 8 + P);
    }
    return Out;
}

function FieldValues(BodyData, Decoded) {
    const Fields = [...Decoded.Offsets.keys()].sort((A, B) => A - B);
    const Values = new Map();
    Fields.forEach((Field, Index) => {
        const From = Decoded.Offsets.get(Field);
        const To = Index + 1 < Fields.length ? Decoded.Offsets.get(Fields[Index + 1]) : Decoded.Length;
        Values.set(Field, BodyData.subarray(From, To));
    });
    return Values;
}

function MergeBodies(Cached, Partial) {
    const CachedDecoded = PlayerBody.Decode(Cached);
    const PartialDecoded = PlayerBody.Decode(Partial);
    if (!CachedDecoded.Ok || !PartialDecoded.Ok) return null;

    const Values = FieldValues(Cached, CachedDecoded);
    const Merged = [];
    for (const [Field, Value] of FieldValues(Partial, PartialDecoded)) {
        if (ServerOwnedFields.has(Field)) continue;
        Values.set(Field, Value);
        Merged.push(Field);
    }
    if (!Merged.length) return null;

    const Header = Buffer.from(Cached.subarray(0, PlayerBody.ValuesStart));
    const Ordered = [...Values.keys()].sort((A, B) => A - B);
    for (const Field of Ordered) Header[16 + (Field >> 3)] |= 0x80 >> (Field & 7);
    const BodyData = Buffer.concat([
        Header,
        ...Ordered.map((Field) => Values.get(Field)),
        Cached.subarray(CachedDecoded.Length),
    ]);
    return { Body: BodyData, Fields: Merged };
}

function ApplyAppearanceUpdate(Connection, Frame) {
    const Cached = Connection && Connection.PlayerBody;
    if (!Cached || !Buffer.isBuffer(Frame) || Frame.length < 42 + 35) return 0;
    if (Frame.readUInt32BE(4) >>> 0 !== PlayerUpdatePacket) return 0;
    if (Frame.readUInt32BE(32) >>> 0 !== PlayerClass) return 0;
    const Partial = Frame.subarray(42, 42 + Frame.readUInt16BE(40));
    if (Partial.length < 35) return 0;

    const Owner =
        Connection.ClaimedPuid !== null && Connection.ClaimedPuid !== undefined
            ? Connection.ClaimedPuid
            : Connection.Puid;
    if (Owner === null || Partial.readBigUInt64BE(0) !== Owner) return 0;

    const Result = MergeBodies(Cached, Partial);
    if (!Result) return 0;

    Connection.PlayerBody = Result.Body;
    BestBodies.set(Connection.Puid.toString(16).padStart(16, '0'), Result.Body);
    require('./GotNext').Reapply(Connection);
    require('./Shootaround').Reapply(Connection);

    const Out = FrameFor(Connection);
    if (!Out) return 0;
    let Sent = 0;
    const Position = require('./Position');
    const PositionPacket =
        Connection.Position && !Position.IsSentinel(Connection.Position)
            ? Position.Build(Connection.Puid, Connection.Position)
            : null;
    for (const Peer of Roster.Peers(Connection)) {
        if (!Peer.KnownPlayers || !Peer.KnownPlayers.has(Connection.Id)) continue;
        if (!Peer.SendObject(Out)) continue;
        Sent++;
        if (PositionPacket) Peer.SendObject(PositionPacket);
    }
    Log.Info(
        `${Connection.Identifier} appearance update (fields ${Result.Fields.join(',')}) ` +
            `merged into the published body and re-sent to ${Sent} ${Sent === 1 ? 'peer' : 'peers'}`,
    );
    return Sent;
}

module.exports = {
    PlayerClass,
    ObjectDataPacket,
    ObjectDestroyPacket,
    PlayerUpdatePacket,
    HandshakePacket,
    DataBlobKey,
    Body,
    BestBodies,
    ExtractHandshakeBody,
    FindPuidValue,
    StampIdentity,
    ApplyAppearanceUpdate,
    MergeBodies,
    ServerOwnedFields,
    PresentBits,
    FrameFor,
    DrainFrameFor,
    ElementFor,
    DestroyFrameFor,
    PublishDestroy,
    Republish,
    ScheduleRepublish,
    RepublishDelaysMs,
    PuidCollision,
    Register,
    ReplayTo,
    PlayerBody,
};
