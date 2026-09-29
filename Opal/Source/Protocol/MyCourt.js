// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Log = require('../Core/Log');
const ObjectFrame = require('../Codec/ObjectFrame');
const Roster = require('./Roster');

const RoomClass = 0x16a0d01e;
const RoomClassSize = 7952;
const ObjectDataPacket = 0x9c72247c;
const ObjectDataListPacket = 0x618ec78c;
const ObjectUpdatePacket = 0xfef2dd68;
const LegacyObjectUpdatePacket = 0x01ae543f;
const RoomObjectIndex = 0x000d4d06n;
const BootstrapDelayMs = Number.isFinite(Number(process.env.OPAL_MYCOURT_BOOTSTRAP_DELAY_MS))
    ? Math.max(0, Number(process.env.OPAL_MYCOURT_BOOTSTRAP_DELAY_MS))
    : 100;

const InitialWorldTime = 0x9705bb0d;
const InitialState = 0x4905ed7b;

const RoomRuntime = Object.freeze({
    Value0: 128,
    Value0Dirty: 132,
    Value1: 136,
    Value1Dirty: 144,
    Value2: 148,
    Value2Dirty: 152,
    OwnerFlag: 153,
    OwnerFlagDirty: 154,
    Value4: 156,
    Value4Dirty: 160,
    RelatedCount: 161,
    RelatedCountDirty: 162,
    RelatedIdsDirty: 163,
    RelatedIds: 176,
    CustomizationDirty: 224,
    CustomizationBlock: 228,
    CustomizationSize: 4856,
    PlayerStateBlock: 5088,
    PlayerStateSize: 2712,
    PlayerStateDirty: 7800,
    UserDataCount: 7808,
    UserDataCountDirty: 7816,
    UserDataIdsDirty: 7817,
    UserDataIds: 7824,
    UserDataBuffers: 7864,
    UserDataLengths: 7904,
    UserDataDirty: 7924,
    FeatureA: 7929,
    FeatureADirty: 7930,
    FeatureB: 7931,
    FeatureBDirty: 7932,
    FeatureC: 7933,
    FeatureCDirty: 7934,
    FinalValue: 7936,
    FinalValueDirty: 7944,
});

const RoomFields = Object.freeze([
    { Name: 'WorldTime', Type: 'u32', Size: 4 },
    { Name: 'OwnerId', Type: 'u64', Size: 8 },
    { Name: 'State', Type: 'u32', Size: 4 },
    { Name: 'IsValid', Type: 'u8', Size: 1 },
    { Name: 'GameType', Type: 'u32', Size: 4 },
    { Name: 'RelatedCount', Type: 'u8', Size: 1 },
    ...Array.from({ length: 6 }, (_, Index) => ({ Name: `RelatedId${Index}`, Type: 'u64', Size: 8 })),
    { Name: 'Customization', Type: 'blob32', FixedLength: 4856 },
    { Name: 'PlayerState', Type: 'blob32', FixedLength: 2712 },
    { Name: 'UserDataCount', Type: 'u64', Size: 8 },
    ...Array.from({ length: 5 }, (_, Index) => ({ Name: `UserDataId${Index}`, Type: 'u64', Size: 8 })),
    ...Array.from({ length: 5 }, (_, Index) => ({ Name: `UserData${Index}`, Type: 'blob32' })),
    { Name: 'FeatureA', Type: 'u8', Size: 1 },
    { Name: 'FeatureB', Type: 'u8', Size: 1 },
    { Name: 'FeatureC', Type: 'u8', Size: 1 },
    { Name: 'FinalValue', Type: 'u64', Size: 8 },
]);

