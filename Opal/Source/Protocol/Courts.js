// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const Packets = require('./Packets');
const ObjectFrame = require('../Codec/ObjectFrame');
const CourtTables = require('../Activity/CourtTables');
const Slots = require('./Slots');

const Flags = 147;

const Field = {
    RegionId: 0,
    Transform: 4,
    CourtId: 8,
    CourtMode: 9,
    RegionType: 20,
    SubCount: 81,
    Occupancy: 82,
    Setup: 85,

    SlotBase: 94,
    SlotStep: 95,
    SlotCount: 99,
    SlotType: 100,
    SlotIdA: 108,
};

const SlotType = 0xff;
const MaxSlots = 8;

const SendSlotTable = true;

const SendSlotGeometry = true;

const MaxSpots = 3;

const CourtClass = 0x2c4d49e3;
const DataPacket = Packets.Wire('OBJECT_DATA');

const CourtMode = (TeamSize) => TeamSize * 2;

const RegionType = {
    GotNext: 0x08,
    ParkGotNext: 0x9705bb0d,
    MiniBasketball: 0x18,
    DumbbellWorkouts: 0x13,
    BeatsMachine: 0x14,
    Airball: 0x24,
    Squad: 0x23,
    ParkSquad: 0x6291f559,
    Generic: 0x0d,
    StatusWindow: [15, 30],
};

const ReadsSpotCounts = (T) => T >= RegionType.StatusWindow[0] && T <= RegionType.StatusWindow[1];

const Eligibility = { Disabled: 0, Joinable: 1, Detailed: 2 };

function U32(Value) {
    const B = Buffer.alloc(4);
    B.writeUInt32LE(Value >>> 0, 0);
    return B;
}

function Vec4(X, Y, Z, W) {
    const B = Buffer.alloc(16);
    B.writeFloatLE(X, 0);
    B.writeFloatLE(Y, 4);
    B.writeFloatLE(Z, 8);
    B.writeFloatLE(W, 12);
    return B;
}

const SendYawInTransform = false;

function Transform(Tx, Ty, Tz, Yaw = 0) {
    const B = Buffer.alloc(64);
    const C = Math.cos(Yaw),
        S = Math.sin(Yaw);
    const NegS = S === 0 ? 0 : -S;
    B.writeFloatLE(C, 0);
    B.writeFloatLE(NegS, 8);
    B.writeFloatLE(1, 20);
    B.writeFloatLE(S, 32);
    B.writeFloatLE(C, 40);
    B.writeFloatLE(Tx, 48);
    B.writeFloatLE(Ty, 52);
    B.writeFloatLE(Tz, 56);
    B.writeFloatLE(1, 60);
    return B;
}

function Setup(Corners, Base, SpotTypeValue = SpotType.GotNext) {
    const B = Buffer.alloc(144);
    if (Base) {
        B.writeFloatLE(Base[0], 0);
        B.writeFloatLE(Base[1], 4);
        B.writeFloatLE(Base[2], 8);
        B.writeFloatLE(1, 12);
    }
    for (let I = 0; I < 4; I++) {
        B.writeFloatLE(Corners[I][0], 96 + I * 8);
        B.writeFloatLE(Corners[I][1], 100 + I * 8);
    }
    B.writeUInt32LE(1, 128);
    B.writeUInt8(SpotTypeValue & 0xff, 132);
    return B;
}

function Occupancy(State = Eligibility.Joinable, Detail = 0) {
    const B = Buffer.alloc(72);
    B.writeUInt32LE(State >>> 0, 0x38);
    if (State === Eligibility.Detailed) B.writeUInt8(Detail & 0xff, 0x40);
    return B;
}

function Held(PlayerId) {
    const B = Buffer.alloc(72);
    if (PlayerId) {
        B.writeBigUInt64LE(BigInt.asUintN(64, PlayerId), 8);
        B.writeBigUInt64LE(BigInt.asUintN(64, PlayerId), 0x40);
    }
    return B;
}

const SpotType = { GotNext: 0, Squad: 1 };

