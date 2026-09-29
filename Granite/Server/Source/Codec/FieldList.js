// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('node:zlib');
const { Crc32, U32, Hex32 } = require('../Core/Crc32');

const Types = Object.freeze({
    StringCrc: 0x1423add2,
    U32: 0x1423add2,
    U64: 0x3d9e5089,
    Packed: 0x320b919b,
    Binary: 0x36182e83,
    VCDate: 0x55c05a86,
    Bool8: 0x6314db26,
    String8: 0x6e46752f,
    String16: 0x7a4d534c,
    Guid: 0x18271c18,
    Uuid2: 0x3d4bbc04,
    F32: 0xb7ea1cd0,
    S64Observed: 0x39132c3b,
    U64ObservedAlt: 0x3914293b,
});

const TypeNames = new Map();
for (const [Name, Id] of Object.entries(Types)) {
    if (!TypeNames.has(Id >>> 0)) TypeNames.set(Id >>> 0, Name);
}

const JulianUnixEpochMs = 210866760000000n;

function AsU64(Value) {
    if (typeof Value === 'bigint') return BigInt.asUintN(64, Value);
    if (typeof Value === 'number' && Number.isSafeInteger(Value)) return BigInt.asUintN(64, BigInt(Value));
    return BigInt.asUintN(64, BigInt(String(Value)));
}

function IsU64Type(Type) {
    return [Types.U64, Types.VCDate, Types.S64Observed, Types.U64ObservedAlt].includes(Type >>> 0);
}

function MaybeGunzip(Bytes) {
    return Bytes.length >= 2 && Bytes[0] === 0x1f && Bytes[1] === 0x8b ? Zlib.gunzipSync(Bytes) : Bytes;
}

function FindTerminator(Bytes) {
    for (let Offset = 0; Offset + 16 <= Bytes.length; Offset += 16) {
        let Zero = true;
        for (let I = 0; I < 16; I++) Zero &&= Bytes[Offset + I] === 0;
        if (Zero) return Offset;
    }
    return -1;
}

function DecodeString16(Raw) {
    const Units = [];
    for (let I = 0; I + 1 < Raw.length; I += 2) {
        const Unit = Raw.readUInt16BE(I);
        if (Unit === 0) break;
        Units.push(Unit);
    }
    return String.fromCharCode(...Units);
}

function DecodeField(Field, Data) {
    const Type = Field.Type;
    if (
        Type === Types.String8 ||
        Type === Types.String16 ||
        Type === Types.Binary ||
        Type === Types.Guid ||
        Type === Types.Uuid2
    ) {
        const ByteLength = Type === Types.String16 ? Field.Data2 * 2 : Field.Data2;
        Field.DataOffset = Field.Data1;
        Field.length = Field.Data2;
        if (Field.Data1 + ByteLength > Data.length) {
            Field.Status = 'out_of_range';
            Field.value = null;
            return;
        }
        const Raw = Data.subarray(Field.Data1, Field.Data1 + ByteLength);
        Field.Raw = Raw;
        Field.RawHex = Raw.toString('hex');
        if (Type === Types.String8) {
            const End = Raw.length && Raw.at(-1) === 0 ? Raw.length - 1 : Raw.length;
            Field.value = Raw.subarray(0, End).toString('utf8');
        } else if (Type === Types.String16) {
            Field.value = DecodeString16(Raw);
        } else {
            Field.value = Raw;
        }
        return;
    }
    if (Type === Types.Bool8) {
        Field.value = Field.Data1 !== 0;
        return;
    }
    if (Type === Types.F32) {
        const Raw = Buffer.allocUnsafe(4);
        Raw.writeUInt32BE(Field.Data1, 0);
        Field.value = Raw.readFloatBE(0);
        return;
    }
    if (IsU64Type(Type)) {
        const Value = (BigInt(Field.Data1) << 32n) | BigInt(Field.Data2);
        Field.value = Value;
        Field.ValueHex = `0x${Value.toString(16).toUpperCase().padStart(16, '0')}`;
        if (Type === Types.VCDate) {
            const Unix = Value - JulianUnixEpochMs;
            Field.IsoDate =
                Unix >= -8640000000000000n && Unix <= 8640000000000000n ? new Date(Number(Unix)).toISOString() : null;
        }
        return;
    }
    Field.value = Field.Data1 >>> 0;
    Field.ValueHex = Hex32(Field.Data1);
}