function DecodeRoom(Parsed) {
    if (!Parsed || Parsed.Class !== RoomClass || Parsed.FlagCount !== RoomFields.length || !Parsed.Values) {
        return null;
    }
    const Present = new Set(Parsed.Flags);
    const Fields = {};
    let Offset = 0;
    for (let Index = 0; Index < RoomFields.length; Index++) {
        if (!Present.has(Index)) continue;
        const Field = RoomFields[Index];
        if (Field.Type === 'blob32') {
            if (Offset + 4 > Parsed.Values.length) return null;
            const Length = Parsed.Values.readUInt32LE(Offset);
            Offset += 4;
            if (Field.FixedLength !== undefined && Length !== 0 && Length !== Field.FixedLength) return null;
            if (Offset + Length > Parsed.Values.length) return null;
            Fields[Field.Name] = Buffer.from(Parsed.Values.slice(Offset, Offset + Length));
            Offset += Length;
            continue;
        }
        if (Offset + Field.Size > Parsed.Values.length) return null;
        if (Field.Type === 'u8') Fields[Field.Name] = Parsed.Values.readUInt8(Offset);
        else if (Field.Type === 'u32') Fields[Field.Name] = Parsed.Values.readUInt32LE(Offset) >>> 0;
        else Fields[Field.Name] = Parsed.Values.readBigUInt64LE(Offset);
        Offset += Field.Size;
    }
    const Rest = Parsed.Values.subarray(Offset);
    return { Fields: Fields, BytesRead: Offset, Complete: Rest.every((Byte) => Byte === 0) };
}

function DecodeRoomPayload(Payload) {
    if (!Buffer.isBuffer(Payload) || Payload.length < 20) return null;
    const Parsed = {
        Class: RoomClass,
        FlagCount: RoomFields.length,
        Key: Payload.readBigUInt64BE(0),
        Version: Payload.readBigUInt64BE(8),
        Flags: ObjectFrame.ReadFlags(Payload, 16, RoomFields.length),
        Values: Payload.slice(20),
    };
    Parsed.Room = DecodeRoom(Parsed);
    return Parsed.Room && Parsed.Room.Complete ? Parsed : null;
}

const Rooms = new Map();
let TemplateAttempted = false;
let TemplateFrame = null;

function IsMyCourt(Connection) {
    return !!Connection && String(Connection.ActivityName || '').toLowerCase() === 'mycourt';
}

function ParseRoom(Bytes) {
    const Parsed = ObjectFrame.Parse(Bytes);
    if (!Parsed || Parsed.Class !== RoomClass) return null;
    Parsed.Room = DecodeRoom(Parsed);
    return Parsed.Room && Parsed.Room.Complete ? Parsed : null;
}

function ParseRoomList(Bytes) {
    if (
        !Buffer.isBuffer(Bytes) ||
        Bytes.length < 23 ||
        Bytes.readUInt32LE(0) !== Bytes.length ||
        Bytes.readUInt32BE(4) !== ObjectDataListPacket
    )
        return null;
    const Count = Bytes.readUInt8(16);
    const ClassCrc = Bytes.readUInt32BE(17) >>> 0;
    if (!Count || ClassCrc !== RoomClass) return null;
    let Offset = 23;
    const Records = [];
    for (let Index = 0; Index < Count; Index++) {
        if (Offset + 9 > Bytes.length) return null;
        const ObjectId = Bytes.readBigUInt64BE(Offset);
        const Length = Bytes.readUInt8(Offset + 8);
        const End = Offset + 9 + Length;
        if (End > Bytes.length) return null;
        const Payload = Buffer.from(Bytes.slice(Offset + 9, End));
        const Parsed = DecodeRoomPayload(Payload);
        if (!Parsed) return null;
        Records.push({ ObjectId: ObjectId, Payload: Payload, Parsed: Parsed });
        Offset = End;
    }
    return Offset === Bytes.length ? { Count: Count, Class: ClassCrc, Records: Records } : null;
}

function ListContainsRoom(Bytes) {
    return ParseRoomList(Bytes) !== null;
}

function PacketRoom(Bytes, PacketId) {
    const Parsed = ParseRoom(Bytes);
    if (Parsed) return { Parsed: Parsed, List: false };
    if (PacketId === ObjectDataListPacket) {
        const List = ParseRoomList(Bytes);
        if (List) return { Parsed: { ObjectId: null, Class: RoomClass, RoomList: List }, List: true };
    }
    return null;
}

function ExtractTemplateFrame(Input) {
    if (Buffer.isBuffer(Input)) {
        const Id = Input.length >= 8 ? Input.readUInt32BE(4) >>> 0 : null;
        return Id !== null && IsRoomPacket(Id) && PacketRoom(Input, Id) ? Buffer.from(Input) : null;
    }
    if (typeof Input !== 'string') return null;
    for (const Line of Input.split(/\r?\n/)) {
        const Hex = Line.split(/\s+/).find(
            (Token) => Token.length >= 32 && /^[0-9a-f]+$/i.test(Token) && !(Token.length & 1),
        );
        if (!Hex) continue;
        let Frame;
        try {
            Frame = Buffer.from(Hex, 'hex');
        } catch (_) {
            continue;
        }
        const Id = Frame.length >= 8 ? Frame.readUInt32BE(4) >>> 0 : null;
        if (Id !== null && IsRoomPacket(Id) && PacketRoom(Frame, Id)) return Frame;
    }
    return null;
}

