// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc } = require('../Core/Names');
const { Hex } = require('../Core/Crc32');
const FieldList = require('../Codec/FieldList');
const Frame = require('../Codec/Frame');
const Worlds = require('./Worlds');

const PacketId = 0x9ffcdad0;
const SubOpcode = 0x86073f8c;

const SpectatorSubOpcode = 0xb0bf29b0;

const RouteWindowLength = 1024;
const BodyLength = 226 + RouteWindowLength;

const Offset = {
    SubOpcode: 0,
    SessionId: 4,
    ServerType: 28,
    WorldKey: 176,
    TicketLength: 224,
    Url: 226,
};

function BuildTicket(SessionId, ServerType, WorldKey) {
    return new FieldList.Builder()
        .AddU32(0x05385d34, 0xbbe63b84)
        .AddU64('MATCH_VERSION', SessionId)
        .AddU32(0x5cedb580, ServerType)
        .AddU32('WORLD_TYPE', ServerType)
        .AddU32('LOCATION', WorldKey)
        .AddU64('MATCH_ID', SessionId)
        .Build();
}

function Build({
    SessionId,
    ServerType,
    WorldKey,
    url: Url,
    ConnectionId = null,
    SubOpcode: SubOpcodeValue = SubOpcode,
}) {
    const Index = Worlds.AssertRoutable(WorldKey);

    const Body = Buffer.alloc(BodyLength);
    Body.writeUInt32BE(SubOpcodeValue >>> 0, Offset.SubOpcode);
    Body.writeBigUInt64BE(BigInt.asUintN(64, BigInt(SessionId)), Offset.SessionId);
    Body.writeUInt32BE(ServerType >>> 0, Offset.ServerType);
    Body.writeUInt32BE(WorldKey >>> 0, Offset.WorldKey);

    const Address = Buffer.from(String(Url) + '\0', 'utf8');
    const Ticket = BuildTicket(SessionId, ServerType, WorldKey);
    const TicketOffset = Offset.Url + Address.length;
    if (TicketOffset + Ticket.length > BodyLength) {
        throw new Error(
            `change server route data exceeds the packet ` + `(${TicketOffset + Ticket.length} of ${BodyLength})`,
        );
    }
    Body.writeUInt16BE(Ticket.length, Offset.TicketLength);
    Address.copy(Body, Offset.Url);
    Ticket.copy(Body, TicketOffset);

    return {
        Frame: Frame.Build(PacketId, ConnectionId, Body, Frame.InnerHeader.None),
        WorldIndex: Index,
        WorldName: Worlds.NameOf(WorldKey),
    };
}

function BuildSpectator({ SessionId, ServerType, WorldKey, url: Url, ConnectionId = null }) {
    return Build({ SessionId, ServerType, WorldKey, url: Url, ConnectionId, SubOpcode: SpectatorSubOpcode });
}

function HostFor(Socket) {
    if (process.env.OPAL_PUBLIC_HOST) return process.env.OPAL_PUBLIC_HOST;
    const Raw = (Socket && Socket.localAddress) || '127.0.0.1';
    const Address = Raw.replace(/^::ffff:/, '');
    if (Address === '127.0.0.1' || Address === '::1' || Address === '0.0.0.0' || Address === '::') {
        return process.env.OPAL_RELAY_HOST || '127.0.0.1';
    }
    return Address;
}

function UrlFor(Socket, Port, Path = '/') {
    return `wss://${HostFor(Socket)}:${Port}${Path}`;
}

const NeverTravel = new Set([0x9d32c5b4]);
const StartConnection = 0x5bb78c48;

function IsTravelRequest(Bytes, PacketIdValue) {
    if (NeverTravel.has(PacketIdValue >>> 0)) return false;
    if (!Bytes || Bytes.length < 32) return false;
    const Command = FieldList.Scan(Bytes, 'COMMAND');
    if (Command && Command.Type === FieldList.Type.U32 && Command.Data1 >>> 0 === StartConnection) return true;
    return !!FieldList.Scan(Bytes, StartConnection);
}

function ReadRequest(Bytes) {
    const Value = (Name) => {
        const Field = FieldList.Scan(Bytes, Name);
        if (!Field) return null;
        return Field.Value !== undefined ? Field.Value : Field.Data1 >>> 0;
    };
    return {
        ServerType: Value('NAME'),
        WorldKey: Value('LOCATION'),
        Activity: Value(0x4b7ad8c3),
        WorldIndex: Value(0x693736f0),
        MatchType: Value('MATCH_TYPE'),
        Puid: Value('PUID'),
    };
}

function IsMyCourtDestination(Req) {
    return Req.ServerType >>> 0 === Worlds.ServerType.MyCourt || Req.WorldKey >>> 0 === Crc('CRIB');
}

function ServerTypeFor(Req) {
    if (Req && Req.ServerType) {
        if (typeof Req.ServerType === 'string') {
            const Name = Req.ServerType.trim().toUpperCase();
            if (Name === 'MYCOURT' || Name === 'CRIB') return Worlds.ServerType.MyCourt;
            if (Name === 'WORLD') return Worlds.ServerType.World;
            if (Name === 'PARK') return Worlds.ServerType.Park;
            return Crc(Name) >>> 0;
        }
        const Numeric = Req.ServerType >>> 0;
        if (Numeric) return Numeric;
    }
    if (IsMyCourtDestination(Req)) return Worlds.ServerType.MyCourt;
    const World = Req && Req.WorldKey !== null && Req.WorldKey !== undefined ? Req.WorldKey >>> 0 : 0;
    if (World === Crc('BOULEVARD')) return Worlds.ServerType.World;
    return Worlds.ServerType.Park;
}

module.exports = {
    PacketId,
    SubOpcode,
    SpectatorSubOpcode,
    RouteWindowLength,
    BodyLength,
    Offset,
    Build,
    BuildSpectator,
    BuildTicket,
    HostFor,
    UrlFor,
    IsTravelRequest,
    ReadRequest,
    IsMyCourtDestination,
    ServerTypeFor,
    StartConnection,
    Hex,
};
