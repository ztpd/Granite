// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Crc, Describe, Resolve } = require('../Core/Names');
const { Hex } = require('../Core/Crc32');

const Type = {
    U32: 0x1423add2,
    U64: 0x3d9e5089,
    Bool: 0x6314db26,
    Typee: 0x55c05a86,
    BlobRef: 0x36182e83,
    StringRef: 0x6e46752f,
    Packed: 0x320b919b,
};

const TypeNames = new Map(Object.entries(Type).map(([K, V]) => [V >>> 0, K]));
const RecordSize = 16;

function Parse(Payload, HeaderSize) {
    const Fields = [];
    let Off = HeaderSize;
    while (Off + RecordSize <= Payload.length) {
        const CrcValue = Payload.readUInt32BE(Off);
        const TypeCode = Payload.readUInt32BE(Off + 4);
        if (CrcValue === 0 && TypeCode === 0) break;

        const Field = {
            Crc: CrcValue >>> 0,
            Type: TypeCode >>> 0,
            Data1: Payload.readUInt32BE(Off + 8),
            Data2: Payload.readUInt32BE(Off + 12),
            Offset: Off,
        };
        if (TypeCode === Type.U64 || TypeCode === Type.Typee) Field.Value = Payload.readBigUInt64BE(Off + 8);
        Fields.push(Field);
        Off += RecordSize;
    }
    return { Fields: Fields, DataOffset: Off + RecordSize, Payload: Payload };
}

function Scan(Bytes, CrcOrName, From = 16) {
    const CrcValue = (typeof CrcOrName === 'string' ? Crc(CrcOrName) : CrcOrName) >>> 0;
    for (let Off = From; Off + 16 <= Bytes.length; Off += 4) {
        if (Bytes.readUInt32BE(Off) !== CrcValue) continue;
        const TypeCode = Bytes.readUInt32BE(Off + 4) >>> 0;
        if (!TypeNames.has(TypeCode)) continue;
        const Field = {
            Crc: CrcValue,
            Type: TypeCode,
            Offset: Off,
            Data1: Bytes.readUInt32BE(Off + 8),
            Data2: Bytes.readUInt32BE(Off + 12),
        };
        if (TypeCode === Type.U64 || TypeCode === Type.Typee) Field.Value = Bytes.readBigUInt64BE(Off + 8);
        return Field;
    }
    return null;
}

function Locate(Bytes, From = 8, Limit = 96) {
    let Best = { Offset: -1, Count: 0 };
    const End = Math.min(Limit, Bytes.length - RecordSize);
    for (let Start = From; Start <= End; Start += 4) {
        let Off = Start,
            Count = 0,
            Terminated = false;
        while (Off + RecordSize <= Bytes.length) {
            const CrcValue = Bytes.readUInt32BE(Off);
            const TypeCode = Bytes.readUInt32BE(Off + 4) >>> 0;
            if (CrcValue === 0 && TypeCode === 0) {
                Terminated = true;
                break;
            }
            if (!TypeNames.has(TypeCode)) break;
            Count++;
            Off += RecordSize;
        }
        if (!Count) continue;
        if (!Terminated && Off + RecordSize <= Bytes.length) continue;
        if (Count > Best.Count) Best = { Offset: Start, Count: Count };
    }
    return Best.Offset;
}

function Find(List, CrcOrName) {
    const CrcValue = typeof CrcOrName === 'string' ? Crc(CrcOrName) : CrcOrName >>> 0;
    return List.Fields.find((F) => F.Crc === CrcValue) || null;
}

function ReadString(List, Field) {
    if (!Field || Field.Type !== Type.StringRef) return '';
    const Start = List.DataOffset + Field.Data1;
    const End = Start + Field.Data2;
    if (Start < List.DataOffset || End > List.Payload.length) return '';
    return List.Payload.slice(Start, End).toString('utf8').replace(/\0+$/, '');
}

function ReadBlob(List, Field) {
    if (!Field || Field.Type !== Type.BlobRef) return Buffer.alloc(0);
    const Start = List.DataOffset + Field.Data1;
    const End = Start + Field.Data2;
    if (Start < List.DataOffset || End > List.Payload.length) return Buffer.alloc(0);
    return List.Payload.slice(Start, End);
}