function RoomTemplate() {
    if (TemplateAttempted) return TemplateFrame;
    TemplateAttempted = true;
    const File = process.env.OPAL_MYCOURT_ROOM_FRAME;
    if (!File) return null;
    try {
        const Input = Fs.readFileSync(File);
        TemplateFrame = ExtractTemplateFrame(File.toLowerCase().endsWith('.txt') ? Input.toString('utf8') : Input);
        if (!TemplateFrame) {
            Log.Error(`MyCourt room template ${File} contains no complete 0x16A0D01E frame`);
        } else {
            Log.Verbose(`  loaded MyCourt room template ${File} (${TemplateFrame.length} bytes)`);
        }
    } catch (Failure) {
        Log.Error(`MyCourt room template ${File} could not be read: ${Failure.message}`);
    }
    return TemplateFrame;
}

function RoomScopeFor(Connection) {
    const Owner =
        Connection.Puid !== null && Connection.Puid !== undefined
            ? Connection.Puid
            : Connection.ClaimedPuid !== null && Connection.ClaimedPuid !== undefined
              ? Connection.ClaimedPuid
              : null;
    if (Owner === null) return `mycourt:connection-${Connection.Id}`;
    return `mycourt:${BigInt.asUintN(64, BigInt(Owner)).toString(16).padStart(16, '0')}`;
}

function RelayTokenFor(Connection) {
    const Token = Buffer.from(require('../Activity/Init').Variant.MyCourt.Data);
    const Scope = Connection.RoomScope || RoomScopeFor(Connection);
    const Hex = Scope.slice('mycourt:'.length);
    if (/^[0-9a-f]{16}$/.test(Hex)) Token.writeBigUInt64BE(BigInt('0x' + Hex), 0);
    else Token.writeBigUInt64BE(0x4d59434f55525400n | BigInt(Connection.Id & 0xff), 0);
    return Token;
}

function RoomKey(Connection, ObjectId) {
    const Activity = Connection.RoomScope
        ? Connection.RoomScope
        : Connection.ActivityKey === null || Connection.ActivityKey === undefined
          ? 'mycourt'
          : (Connection.ActivityKey >>> 0).toString(16);
    if (ObjectId !== null && ObjectId !== undefined) {
        return `${Activity}:${BigInt(ObjectId).toString(16)}`;
    }
    return `${Activity}:list`;
}

function IsRoomPacket(PacketId) {
    return (
        PacketId === ObjectDataPacket ||
        PacketId === ObjectDataListPacket ||
        PacketId === ObjectUpdatePacket ||
        PacketId === LegacyObjectUpdatePacket
    );
}

function SessionObjectId(SessionId, Index = RoomObjectIndex) {
    return (BigInt(SessionId) << 32n) | BigInt(Index);
}

