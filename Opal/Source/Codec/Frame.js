// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Hex } = require('../Core/Crc32');

const HeaderSize = 16;

const InnerHeader = { None: 0, Object: 12, Pending: 20 };

function Parse(Bytes) {
    if (!Buffer.isBuffer(Bytes) || Bytes.length < HeaderSize) return null;
    return {
        Length: Bytes.readUInt32LE(0),
        PacketId: Bytes.readUInt32BE(4) >>> 0,
        ConnectionId: Bytes.slice(8, 16),
        Buffer: Bytes,
    };
}

function IsWellFormed(Frame) {
    return !!Frame && Frame.Length === Frame.Buffer.length;
}

function ReadInnerHeader(Bytes, Kind) {
    let Inner;
    if (Kind === InnerHeader.Object) {
        Inner = {
            ObjectId: Bytes.readBigUInt64BE(HeaderSize),
            PayloadLength: Bytes.readUInt32BE(HeaderSize + 8),
            BodyOffset: HeaderSize + 12,
        };
    } else if (Kind === InnerHeader.Pending) {
        Inner = {
            ObjectId: Bytes.readBigUInt64BE(HeaderSize + 8),
            PayloadLength: Bytes.readUInt32BE(HeaderSize + 16),
            BodyOffset: HeaderSize + 20,
        };
    } else {
        Inner = { ObjectId: 0n, PayloadLength: Bytes.length - HeaderSize, BodyOffset: HeaderSize };
    }

    const Available = Bytes.length - Inner.BodyOffset;
    Inner.Available = Available;
    Inner.Shortfall = Math.max(0, Inner.PayloadLength - Available);
    Inner.Complete = Inner.Shortfall === 0;
    return Inner;
}

function Build(PacketId, ConnectionId, Body, Inner) {
    const Kind = Inner || InnerHeader.None;
    const Total = HeaderSize + Kind + Body.length;
    const Bytes = Buffer.alloc(Total);
    Bytes.writeUInt32LE(Total, 0);
    Bytes.writeUInt32BE(PacketId >>> 0, 4);
    if (ConnectionId) ConnectionId.copy(Bytes, 8, 0, Math.min(8, ConnectionId.length));

    if (Kind === InnerHeader.Object) {
        Bytes.writeUInt32BE(Body.length, HeaderSize + 8);
        Body.copy(Bytes, HeaderSize + 12);
    } else if (Kind === InnerHeader.Pending) {
        Bytes.writeUInt32BE(Body.length, HeaderSize + 16);
        Body.copy(Bytes, HeaderSize + 20);
    } else {
        Body.copy(Bytes, HeaderSize);
    }
    return Bytes;
}

function Describe(Frame) {
    return `${Hex(Frame.PacketId)} length ${Frame.Length} connection ${Frame.ConnectionId.toString('hex')}`;
}

module.exports = { HeaderSize, InnerHeader, Parse, IsWellFormed, ReadInnerHeader, Build, Describe };
