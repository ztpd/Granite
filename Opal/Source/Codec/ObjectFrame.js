// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Hex } = require('../Core/Crc32');

const NineteenLayout = {
    Name: '2k19',
    ObjectId: 16,
    Class: 24,
    Length: 28,
    LengthWidth: 4,
    Payload: 32,
};
const Layout = {
    Nineteen: NineteenLayout,
    TwentyOne: NineteenLayout,
    TwentySix: { Name: '2k26', ObjectId: 24, Class: 32, Length: 36, LengthWidth: 4, Payload: 40 },
    Update: { Name: 'update', ObjectId: 16, Class: 24, Length: 28, LengthWidth: 2, Payload: 30 },

    Player: {
        Name: 'player',
        Sequence: 16,
        ObjectId: 24,
        Class: 32,
        Schema: 36,
        Length: 40,
        LengthWidth: 2,
        Payload: 42,
    },
};

const PlayerSchema = 0xdd85f493;

const Body = { Key: 0, Version: 8, Flags: 16 };

const Classes = {
    0x16a0d01e: { Name: 'MYCOURT_ROOM', Flags: 29, Sizes: null },
    0x2c4d49e3: { Name: 'COURT', Flags: 148, Sizes: null },
    0x2c5d2702: {
        Name: 'PLAYER',
        Flags: 40,
        Sizes: [
            8, 8, 8, 8, 4, 4, 4, 1, 1, 4, 2, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4,
            4, 4, 4, 4,
        ],
    },
    0x90acaee4: { Name: 'SLOT', Flags: 7, Sizes: null },
    0x8033af3b: { Name: 'SQUAD', Flags: 33, Sizes: null },
    0x36bf2a26: { Name: 'MOVEMENT', Flags: 9, Sizes: null },
};

const ReferenceClasses = Object.freeze({
    0xcae1f30d: { Name: 'WALKON', Flags: 208, Sizes: null },
});

const LegacyFlags2K19 = Object.freeze({
    0x16a0d01e: 29,
    0x2c4d49e3: 147,
    0x2c5d2702: 40,
    0x8033af3b: 18,
    0x90acaee4: 7,
    0x36bf2a26: 9,
});

function ClassOf(Crc) {
    return Classes[Crc >>> 0] || null;
}

function ClassForLayout(Crc, LayoutData) {
    const Known = ClassOf(Crc);
    if (!Known || LayoutData !== Layout.Nineteen || LegacyFlags2K19[Crc >>> 0] === undefined) {
        return Known;
    }
    return { ...Known, Flags: LegacyFlags2K19[Crc >>> 0], Evidence: 'NBA2K19 IDA' };
}

function FlagBytes(Count) {
    return Math.ceil(Count / 8);
}

function ReadFlags(Bytes, Offset, Count) {
    const Bits = [];
    for (let I = 0; I < Count; I++) {
        const Byte = Bytes[Offset + (I >> 3)];
        if (Byte === undefined) break;
        if (Byte & (0x80 >> (I & 7))) Bits.push(I);
    }
    return Bits;
}

function WriteFlags(Bits, Count) {
    const Bytes = Buffer.alloc(FlagBytes(Count));
    for (const Bit of Bits) {
        if (Bit < 0 || Bit >= Count) throw new Error(`flag ${Bit} is outside the ${Count} this class has`);
        Bytes[Bit >> 3] |= 0x80 >> (Bit & 7);
    }
    return Bytes;
}

function ValueOffset(Bits, Want, Sizes) {
    if (!Sizes || !Bits.includes(Want)) return -1;
    let Offset = 0;
    for (const Bit of Bits) {
        if (Bit === Want) return Offset;
        if (Bit >= Sizes.length) return -1;
        Offset += Sizes[Bit];
    }
    return -1;
}

function DetectLayout(Bytes) {
    let Fallback = null;
    for (const LayoutData of [Layout.Player, Layout.Nineteen, Layout.TwentySix, Layout.Update]) {
        if (Bytes.length < LayoutData.Payload) continue;
        const Declared =
            LayoutData.LengthWidth === 2
                ? Bytes.readUInt16BE(LayoutData.Length)
                : Bytes.readUInt32BE(LayoutData.Length);
        if (LayoutData.Payload + Declared !== Bytes.length) continue;
        if (ClassOf(Bytes.readUInt32BE(LayoutData.Class))) return LayoutData;
        if (!Fallback) Fallback = LayoutData;
    }
    return Fallback;
}