function BuildBootstrap(Connection) {
    if (
        !Connection ||
        Connection.Puid === null ||
        Connection.Puid === undefined ||
        Connection.SessionId === null ||
        Connection.SessionId === undefined
    )
        return null;
    const ObjectId = SessionObjectId(Connection.SessionId);
    const Values = Buffer.alloc(16);
    Values.writeUInt32LE(InitialWorldTime >>> 0, 0);
    Values.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Connection.Puid)), 4);
    Values.writeUInt32LE(InitialState >>> 0, 12);
    const Payload = ObjectFrame.BuildPayload({
        key: ObjectId,
        version: 1n,
        ClassCrc: RoomClass,
        Bits: [0, 1, 2],
        Values,
    });
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId,
        ClassCrc: RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function PublishBootstrap(Connection) {
    if (!IsMyCourt(Connection) || Connection.State !== 2 || Connection.MyCourtBootstrapSent) return false;
    const Frame = BuildBootstrap(Connection);
    if (!Frame) {
        Log.Error(
            `${Connection.Identifier} could not receive a MyCourt bootstrap because its PUID or session is missing`,
        );
        return false;
    }
    const Parsed = ParseRoom(Frame);
    if (!Parsed || !Connection.SendObject(Frame)) return false;
    Connection.MyCourtBootstrapSent = true;
    Rooms.set(RoomKey(Connection, Parsed.ObjectId), {
        Frame: Buffer.from(Frame),
        Source: Connection.Id,
        Bootstrap: true,
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    RoomStates.set(RoomKey(Connection, Parsed.ObjectId), {
        ObjectId: Parsed.ObjectId,
        Version: Parsed.Version,
        Fields: { ...Parsed.Room.Fields },
        Source: Connection.Id,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    Log.Info(
        `${Connection.Identifier} received the NBA2K19 MyCourt ownership bootstrap ` +
            `(owner 0x${BigInt(Connection.Puid).toString(16).padStart(16, '0')}, ` +
            `object ${Parsed.ObjectId.toString(16).toUpperCase()})`,
    );
    Log.Verbose(
        `  room revision 1, fields WorldTime=WALKING, OwnerId=self, State=NONE, ` +
            `sent ${BootstrapDelayMs}ms after init`,
    );
    return true;
}

function ScheduleBootstrap(Connection) {
    if (!IsMyCourt(Connection) || Connection.MyCourtBootstrapSent || Connection.MyCourtBootstrapTimer) return false;
    const Timer = setTimeout(() => {
        Connection.MyCourtBootstrapTimer = null;
        if (!Connection.Closed) PublishBootstrap(Connection);
    }, BootstrapDelayMs);
    if (Timer.unref) Timer.unref();
    Connection.MyCourtBootstrapTimer = Timer;
    return true;
}

const RoomStates = new Map();

const CribState = Object.freeze({
    None: InitialState,
    Scrimmage: 0x9712981b,
});

function EncodeRoom(Fields) {
    const Bits = [];
    const Parts = [];
    RoomFields.forEach((Field, Index) => {
        const Value = Fields[Field.Name];
        if (Value === undefined || Value === null) return;
        Bits.push(Index);
        if (Field.Type === 'blob32') {
            const Count = Buffer.alloc(4);
            Count.writeUInt32LE(Value.length, 0);
            Parts.push(Count, Value);
        } else if (Field.Type === 'u8') {
            Parts.push(Buffer.from([Number(Value) & 0xff]));
        } else if (Field.Type === 'u32') {
            const Out = Buffer.alloc(4);
            Out.writeUInt32LE(Number(Value) >>> 0, 0);
            Parts.push(Out);
        } else {
            const Out = Buffer.alloc(8);
            Out.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Value)), 0);
            Parts.push(Out);
        }
    });
    return { Bits: Bits, Values: Buffer.concat(Parts) };
}

function RoomStateFor(Connection, ObjectId) {
    const Id = ObjectId === null || ObjectId === undefined ? SessionObjectId(Connection.SessionId) : BigInt(ObjectId);
    const Key = RoomKey(Connection, Id);
    let State = RoomStates.get(Key);
    if (!State) {
        State = {
            ObjectId: Id,
            Version: 0n,
            Fields: {},
            Source: Connection.Id,
            ActivityKey:
                Connection.ActivityKey === null || Connection.ActivityKey === undefined
                    ? null
                    : Connection.ActivityKey >>> 0,
            RoomScope: Connection.RoomScope || null,
        };
        RoomStates.set(Key, State);
    }
    return { Key: Key, State: State };
}

function BuildRoomFrame(State) {
    const Encoded = EncodeRoom(State.Fields);
    const Payload = ObjectFrame.BuildPayload({
        key: State.ObjectId,
        version: State.Version,
        ClassCrc: RoomClass,
        Bits: Encoded.Bits,
        Values: Encoded.Values,
    });
    return ObjectFrame.Build({
        PacketId: ObjectDataPacket,
        ConnectionId: null,
        ObjectId: State.ObjectId,
        ClassCrc: RoomClass,
        Payload,
        Layout: ObjectFrame.Layout.Nineteen,
    });
}

function PublishRoomState(Connection, Key, State, SeenVersion = 0n) {
    const Seen = BigInt(SeenVersion || 0n);
    State.Version = (Seen > State.Version ? Seen : State.Version) + 1n;
    const Frame = BuildRoomFrame(State);
    Rooms.set(Key, {
        Frame: Frame,
        Source: State.Source,
        ObjectId: State.ObjectId,
        ActivityKey: State.ActivityKey,
        RoomScope: State.RoomScope || null,
    });
    let Sent = Connection.SendObject(Frame) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && Peer.SendObject(Frame)) Sent++;
    }
    return { Frame: Frame, Sent: Sent };
}