function Parse(Body, Options = {}) {
    if (!Buffer.isBuffer(Body)) throw new TypeError('VcFieldList input must be a Buffer');
    const Declared = Number(Options.FieldListSize || 0);
    if (Declared && (!Number.isSafeInteger(Declared) || Declared < 16 || Declared > Body.length)) {
        throw new Error(`invalid VCFIELDLIST_SIZE ${Options.FieldListSize} for ${Body.length}-byte body`);
    }
    const Wire = Declared ? Body.subarray(0, Declared) : Body;
    const Trailing = Declared ? Body.subarray(Declared) : Buffer.alloc(0);
    const Bytes = Options.AutoGunzip === false ? Wire : MaybeGunzip(Wire);
    const TerminatorOffset = FindTerminator(Bytes);
    if (TerminatorOffset < 0) throw new Error('VcFieldList terminator was not found');
    if (TerminatorOffset / 16 > (Options.MaximumFields || 65536)) {
        throw new Error('VcFieldList exceeds the configured field limit');
    }
    const DataOffset = TerminatorOffset + 16;
    const Data = Bytes.subarray(DataOffset);
    const Fields = [];
    for (let Offset = 0, Index = 0; Offset < TerminatorOffset; Offset += 16, Index++) {
        const Field = {
            index: Index,
            RecordOffset: Offset,
            Crc: Bytes.readUInt32BE(Offset),
            Type: Bytes.readUInt32BE(Offset + 4),
            Data1: Bytes.readUInt32BE(Offset + 8),
            Data2: Bytes.readUInt32BE(Offset + 12),
        };
        Field.CrcHex = Hex32(Field.Crc);
        Field.TypeHex = Hex32(Field.Type);
        Field.TypeName = TypeNames.get(Field.Type) || 'Unknown';
        DecodeField(Field, Data);
        Fields.push(Field);
    }
    return {
        Fields,
        Data,
        DataOffset,
        TableBytes: TerminatorOffset + 16,
        DecodedSize: Bytes.length,
        WireSize: Wire.length,
        Compressed: Bytes !== Wire,
        Trailing,
    };
}

function TryParse(Body, Options = {}) {
    try {
        return { Ok: true, Parsed: Parse(Body, Options) };
    } catch (Failure) {
        return { Ok: false, Error: Failure };
    }
}

function GetFields(Fields, Crc, Type) {
    const Wanted = U32(Crc);
    return Fields.filter((Field) => Field.Crc === Wanted && (Type === undefined || Field.Type === U32(Type)));
}

function GetField(Fields, Crc, Index = 0, Type) {
    return GetFields(Fields, Crc, Type)[Index] || null;
}

function GetU64(Fields, Crc, Index = 0) {
    const Field = GetField(Fields, Crc, Index);
    if (!Field) return null;
    return (BigInt(Field.Data1) << 32n) | BigInt(Field.Data2);
}

function GetU32(Fields, Crc, Index = 0) {
    const Field = GetField(Fields, Crc, Index);
    return Field ? Field.Data1 >>> 0 : null;
}

function GetString8(Fields, Crc, Index = 0) {
    const Field = GetField(Fields, Crc, Index, Types.String8);
    return Field ? Field.value : null;
}

function DateToVCDate(Value = new Date()) {
    const DateValue = Value instanceof Date ? Value : new Date(Value);
    if (!Number.isFinite(DateValue.getTime())) throw new TypeError(`invalid date: ${Value}`);
    return BigInt(DateValue.getTime()) + JulianUnixEpochMs;
}

class Builder {
    constructor() {
        this.Fields = [];
        this.DataChunks = [];
        this.DataLength = 0;
    }

    Record(Crc, Type, Data1 = 0, Data2 = 0) {
        this.Fields.push({ Crc: U32(Crc), Type: U32(Type), Data1: U32(Data1), Data2: U32(Data2) });
        return this;
    }

    AddU32(Crc, Value) {
        return this.Record(Crc, Types.StringCrc, Value, 0);
    }
    AddStringCrc(Crc, Value) {
        return this.AddU32(Crc, Value);
    }
    AddPacked(Crc, Value, Data2 = 0) {
        return this.Record(Crc, Types.Packed, Value, Data2);
    }
    AddBool(Crc, Value) {
        return this.Record(Crc, Types.Bool8, Value ? 1 : 0, 0);
    }