function Parse(Bytes, LayoutData = null) {
    const Shape = LayoutData || DetectLayout(Bytes);
    if (!Shape) return null;

    const ClassCrc = Bytes.readUInt32BE(Shape.Class) >>> 0;
    const Known = ClassForLayout(ClassCrc, Shape);
    const PayloadLength = Shape.LengthWidth === 2 ? Bytes.readUInt16BE(Shape.Length) : Bytes.readUInt32BE(Shape.Length);
    const Payload = Bytes.slice(Shape.Payload, Shape.Payload + PayloadLength);

    const Parsed = {
        Layout: Shape,
        ObjectId: Bytes.readBigUInt64BE(Shape.ObjectId),
        Class: ClassCrc,
        ClassName: Known ? Known.Name : Hex(ClassCrc),
        PayloadLength: PayloadLength,
        Payload: Payload,
        Key: null,
        Version: null,
        Flags: [],
        Values: null,
        FlagCount: Known ? Known.Flags : null,
    };

    if (Payload.length >= Body.Flags) {
        Parsed.Key = Payload.readBigUInt64BE(Body.Key);
        Parsed.Version = Payload.readBigUInt64BE(Body.Version);
        if (Known) {
            Parsed.Flags = ReadFlags(Payload, Body.Flags, Known.Flags);
            Parsed.Values = Payload.slice(Body.Flags + FlagBytes(Known.Flags));
        }
    }
    return Parsed;
}

function ReadValue(Parsed, Bit) {
    const Known = ClassOf(Parsed.Class);
    if (!Known || !Known.Sizes || !Parsed.Values) return null;
    const Offset = ValueOffset(Parsed.Flags, Bit, Known.Sizes);
    if (Offset < 0) return null;
    const Size = Known.Sizes[Bit];
    if (Offset + Size > Parsed.Values.length) return null;
    return Parsed.Values.slice(Offset, Offset + Size);
}

function BuildPayload({ key: Key, version: Version, ClassCrc, Bits = [], Values = null }) {
    const Known = ClassOf(ClassCrc);
    if (!Known) throw new Error(`unknown object class ${Hex(ClassCrc)}`);
    const Head = Buffer.alloc(Body.Flags);
    Head.writeBigUInt64BE(BigInt(Key), Body.Key);
    Head.writeBigUInt64BE(BigInt(Version), Body.Version);
    return Buffer.concat([Head, WriteFlags(Bits, Known.Flags), Values || Buffer.alloc(0)]);
}

function Build({ PacketId, ConnectionId, ObjectId, ClassCrc, Payload, Layout: LayoutData = Layout.Nineteen }) {
    const Total = LayoutData.Payload + Payload.length;
    const Frame = Buffer.alloc(Total);
    Frame.writeUInt32LE(Total, 0);
    Frame.writeUInt32BE(PacketId >>> 0, 4);
    if (ConnectionId) ConnectionId.copy(Frame, 8, 0, Math.min(8, ConnectionId.length));
    Frame.writeBigUInt64BE(BigInt(ObjectId), LayoutData.ObjectId);
    Frame.writeUInt32BE(ClassCrc >>> 0, LayoutData.Class);
    if (LayoutData.Schema !== undefined) Frame.writeUInt32BE(PlayerSchema, LayoutData.Schema);
    if (LayoutData.LengthWidth === 2) Frame.writeUInt16BE(Payload.length, LayoutData.Length);
    else Frame.writeUInt32BE(Payload.length, LayoutData.Length);
    Payload.copy(Frame, LayoutData.Payload);
    return Frame;
}

module.exports = {
    Layout,
    PlayerSchema,
    Body,
    Classes,
    ReferenceClasses,
    LegacyFlags2K19,
    ClassOf,
    ClassForLayout,
    FlagBytes,
    ReadFlags,
    WriteFlags,
    ValueOffset,
    DetectLayout,
    Parse,
    ReadValue,
    BuildPayload,
    Build,
};