function StartCribGame(Connection, ObjectId, Game) {
    if (!IsMyCourt(Connection)) return null;
    if (
        (ObjectId === null || ObjectId === undefined) &&
        (Connection.SessionId === null || Connection.SessionId === undefined)
    )
        return null;
    const { Key, State } = RoomStateFor(Connection, ObjectId);
    const Players = (Game.Players || []).slice(0, 6).map((Player) => BigInt(Player));
    State.Fields.State = CribState.Scrimmage;
    State.Fields.GameType = Number(Game.GameSlot) >>> 0;
    State.Fields.RelatedCount = Players.length;
    for (let Index = 0; Index < 6; Index++) {
        State.Fields[`RelatedId${Index}`] = Index < Players.length ? Players[Index] : 0n;
    }
    const Out = PublishRoomState(Connection, Key, State);
    return { ObjectId: State.ObjectId, Version: State.Version, Sent: Out.Sent, Frame: Out.Frame };
}

function EndCribGame(Connection, ObjectId) {
    if (!IsMyCourt(Connection)) return null;
    if (
        (ObjectId === null || ObjectId === undefined) &&
        (Connection.SessionId === null || Connection.SessionId === undefined)
    )
        return null;
    const { Key, State } = RoomStateFor(Connection, ObjectId);
    State.Fields.State = CribState.None;
    State.Fields.RelatedCount = 0;
    for (let Index = 0; Index < 6; Index++) State.Fields[`RelatedId${Index}`] = 0n;
    const Out = PublishRoomState(Connection, Key, State);
    return { ObjectId: State.ObjectId, Version: State.Version, Sent: Out.Sent, Frame: Out.Frame };
}

function Relay(Connection, Bytes, PacketId = null) {
    if (!Buffer.isBuffer(Bytes)) return false;
    const Id = PacketId === null ? (Bytes.length >= 8 ? Bytes.readUInt32BE(4) >>> 0 : null) : Number(PacketId) >>> 0;
    if (!IsMyCourt(Connection) || Id === null || !IsRoomPacket(Id)) {
        return false;
    }
    const Packet = PacketRoom(Bytes, Id);
    if (!Packet) return false;
    const Parsed = Packet.Parsed;

    if ((Id === ObjectUpdatePacket || Id === LegacyObjectUpdatePacket) && !Packet.List) {
        const { Key, State } = RoomStateFor(Connection, Parsed.ObjectId);
        Object.assign(State.Fields, Parsed.Room.Fields);
        const Out = PublishRoomState(Connection, Key, State, Parsed.Version);
        const Names = Parsed.Flags.map((Bit) => RoomFields[Bit].Name);
        Log.Info(
            `${Connection.Identifier} updated MyCourt room ${Parsed.ObjectId.toString(16).toUpperCase()} ` +
                `(${Names.length ? Names.join(', ') : 'no fields'}); answered at revision ${State.Version} ` +
                `to ${Out.Sent} ${Out.Sent === 1 ? 'player' : 'players'}`,
        );
        return true;
    }

    const Key = RoomKey(Connection, Parsed.ObjectId);
    Rooms.set(Key, {
        Frame: Buffer.from(Bytes),
        Source: Connection.Id,
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });

    let Sent = Connection.SendObject(Bytes) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && Peer.SendObject(Bytes)) Sent++;
    }
    const ObjectLabel = Packet.List
        ? 'object list containing room state'
        : `room object ${Parsed.ObjectId.toString(16).toUpperCase()}`;
    Log.Info(
        `${Connection.Identifier} published MyCourt ${ObjectLabel} ` +
            `(${Bytes.length} bytes) to ${Sent} ${Sent === 1 ? 'player' : 'players'}`,
    );
    if (Packet.List) {
        Log.Verbose(
            `  ${Parsed.RoomList.Count} native room record${Parsed.RoomList.Count === 1 ? '' : 's'} ` +
                `validated in the compact 2K19 object-list layout`,
        );
    } else {
        const Names = Parsed.Flags.map((Bit) => RoomFields[Bit].Name);
        const Owner = Parsed.Room.Fields.OwnerId;
        const Related = Parsed.Room.Fields.RelatedCount;
        const Userdata = Parsed.Room.Fields.UserDataCount;
        Log.Verbose(
            `  room revision ${Parsed.Version.toString()}, ${Parsed.Flags.length}/29 fields present` +
                `${Owner === undefined ? '' : `, owner ${Owner}`}` +
                `${Related === undefined ? '' : `, related ${Related}`}` +
                `${Userdata === undefined ? '' : `, userdata ${Userdata.toString()}`}` +
                `${Names.length ? `: ${Names.join(', ')}` : ''}`,
        );
    }
    return true;
}