    AddF32(Crc, Value) {
        const Bytes = Buffer.allocUnsafe(4);
        Bytes.writeFloatBE(Number(Value), 0);
        return this.Record(Crc, Types.F32, Bytes.readUInt32BE(0), 0);
    }

    AddU64(Crc, Value, Type = Types.U64) {
        const NumberValue = AsU64(Value);
        return this.Record(Crc, Type, Number(NumberValue >> 32n), Number(NumberValue & 0xffffffffn));
    }

    AddS64(Crc, Value) {
        return this.AddU64(Crc, Value, Types.S64Observed);
    }
    AddVCDate(Crc, Value) {
        return this.AddU64(Crc, Value, Types.VCDate);
    }

    AppendData(Value, Alignment = 8) {
        const Bytes = Buffer.isBuffer(Value) ? Buffer.from(Value) : Buffer.from(Value || []);
        const Padding = (Alignment - (this.DataLength % Alignment)) % Alignment;
        if (Padding) {
            this.DataChunks.push(Buffer.alloc(Padding));
            this.DataLength += Padding;
        }
        const Offset = this.DataLength;
        this.DataChunks.push(Bytes);
        this.DataLength += Bytes.length;
        return { Offset, length: Bytes.length };
    }

    AlignData(Alignment = 8) {
        const Padding = (Alignment - (this.DataLength % Alignment)) % Alignment;
        if (Padding) {
            this.DataChunks.push(Buffer.alloc(Padding));
            this.DataLength += Padding;
        }
        return this;
    }

    AddString8(Crc, Value) {
        const Ref = this.AppendData(Buffer.from(`${String(Value)}\0`, 'utf8'));
        return this.Record(Crc, Types.String8, Ref.Offset, Ref.length);
    }

    AddString16(Crc, Value) {
        const Text = String(Value);
        const Bytes = Buffer.alloc((Text.length + 1) * 2);
        for (let I = 0; I < Text.length; I++) Bytes.writeUInt16BE(Text.charCodeAt(I), I * 2);
        const Ref = this.AppendData(Bytes);
        return this.Record(Crc, Types.String16, Ref.Offset, Text.length + 1);
    }

    AddBinary(Crc, Value, Type = Types.Binary) {
        const Ref = this.AppendData(Value);
        return this.Record(Crc, Type, Ref.Offset, Ref.length);
    }

    AddExternalBinary(Crc, Offset, Length) {
        return this.Record(Crc, Types.Binary, Offset, Length);
    }

    Build(Options = {}) {
        const Table = Buffer.alloc((this.Fields.length + 1) * 16);
        this.Fields.forEach((Field, Index) => {
            const Offset = Index * 16;
            Table.writeUInt32BE(Field.Crc, Offset);
            Table.writeUInt32BE(Field.Type, Offset + 4);
            Table.writeUInt32BE(Field.Data1, Offset + 8);
            Table.writeUInt32BE(Field.Data2, Offset + 12);
        });
        const FieldList = Buffer.concat([Table, ...this.DataChunks]);
        const Trailing = Buffer.isBuffer(Options.Trailing) ? Options.Trailing : Buffer.alloc(0);
        return {
            FieldList,
            Body: Trailing.length ? Buffer.concat([FieldList, Trailing]) : FieldList,
            FieldListSize: FieldList.length,
            Fields: this.Fields.slice(),
        };
    }
}

function Serializable(Value) {
    if (typeof Value === 'bigint') return Value.toString();
    if (Buffer.isBuffer(Value))
        return {
            length: Value.length,
            HeadHex: Value.subarray(0, 128).toString('hex'),
            Truncated: Value.length > 128,
        };
    if (Array.isArray(Value)) return Value.map(Serializable);
    if (Value && typeof Value === 'object') {
        return Object.fromEntries(Object.entries(Value).map(([Key, Item]) => [Key, Serializable(Item)]));
    }
    return Value;
}

module.exports = {
    Types,
    TypeNames,
    Builder,
    Parse,
    TryParse,
    GetField,
    GetFields,
    GetU32,
    GetU64,
    GetString8,
    DateToVCDate,
    Serializable,
    Crc32,
    U32,
    Hex32,
};