class Builder {
    constructor() {
        this.Records = [];
        this.Data = [];
        this.DataLength = 0;
    }

    Push(Name, TypeCode, Data1, Data2) {
        const CrcValue = typeof Name === 'string' ? Crc(Name) : Name >>> 0;
        this.Records.push({ Crc: CrcValue, Type: TypeCode >>> 0, Data1: Data1 >>> 0, Data2: Data2 >>> 0 });
        return this;
    }

    AddU32(Name, Value, Extra = 0) {
        return this.Push(Name, Type.U32, Value, Extra);
    }
    AddBool(Name, Value) {
        return this.Push(Name, Type.Bool, Value ? 1 : 0, 0);
    }

    AddU64(Name, Value) {
        const V = BigInt(Value) & 0xffffffffffffffffn;
        return this.Push(Name, Type.U64, Number(V >> 32n), Number(V & 0xffffffffn));
    }

    PushData(Bytes) {
        const Offset = this.DataLength;
        this.Data.push(Bytes);
        this.DataLength += Bytes.length;
        return Offset;
    }

    AddString(Name, Text) {
        const Bytes = Buffer.from(String(Text) + '\0', 'utf8');
        const Offset = this.PushData(Bytes);
        return this.Push(Name, Type.StringRef, Offset, Bytes.length);
    }

    AddTypeE(Name, Value) {
        const V = BigInt(Value) & 0xffffffffffffffffn;
        return this.Push(Name, Type.Typee, Number(V >> 32n), Number(V & 0xffffffffn));
    }

    AddPacked(Name, Data1, Data2) {
        return this.Push(Name, Type.Packed, Data1, Data2);
    }

    AddBlobRef(Name, Offset, Length) {
        return this.Push(Name, Type.BlobRef, Offset, Length);
    }

    AppendData(Bytes) {
        this.PushData(Buffer.isBuffer(Bytes) ? Bytes : Buffer.from(Bytes));
        return this;
    }

    AddBlob(Name, Bytes) {
        const Buf = Buffer.isBuffer(Bytes) ? Bytes : Buffer.alloc(0);
        const Offset = this.PushData(Buf);
        return this.Push(Name, Type.BlobRef, Offset, Buf.length);
    }

    Build() {
        const Sorted = this.Records.slice().sort((A, B) => (A.Crc >>> 0) - (B.Crc >>> 0));
        const Body = Buffer.alloc((Sorted.length + 1) * RecordSize);
        Sorted.forEach((R, I) => {
            const Off = I * RecordSize;
            Body.writeUInt32BE(R.Crc, Off);
            Body.writeUInt32BE(R.Type, Off + 4);
            Body.writeUInt32BE(R.Data1, Off + 8);
            Body.writeUInt32BE(R.Data2, Off + 12);
        });
        return Buffer.concat([Body, ...this.Data]);
    }
}

function Shortfall(List, Field) {
    const Start = List.DataOffset + Field.Data1;
    const Missing = Start + Field.Data2 - List.Payload.length;
    return Missing > 0 ? Missing : 0;
}

function FormatValue(List, Field) {
    switch (Field.Type) {
        case Type.U64:
        case Type.Typee:
            return '0x' + Field.Value.toString(16).toUpperCase().padStart(16, '0');
        case Type.StringRef: {
            const Short = Shortfall(List, Field);
            return Short === 0
                ? `"${ReadString(List, Field)}"`
                : `${Field.Data2} byte string declared, ${Short} missing`;
        }
        case Type.BlobRef: {
            if (Field.Data2 === 0) return 'empty';
            const Short = Shortfall(List, Field);
            return Short === 0 ? `${Field.Data2} bytes` : `${Field.Data2} bytes declared, ${Short} missing`;
        }
        case Type.Bool:
            return Field.Data1 ? 'true' : 'false';
        default: {
            const Named = Resolve(Field.Data1);
            return Named ? Describe(Field.Data1) : Hex(Field.Data1);
        }
    }
}

function Format(List) {
    return List.Fields.map((F) => `${Describe(F.Crc)} is ${FormatValue(List, F)}`).join(', ');
}

module.exports = {
    Type,
    TypeNames,
    RecordSize,
    Parse,
    Find,
    Scan,
    Locate,
    ReadString,
    ReadBlob,
    FormatValue,
    Format,
    Builder,
};