function PublishTemplate(Connection) {
    if (!IsMyCourt(Connection) || Connection.State !== 2) return false;
    const Frame = RoomTemplate();
    if (!Frame) return false;
    const PacketId = Frame.readUInt32BE(4) >>> 0;
    const Packet = PacketRoom(Frame, PacketId);
    if (!Packet) return false;
    const Parsed = Packet.Parsed;
    Rooms.set(RoomKey(Connection, Parsed.ObjectId), {
        Frame: Buffer.from(Frame),
        Source: 'template',
        ObjectId: Parsed.ObjectId,
        ActivityKey:
            Connection.ActivityKey === null || Connection.ActivityKey === undefined
                ? null
                : Connection.ActivityKey >>> 0,
        RoomScope: Connection.RoomScope || null,
    });
    let Sent = Connection.SendObject(Frame) ? 1 : 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (IsMyCourt(Peer) && Peer.SendObject(Frame)) Sent++;
    }
    Log.Info(
        `${Connection.Identifier} received MyCourt room template (${Frame.length} bytes), ` +
            `sent to ${Sent} ${Sent === 1 ? 'player' : 'players'}`,
    );
    return Sent > 0;
}

function ReplayTo(Connection) {
    if (!IsMyCourt(Connection)) return 0;
    let Sent = 0;
    const ActivityKey =
        Connection.ActivityKey === null || Connection.ActivityKey === undefined ? null : Connection.ActivityKey >>> 0;
    for (const Room of Rooms.values()) {
        if (Room.ActivityKey !== ActivityKey) continue;
        if ((Room.RoomScope || null) !== (Connection.RoomScope || null)) continue;
        if (Connection.SendObject(Room.Frame)) Sent++;
    }
    if (Sent) Log.Verbose(`  ${Connection.Identifier} received ${Sent} MyCourt room object${Sent === 1 ? '' : 's'}`);
    return Sent;
}

function ClearConnection(Connection) {
    if (Connection.MyCourtBootstrapTimer) {
        clearTimeout(Connection.MyCourtBootstrapTimer);
        Connection.MyCourtBootstrapTimer = null;
    }
    for (const [Key, Room] of Rooms) {
        if (Room.Source === Connection.Id) Rooms.delete(Key);
    }
    for (const [Key, State] of RoomStates) {
        if (State.Source === Connection.Id) RoomStates.delete(Key);
    }
}

module.exports = {
    RoomScopeFor,
    RelayTokenFor,
    RoomClass,
    RoomClassSize,
    RoomRuntime,
    RoomFields,
    ObjectDataPacket,
    ObjectDataListPacket,
    ObjectUpdatePacket,
    LegacyObjectUpdatePacket,
    RoomObjectIndex,
    BootstrapDelayMs,
    InitialWorldTime,
    InitialState,
    Rooms,
    IsMyCourt,
    IsRoomPacket,
    ParseRoom,
    ListContainsRoom,
    DecodeRoom,
    DecodeRoomPayload,
    ParseRoomList,
    ExtractTemplateFrame,
    RoomTemplate,
    PublishTemplate,
    SessionObjectId,
    BuildBootstrap,
    PublishBootstrap,
    ScheduleBootstrap,
    Relay,
    ReplayTo,
    ClearConnection,
    RoomStates,
    CribState,
    EncodeRoom,
    RoomStateFor,
    BuildRoomFrame,
    PublishRoomState,
    StartCribGame,
    EndCribGame,
};