function SpotOptions(Mode, Centre) {
    if (Mode === '3s') {
        return {
            Spots: 3,
            Dx: Centre[0] < 0 ? 850 : -850,
            Dz: 0,
            SideAxis: 'z',
            PairAxis: 'z',
            SideOffset: 850,
            PairSpacing: 130,
            SpotHalf: 140,
        };
    }
    if (Mode === '2s') {
        const AwayFromAisle = Centre[0] < 0 ? -1 : 1;
        return {
            Spots: 2,
            Dx: AwayFromAisle * 700,
            Dz: 850,
            SideAxis: 'x',
            PairAxis: 'x',
            SideOffset: AwayFromAisle * 520,
            PairSpacing: AwayFromAisle * 120,
            SpotHalf: 140,
        };
    }
    return { Spots: 2, Dx: 0, Dz: 0, SideAxis: 'z', PairAxis: 'z', SideOffset: 850, PairSpacing: 130, SpotHalf: 140 };
}

function SpotPositions(Centre, Winding, Opts, Yaw = 0) {
    const N = Math.max(1, Math.min(3, Opts.Spots));
    const Side = (Winding === 0 ? -1 : 1) * Opts.SideOffset;
    const Cos = Math.cos(Yaw),
        Sin = Math.sin(Yaw);

    const SideDz = (Winding === 0 ? Opts.Dz0 : Opts.Dz1) || 0;

    const Out = [];
    for (let I = 0; I < N; I++) {
        const Along = (I - (N - 1) / 2) * Opts.PairSpacing;
        const Local = [Opts.Dx, 0, Opts.Dz];
        Local[Opts.SideAxis === 'x' ? 0 : 2] += Side + SideDz;
        Local[Opts.PairAxis === 'x' ? 0 : 2] += Along;

        Out.push([
            Centre[0] + Local[0] * Cos + Local[2] * Sin,
            Centre[1] + Local[1],
            Centre[2] - Local[0] * Sin + Local[2] * Cos,
        ]);
    }
    return Out;
}

function SpotBoxHalves(Opts) {
    const H = Opts.SpotHalf || 0;
    const RowSpacing = Math.abs(Opts.PairSpacing);
    let Hx = H,
        Hz = H;
    if (H > 0 && Number.isFinite(RowSpacing) && RowSpacing > 5) {
        const RowHalf = Math.min(H, RowSpacing / 2 + 10.0);
        if (Opts.PairAxis === 'x') Hx = RowHalf;
        else Hz = RowHalf;
    }
    return { Hx, Hz };
}

const ModeFor = (TeamSize) => (TeamSize >= 3 ? '3s' : '2s');

function Calibrated(Options, Override) {
    return Override ? { ...Options, ...Override } : Options;
}

function BuildBody(Key, Version, Fields) {
    const Bitmap = ObjectFrame.WriteFlags([...Fields.keys()], Flags);
    const Values = [...Fields.keys()].sort((A, B) => A - B).map((K) => Fields.get(K));
    const Head = Buffer.alloc(16);
    Head.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Key)), 0);
    Head.writeBigUInt64BE(BigInt.asUintN(64, BigInt(Version)), 8);
    return Buffer.concat([Head, Bitmap, ...Values]);
}

