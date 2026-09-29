// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc } = require('../Core/Names');
const { ByteSwap, Hex } = require('../Core/Crc32');
const { InnerHeader } = require('../Codec/Frame');

const Body = {
    FieldList: 'field-list',
    Packed: 'packed',
    Object: 'object',
    Unknown: 'unknown',
};

const Wire = (Name) => ByteSwap(Crc(Name));

const Packets = [
    {
        Name: 'HELLO',
        Id: Wire('HELLO'),
        Engine: 'TK_WORLD::SERVER::PlayerHandshake',
        Address: 'sub_141BECA40',
        Inner: InnerHeader.None,
        Body: Body.FieldList,
        Note: 'the old servers call this RoomConfig',
    },

    {
        Name: 'HEARTBEAT',
        Id: Wire('HEARTBEAT'),
        Engine: null,
        Address: null,
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: 'the real heartbeat; yfy calls this RELIABILITY_ACK',
    },

    {
        Name: 'OBJECT_DATA',
        Id: Wire('OBJECT_DATA'),
        Engine: 'TK_WORLD::SERVER::HandleObjectDataPacket',
        Address: 'sub_141245F40',
        Inner: InnerHeader.None,
        Body: Body.Object,
    },

    {
        Name: 'OBJECT_DATA_LIST',
        Id: Wire('OBJECT_DATA_LIST'),
        Engine: 'TK_WORLD::SERVER::HandleObjectDataListPacket',
        Address: 'sub_141245870',
        Inner: InnerHeader.None,
        Body: Body.Object,
    },

    {
        Name: 'OBJECT_UPDATE',
        Id: Wire('OBJECT_UPDATE'),
        Engine: 'TK_WORLD::SERVER::HandleObjectUpdatePacket',
        Address: 'sub_141246A10',
        Inner: InnerHeader.None,
        Body: Body.Object,
    },

    {
        Name: 'OBJECT_UPDATE_LIST',
        Id: Wire('OBJECT_UPDATE_LIST'),
        Engine: 'TK_WORLD::SERVER::HandleObjectUpdateListPacket',
        Address: 'sub_141246730',
        Inner: InnerHeader.None,
        Body: Body.Object,
        Note: 'exact 2K19 movement-delta path; one class followed by compact records',
    },

    {
        Name: null,
        Id: 0xa5feca35,
        Engine: 'TK_WORLD::SERVER::HandleObjectDestroyPacket',
        Address: 'sub_141246620',
        Inner: InnerHeader.None,
        Body: Body.Packed,
        Note: 'exact 2K19 body is one big-endian u64 object id',
    },

    {
        Name: 'REQUEST_ACK',
        Id: Wire('REQUEST_ACK'),
        Engine: 'TK_WORLD::SERVER::HandleRequestAckPacket',
        Address: 'sub_141246DD0 case +352',
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: 'ignores ids that are not pending',
    },

    {
        Name: 'COMMAND',
        Id: Wire('COMMAND'),
        Engine: 'TK_WORLD::SERVER::SendCommand',
        Address: 'sub_1412AB010',
        Inner: InnerHeader.None,
        Body: Body.FieldList,
        Note:
            'match request; the send core builds a 20 byte inner header on this path but ' +
            'what arrives has not been verified, so the field list is located by scanning ' +
            'rather than assumed. address disputed, peer notes say sub_14109DEA0',
    },

    {
        Name: null,
        Id: 0x9d32c5b4,
        Engine: 'TK_WORLD::SERVER::Connect',
        Address: 'sub_141B0A560',
        Inner: InnerHeader.None,
        Body: Body.FieldList,
    },

    {
        Name: null,
        Id: 0xfef2dd68,
        Engine: 'TK_WORLD::SERVER::SendObjectUpdate',
        Address: null,
        Inner: InnerHeader.None,
        Body: Body.Object,
        Note: 'dropped silently unless the connection has reached state 2',
    },

    {
        Name: null,
        Id: 0x9e3471ed,
        Engine: 'TK_WORLD::SERVER::UpdateCompressCommands',
        Address: 'sub_1412AB010 branch',
        Inner: InnerHeader.Object,
        Body: Body.FieldList,
        Note: 'compressed command transport; Master.js calls it a userdata broadcast',
    },

    {
        Name: null,
        Id: 0xce1c9e8c,
        Engine: null,
        Address: 'sub_1412AC750',
        Inner: InnerHeader.None,
        Body: Body.Packed,
        Note: 'per-tick player movement; the old servers misname it HEARTBEAT',
    },

    {
        Name: null,
        Id: 0x9ffcdad0,
        Engine: 'TK_WORLD::SERVER::HandleChangeServerPacket',
        Address: 'sub_141B04A20',
        Inner: InnerHeader.None,
        Body: Body.Packed,
        Note: 'body+0 carries sub-opcode 0x86073F8C, which is not a wire id',
    },

    {
        Name: null,
        Id: 0x7433cf29,
        Engine: null,
        Address: null,
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: 'state update; carries an embedded zlib court/object delta',
    },

    {
        Name: null,
        Id: 0x8040a74d,
        Engine: null,
        Address: null,
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: 'player telemetry',
    },

    {
        Name: null,
        Id: 0x3731f650,
        Engine: null,
        Address: null,
        Inner: InnerHeader.Object,
        Body: Body.FieldList,
        Note: 'anonymous branch of the send core; never seen in a capture',
    },

    {
        Name: null,
        Id: 0x5e92c26f,
        Engine: null,
        Address: 'sub_141246DD0+424',
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: '2K19 dispatcher case',
    },
    {
        Name: null,
        Id: 0xa5feca35,
        Engine: null,
        Address: 'sub_141246DD0+400',
        Inner: InnerHeader.None,
        Body: Body.Unknown,
        Note: '2K19 dispatcher case',
    },
];

const ById = new Map(Packets.map((P) => [P.Id >>> 0, P]));

function Lookup(PacketId) {
    return ById.get(PacketId >>> 0) || null;
}

function EngineName(PacketId) {
    const Packet = Lookup(PacketId);
    if (!Packet) return Hex(PacketId);
    return Packet.Engine || Packet.Address || Packet.Name || Hex(PacketId);
}

function InCode(PacketId) {
    return ByteSwap(PacketId);
}

const Evidence2K19 = Object.freeze({
    RequestAck: 0x2b84ffc2,
    PlayerHandshake: 0x366444c1,
    ObjectData: 0x9c72247c,
    ObjectDataList: 0x771f7646,
    ObjectUpdate: 0x01ae543f,
    ObjectUpdateList: 0x618ec78c,
    ClientUpdate: 0xfef2dd68,
    CompressedCommand: 0x9e3471ed,
    Movement: 0xce1c9e8c,
    ChangeServer: 0x9ffcdad0,
    StateUpdate: 0x7433cf29,
    Connect: 0x9d32c5b4,
    ObjectDestroy: 0xa5feca35,
    DispatcherOnly: Object.freeze([0x5e92c26f]),
});

module.exports = { Body, Packets, Lookup, EngineName, InCode, Wire, Evidence2K19 };