function Build(Group, Version = 1n, Occupants = []) {
    const Anchors = Group.Anchors.slice(0, MaxSpots);
    if (!Anchors.length) throw new Error(`${Group.Name} has no spots to describe`);

    const Yaw = SendYawInTransform ? Group.Yaw : 0;
    const { Hx, Hz } = SpotBoxHalves(Group.Options);
    const Fields = new Map();

    const Identity = IdentityOf(Group);
    Fields.set(Field.CourtId, U32(Identity));
    Fields.set(Field.RegionId, U32(Identity));
    Fields.set(Field.CourtMode, U32(CourtMode(Group.TeamSize)));
    Fields.set(Field.Transform, Transform(Group.Pos[0], Group.Pos[1], Group.Pos[2], Yaw));
    Fields.set(Field.RegionType, U32(Group.RegionType));

    if (Group.Kind === 'squad') {
        Fields.set(Field.Occupancy, Occupancy(Eligibility.Joinable));
    } else {
        Anchors.forEach((_, I) => Fields.set(Field.Occupancy + I, Held(Occupants[I])));
    }

    Fields.set(Field.SubCount, Buffer.from([Anchors.length]));
    const SpotTypeValue = Group.Kind === 'squad' ? SpotType.Squad : SpotType.GotNext;
    Anchors.forEach((Anchor, I) => {
        const Corners = [
            [Anchor[0] - Hx, Anchor[2] - Hz],
            [Anchor[0] + Hx, Anchor[2] - Hz],
            [Anchor[0] + Hx, Anchor[2] + Hz],
            [Anchor[0] - Hx, Anchor[2] + Hz],
        ];
        Fields.set(Field.Setup + I, Setup(Corners, Anchor, SpotTypeValue));
    });

    if (SendSlotGeometry) {
        const A0 = Anchors[0];
        const A1 = Anchors.length > 1 ? Anchors[1] : A0;
        Fields.set(Field.SlotBase, Vec4(A0[0], A0[1], A0[2], 1));
        Fields.set(Field.SlotStep, Vec4(A1[0] - A0[0], A1[1] - A0[1], A1[2] - A0[2], 0));
    }

    const SlotsValue = SendSlotTable ? (Group.SlotIds || []).slice(0, MaxSlots) : [];
    if (SlotsValue.length) {
        Fields.set(Field.SlotCount, Buffer.from([SlotsValue.length]));
        SlotsValue.forEach((Id, K) => {
            Fields.set(Field.SlotType + K, Buffer.from([SlotType]));
            const Value = Buffer.alloc(8);
            Value.writeBigUInt64LE(BigInt.asUintN(64, Id), 0);
            Fields.set(Field.SlotIdA + K, Value);
        });
    }

    return ObjectFrame.Build({
        PacketId: DataPacket,
        ConnectionId: null,
        ObjectId: Group.ObjectId,
        ClassCrc: CourtClass,
        Payload: BuildBody(Group.ObjectId, Version, Fields),
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

const ObjectIdFor = (Room, Seq) => (BigInt(Room) << 32n) | BigInt(Seq >>> 0);

const SendSquadObjects = true;

const SquadRegionType = RegionType.Squad;

const AllSquadForNow = false;

const SlotIdBase = 0x9100000000000001n;

function SlotIdsFor(Court, Room, Count, Offset) {
    const Start = SlotIdBase + (BigInt(Room) << 32n) + BigInt(Court.Index * 16 + Offset);
    return Array.from({ length: Count }, (_, K) => Start + BigInt(K));
}

const SlotObjectOffset = { Side: 8, Squad: 10 };

function SlotObjectIdFor(Court, Room, Offset) {
    return SlotIdsFor(Court, Room, 1, Offset)[0];
}

function GroupsFor(Court, Room, SeqBase) {
    const Mode = ModeFor(Court.TeamSize);
    const Options = Calibrated({ ...SpotOptions(Mode, Court.Pos), Spots: Court.TeamSize }, Court.Spots);

    const Sides = [0, 1].map((Winding) => ({
        Name: `${Court.Name}#${Winding}`,
        CourtName: Court.Name,
        Kind: 'gotnext',
        Seq: SeqBase + Court.Index * 2 + Winding,
        Winding: Winding,
        Pos: Court.Pos,
        Yaw: Court.Yaw,
        TeamSize: Court.TeamSize,
        CourtId: Court.CourtId || null,
        Mode: Mode,
        Options: Options,
        Anchors: Court.SpotAnchors
            ? Court.SpotAnchors[Winding]
            : SpotPositions(Court.Pos, Winding, Options, Court.SpotYaw || 0),
        RegionType: Court.RegionType || RegionType.GotNext,
        SlotObjectId: SlotObjectIdFor(Court, Room, SlotObjectOffset.Side + Winding),
        ObjectId: ObjectIdFor(Room, SeqBase + Court.Index * 2 + Winding),
    }));

    if (!SendSquadObjects || Court.TeamSize < 2 || Court.NoSquad) {
        return Sides.map((G) => Named(G, Room));
    }

    const Off = Court.Squad || [0, 0, 0];
    const SquadAnchors = Court.SquadAnchors
        ? Court.SquadAnchors
        : [[Court.Pos[0] + Off[0], Court.Pos[1] + Off[1], Court.Pos[2] + Off[2]]];

    const Squad = {
        Name: `${Court.Name} SQUAD`,
        CourtName: Court.Name,
        Kind: 'squad',
        Seq: SeqBase + 0x40 + Court.Index,
        Winding: 0,
        Pos: Court.Pos,
        Yaw: Court.Yaw,
        TeamSize: Court.TeamSize,
        CourtId: Court.CourtId || null,
        Mode: Mode,
        Options: Options,
        Anchors: SquadAnchors,
        RegionType: Court.SquadRegionType || SquadRegionType,
        SlotObjectId: SlotObjectIdFor(Court, Room, SlotObjectOffset.Squad),
    };

    return [...Sides, Squad].map((G) => Named(G, Room));
}

function IdentityOf(Group) {
    return Group.CourtId === null || Group.CourtId === undefined ? Group.Seq : Group.CourtId;
}

function Named(Group, Room) {
    return {
        ...Group,
        ObjectId:
            Group.ObjectId !== undefined && Group.ObjectId !== null ? Group.ObjectId : ObjectIdFor(Room, Group.Seq),
        SlotName: IdentityOf(Group),
        SlotIds: [Group.SlotObjectId],
    };
}

function Publish(Connection) {
    const World = CourtTables.For(Connection.ActivityName);
    if (!World) return 0;

    if (Connection.CourtsPublished) {
        Log.Verbose(`  courts already published to connection ${Connection.Id}, not resending`);
        return 0;
    }

    if (Connection.ActivityName === 'stage') {
        const SentValue = require('./CourtData').PublishStageCourts(Connection);
        Connection.CourtsPublished = SentValue > 0;
        return SentValue;
    }

    if (Connection.ActivityName === 'neighborhood') {
        return PublishPark(Connection);
    }

    const Groups = World.Courts.flatMap((C) => GroupsFor(C, World.Room, World.SeqBase));
    let Sent = 0,
        Mats = 0,
        Queues = 0;
    for (const Group of Groups) {
        if (Connection.SendObject(Build(Group, 1n, Slots.SeatsOf(Group.SlotObjectId)))) {
            Sent++;
            Mats += Math.min(Group.Anchors.length, MaxSpots);
        }
        if (Slots.Publish(Connection, Group)) Queues++;
    }
    Connection.CourtsPublished = Sent > 0;

    Log.Info(
        `${Connection.Identifier} was given ${World.Courts.length} courts in ` +
            `${Connection.ActivityName}, ${Sent} objects carrying ${Mats} spots and ` +
            `${Queues} queues @ ${Log.Clock()}`,
    );

    const Name = (T) =>
        T === RegionType.GotNext
            ? 'plain got-next'
            : T === RegionType.ParkGotNext
              ? 'park got-next (activity-routed)'
              : T === RegionType.Airball
                ? 'got-next with airball instructions'
                : T === RegionType.Squad
                  ? 'squad mat'
                  : T === RegionType.Generic
                    ? 'GENERIC, a plain dot — wrong'
                    : T === RegionType.BeatsMachine
                      ? 'beats machine — wrong'
                      : 'unconfirmed';

    const Types = [...new Set(Groups.map((G) => G.RegionType))];
    Log.Verbose(
        `  region types ${Types.map((T) => `${Hex(T)} (${Name(T)})`).join(', ')} — a mat ` +
            `that renders is not proof of anything; the L3 instruction text is the signal.`,
    );
    return Sent;
}

function PublishPark(Connection) {
    const CourtData = require('./CourtData');
    const World = CourtTables.For(Connection.ActivityName);
    let Sent = 0;
    for (const Raw of World.Courts) {
        if (CourtData.ParkCourtFormat(Raw.Name) === 'legacy') {
            let Courts = 0;
            for (const Group of GroupsFor(Raw, World.Room, World.SeqBase)) {
                if (Connection.SendObject(Build(Group, 1n, Slots.SeatsOf(Group.SlotObjectId)))) Courts++;
                Slots.Publish(Connection, Group);
            }
            if (Courts) Sent++;
        } else {
            const Built = CourtData.BuildParkCourtByName(Raw.Name);
            if (Built && Connection.SendObject(Built.Frame)) Sent++;
        }
    }
    if (Sent) {
        Log.Info(
            `${Connection.Identifier} was given ${World.Courts.length} Boulevard courts ` +
                `(${CourtData.ParkFormat()} recipe) @ ${Log.Clock()}`,
        );
    }
    Connection.CourtsPublished = Sent > 0;
    return Sent;
}

function RepublishAll(Connection) {
    if (Connection.ActivityName === 'stage') {
        return require('./CourtData').RefreshStageCourts(Connection);
    }
    if (Connection.ActivityName === 'neighborhood') {
        return RefreshPark(Connection);
    }

    const World = CourtTables.For(Connection.ActivityName);
    if (!World) return 0;

    const Groups = World.Courts.flatMap((C) => GroupsFor(C, World.Room, World.SeqBase));
    let Sent = 0;
    for (const Group of Groups) {
        const Version = (Connection.CourtVersions.get(Group.ObjectId) || 1n) + 1n;
        Connection.CourtVersions.set(Group.ObjectId, Version);
        if (Connection.SendObject(Build(Group, Version, Slots.SeatsOf(Group.SlotObjectId)))) Sent++;
        Slots.Publish(Connection, Group);
    }

    Log.Info(
        `${Connection.Identifier} was re-sent ${Sent}/${Groups.length} courts in ` +
            `${Connection.ActivityName} with their queues, one version higher @ ${Log.Clock()}`,
    );
    return Sent;
}

function RefreshPark(Connection) {
    const CourtData = require('./CourtData');
    const World = CourtTables.For(Connection.ActivityName);
    if (!World) return 0;

    let Sent = 0,
        Legacy = 0;
    for (const Raw of World.Courts) {
        if (CourtData.ParkCourtFormat(Raw.Name) === 'legacy') {
            for (const Group of GroupsFor(Raw, World.Room, World.SeqBase)) {
                const Version = (Connection.CourtVersions.get(Group.ObjectId) || 1n) + 1n;
                Connection.CourtVersions.set(Group.ObjectId, Version);
                if (Connection.SendObject(Build(Group, Version, Slots.SeatsOf(Group.SlotObjectId)))) {
                    Sent++;
                    Legacy++;
                }
                Slots.Publish(Connection, Group);
            }
        } else {
            const Built = CourtData.BuildParkCourtByName(Raw.Name);
            if (Built && Connection.SendObject(Built.Frame)) Sent++;
        }
    }

    Log.Info(
        `${Connection.Identifier} was re-sent ${Sent} park courts ` + `(${Legacy} legacy objects) @ ${Log.Clock()}`,
    );
    return Sent;
}

function Republish(Connection, Court) {
    if (Connection.ActivityName === 'stage') {
        return require('./CourtData').RepublishStageCourt(Connection, Court);
    }
    if (Connection.ActivityName === 'neighborhood') {
        const Key = BigInt.asUintN(64, BigInt(Court));
        const Low = Number(Key & 0xffffffffn) >>> 0;
        const Boulevard = require('../Activity/StageSpots/BoulevardCourts2K19');
        const Entry = Boulevard.BoulevardCourts.find((E) => E.id >>> 0 === Low);
        const CourtData = require('./CourtData');
        if (Entry && CourtData.ParkCourtFormat(Entry.name) !== 'legacy') {
            return CourtData.RepublishParkCourt(Connection, Court);
        }
    }

    const World = CourtTables.For(Connection.ActivityName);
    if (!World) return false;

    for (const Raw of World.Courts) {
        for (const Group of GroupsFor(Raw, World.Room, World.SeqBase)) {
            if (Group.ObjectId !== Court) continue;

            const Seats = Slots.SeatsOf(Group.SlotObjectId);
            const Recipients = [Connection];
            try {
                const Roster = require('./Roster');
                for (const Peer of Roster.Peers(Connection)) {
                    if (Peer.ActivityName === Connection.ActivityName) Recipients.push(Peer);
                }
            } catch (_) {}

            let Sent = 0;
            for (const Recipient of Recipients) {
                const Version = (Recipient.CourtVersions.get(Court) || 1n) + 1n;
                Recipient.CourtVersions.set(Court, Version);
                if (Recipient.SendObject(Build(Group, Version, Seats))) Sent++;
            }

            Log.Verbose(
                `  court ${Hex(Group.Seq)} re-sent at ${Sent}/${Recipients.length} ` +
                    `recipients before the warp, which is the order the capture shows`,
            );
            return Sent > 0;
        }
    }
    return false;
}

module.exports = {
    Publish,
    Republish,
    RepublishAll,
    Flags,
    Field,
    MaxSpots,
    CourtClass,
    DataPacket,
    CourtMode,
    RegionType,
    Eligibility,
    SendSquadObjects,
    ReadsSpotCounts,
    SquadRegionType,
    SendYawInTransform,
    SpotType,
    SpotOptions,
    SpotPositions,
    SpotBoxHalves,
    ModeFor,
    Calibrated,
    SlotType,
    MaxSlots,
    SendSlotTable,
    SlotIdBase,
    SlotIdsFor,
    SlotObjectIdFor,
    SlotObjectOffset,
    IdentityOf,
    Transform,
    Setup,
    Occupancy,
    Held,
    BuildBody,
    Build,
    ObjectIdFor,
    GroupsFor,
};
