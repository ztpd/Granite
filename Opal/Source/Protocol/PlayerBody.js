// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const BitmapBytes = 19;
const ValuesStart = 16 + BitmapBytes;
const Key = 0;

const Widths = [
    8, 8, 4, 4, 4, 1, 4, 2, 1, 1, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 8, 2,
    1, 1, 1, 1, 1, 4, 1, 1, 1, 128, 40, 40, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 4, 4, 1, 1, 1, 1, 1, 8, 8, 16, 4,
];

const ArrayFields = new Set([
    90, 91, 92, 93, 94, 95, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
    121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136,
]);

const Field = Object.freeze({
    Puid: 0,
    MachineId: 1,
    FakePlayerFlag: 82,
    FakePlayerData: 135,
    SquadId: 96,
    SquadInvites: Object.freeze([97, 98, 99, 100, 101]),
    GotNextLocation: 147,
    GotNextFacing: 148,
});

function IsPresent(Body, FieldValue) {
    const Octet = Body[16 + (FieldValue >> 3)];
    return Boolean(Octet & (0x80 >> (FieldValue & 7)));
}

function Decode(Body) {
    if (!Buffer.isBuffer(Body) || Body.length < ValuesStart) {
        return { Ok: false, Reason: `body is shorter than the ${ValuesStart}-byte header` };
    }
    if (Widths.length !== 149) {
        return { Ok: false, Reason: `PLAYER field table has ${Widths.length} entries, expected 149` };
    }

    let Cursor = ValuesStart;
    const Offsets = new Map();
    let Present = 0;

    for (let FieldValue = 0; FieldValue < Widths.length; FieldValue++) {
        if (!IsPresent(Body, FieldValue)) continue;
        Present++;
        Offsets.set(FieldValue, Cursor);

        if (ArrayFields.has(FieldValue)) {
            if (Cursor + 4 > Body.length) {
                return { Ok: false, Reason: `array count for field ${FieldValue} is past the end` };
            }
            const Size = Body.readUInt32LE(Cursor);
            Cursor += 4;
            if (Cursor + Size > Body.length) {
                return {
                    Ok: false,
                    Reason: `field ${FieldValue} declares ${Size} bytes but only ` + `${Body.length - Cursor} remain`,
                };
            }
            Cursor += Size;
            continue;
        }

        const Width = Widths[FieldValue];
        if (Cursor + Width > Body.length) {
            return { Ok: false, Reason: `fixed field ${FieldValue} is past the end` };
        }
        Cursor += Width;
    }

    return { Ok: true, Length: Cursor, Offsets: Offsets, Present: Present };
}

function Trim(Body) {
    const Decoded = Decode(Body);
    if (!Decoded.Ok) return { Body: Body, ...Decoded, Trimmed: 0 };
    const Length = Decoded.Length;
    return {
        Body: Length < Body.length ? Buffer.from(Body.subarray(0, Length)) : Body,
        ...Decoded,
        Trimmed: Math.max(0, Body.length - Length),
    };
}

function SetMachineId(Body, MachineId) {
    const Decoded = Decode(Body);
    const PuidAt = Decoded.Ok && Decoded.Offsets.get(Field.Puid);
    if (
        !Decoded.Ok ||
        PuidAt === undefined ||
        !IsPresent(Body, Field.Puid) ||
        Body.readBigUInt64LE(PuidAt) !== Body.readBigUInt64BE(Key) ||
        (Body[ValuesStart - 1] & 7) !== 0
    ) {
        return { Ok: false, Native: false, Body: Body, Reason: 'not a decoded NBA2K19 PLAYER body with matching PUID' };
    }
    let Id;
    try {
        Id = BigInt(MachineId);
    } catch {
        Id = 0n;
    }
    if (Id <= 0n || Id > 0xffffffffffffffffn) {
        return { Ok: false, Native: true, Body: Body, Reason: 'assigned machine ID must be a nonzero u64' };
    }
    const Existing = Decoded.Offsets.get(Field.MachineId);
    const At = Existing === undefined ? PuidAt + Widths[Field.Puid] : Existing;
    const Patched =
        Existing === undefined
            ? Buffer.concat([Body.subarray(0, At), Buffer.alloc(8), Body.subarray(At)])
            : Buffer.from(Body);
    Patched[16 + (Field.MachineId >> 3)] |= 0x80 >> (Field.MachineId & 7);
    Patched.writeBigUInt64LE(Id, At);
    return {
        Ok: true,
        Native: true,
        Body: Patched,
        Offset: At,
        Was: Existing === undefined ? null : Body.readBigUInt64LE(At),
        MachineId: Id,
    };
}

function InspectGeneration(Body) {
    const Decoded = Decode(Body);
    if (!Decoded.Ok) return Decoded;

    const PuidAt = Decoded.Offsets.get(Field.Puid);
    const FlagAt = Decoded.Offsets.get(Field.FakePlayerFlag);
    const DataAt = Decoded.Offsets.get(Field.FakePlayerData);
    if (PuidAt === undefined || PuidAt + 8 > Body.length) {
        return { ...Decoded, GenerationOk: false, Reason: 'PLAYER field 0 (PUID) is absent' };
    }
    if (FlagAt === undefined || FlagAt >= Body.length) {
        return { ...Decoded, GenerationOk: false, Reason: 'PLAYER field 82 is absent' };
    }
    if (DataAt === undefined || DataAt + 4 > Body.length) {
        return { ...Decoded, GenerationOk: false, Reason: 'PLAYER field 99 array is absent' };
    }

    const Puid = Body.readBigUInt64LE(PuidAt);
    const FakePlayerFlag = Body.readUInt8(FlagAt);
    const FakePlayerDataBytes = Body.readUInt32LE(DataAt);

    const RealPeer = FakePlayerFlag === 0 || FakePlayerDataBytes === 0;
    return {
        ...Decoded,
        GenerationOk: true,
        Puid: Puid,
        FakePlayerFlag: FakePlayerFlag,
        FakePlayerDataBytes: FakePlayerDataBytes,
        RealPeer: RealPeer,
    };
}

const ShowField = 84;

function SetShow(Body) {
    if (!Buffer.isBuffer(Body)) return { Ok: false, Reason: 'body is not a buffer', Body: Body };
    if (Body.length < ValuesStart + 8) {
        return { Ok: false, Reason: `body is shorter than the ${ValuesStart}-byte header`, Body: Body };
    }

    if (!IsPresent(Body, 0) || Body.readBigUInt64BE(Key) !== Body.readBigUInt64LE(ValuesStart)) {
        return {
            Ok: false,
            Reason: 'body is not in the proven NBA2K19 PLAYER layout (field 0 does not match the object key)',
            Body: Body,
        };
    }

    let Cursor = ValuesStart;
    for (let FieldValue = 0; FieldValue < ShowField; FieldValue++) {
        if (!IsPresent(Body, FieldValue)) continue;
        if (ArrayFields.has(FieldValue)) {
            if (Cursor + 4 > Body.length) {
                return { Ok: false, Reason: `array count for field ${FieldValue} is past the end`, Body: Body };
            }
            Cursor += 4 + Body.readUInt32LE(Cursor);
        } else {
            Cursor += Widths[FieldValue];
        }
        if (Cursor > Body.length) {
            return { Ok: false, Reason: `field ${FieldValue} runs past the end of the body`, Body: Body };
        }
    }

    if (IsPresent(Body, ShowField)) {
        if (Cursor + 1 > Body.length) {
            return { Ok: false, Reason: 'field 84 is past the end of the body', Body: Body };
        }
        const Was = Body.readUInt8(Cursor);
        Body.writeUInt8(1, Cursor);
        return { Ok: true, Offset: Cursor, Was: Was, Inserted: false, Body: Body };
    }

    const Grown = Buffer.concat([Body.subarray(0, Cursor), Buffer.from([1]), Body.subarray(Cursor)]);
    Grown[16 + (ShowField >> 3)] |= 0x80 >> (ShowField & 7);
    return { Ok: true, Offset: Cursor, Was: null, Inserted: true, Body: Grown };
}

function SetGotNextDestination(Body, Location, Facing = null) {
    if (!Buffer.isBuffer(Body)) return { Ok: false, Reason: 'body is not a buffer' };
    if (!Location || Location.length < 3) return { Ok: false, Reason: 'no location supplied' };

    const Decoded = Decode(Body);
    if (!Decoded.Ok) return { Ok: false, Reason: Decoded.Reason };

    const At = Decoded.Offsets.get(Field.GotNextLocation);
    if (At === undefined) {
        return {
            Ok: false,
            Reason: `PLAYER field ${Field.GotNextLocation} (gotNextLocation) ` + `is absent from this body`,
        };
    }
    if (At + 16 > Body.length) {
        return { Ok: false, Reason: `gotNextLocation at body+${At} runs past the body` };
    }

    const Patched = Buffer.from(Body);
    Patched.writeFloatLE(Location[0], At);
    Patched.writeFloatLE(Location[1], At + 4);
    Patched.writeFloatLE(Location[2], At + 8);
    Patched.writeFloatLE(1.0, At + 12);

    let FacingAt = -1;
    if (Facing !== null && Number.isFinite(Facing)) {
        const Off = Decoded.Offsets.get(Field.GotNextFacing);
        if (Off !== undefined && Off + 4 <= Patched.length) {
            FacingAt = Off;
            Patched.writeInt32LE(Math.max(-2147483648, Math.min(2147483647, Math.round(Facing))), FacingAt);
        }
    }

    return { Ok: true, Body: Patched, Offset: At, FacingOffset: FacingAt };
}

function SetSquadInvites(Body, Inviters) {
    const Ids = [...(Inviters || [])].slice(0, Field.SquadInvites.length);
    const Values = new Map();
    for (let I = 0; I < Field.SquadInvites.length; I++) {
        Values.set(Field.SquadInvites[I], I < Ids.length ? Ids[I] : 0n);
    }
    const Patched = SetU64Fields(Body, Values);
    return Patched.Ok ? { ...Patched, Inviters: Ids } : Patched;
}

function SetSquadId(Body, SquadId) {
    const Patched = SetU64Fields(Body, new Map([[Field.SquadId, SquadId || 0n]]));
    return Patched.Ok ? { ...Patched, SquadId: BigInt.asUintN(64, BigInt(SquadId || 0n)) } : Patched;
}

function SetU64Fields(Body, FieldValues) {
    if (!Buffer.isBuffer(Body)) return { Ok: false, Reason: 'body is not a buffer', Body: Body };
    const Decoded = Decode(Body);
    if (!Decoded.Ok) return { Ok: false, Reason: Decoded.Reason, Body: Body };

    const Values = new Map();
    const Present = [...Decoded.Offsets.keys()].sort((A, B) => A - B);
    Present.forEach((FieldValue, Index) => {
        const From = Decoded.Offsets.get(FieldValue);
        const To = Index + 1 < Present.length ? Decoded.Offsets.get(Present[Index + 1]) : Decoded.Length;
        Values.set(FieldValue, Buffer.from(Body.subarray(From, To)));
    });

    const Header = Buffer.from(Body.subarray(0, ValuesStart));
    for (const [FieldValue, Raw] of FieldValues) {
        if (Widths[FieldValue] !== 8 || ArrayFields.has(FieldValue)) {
            return { Ok: false, Reason: `field ${FieldValue} is not an 8-byte value`, Body: Body };
        }
        const Value = Buffer.alloc(8);
        Value.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Raw)));
        Values.set(FieldValue, Value);
        Header[16 + (FieldValue >> 3)] |= 0x80 >> (FieldValue & 7);
    }
    const Ordered = [...Values.keys()].sort((A, B) => A - B);
    const Patched = Buffer.concat([
        Header,
        ...Ordered.map((FieldValue) => Values.get(FieldValue)),
        Body.subarray(Decoded.Length),
    ]);
    return { Ok: true, Body: Patched };
}

function ReadU64Field(Body, FieldValue) {
    const Decoded = Decode(Body);
    if (!Decoded.Ok || !Decoded.Offsets.has(FieldValue) || Widths[FieldValue] !== 8) return null;
    return Body.readBigUInt64LE(Decoded.Offsets.get(FieldValue));
}

module.exports = {
    BitmapBytes,
    ValuesStart,
    Widths,
    ArrayFields,
    Field,
    ShowField,
    IsPresent,
    Decode,
    Trim,
    InspectGeneration,
    SetShow,
    SetGotNextDestination,
    SetSquadInvites,
    SetSquadId,
    SetU64Fields,
    ReadU64Field,
    SetMachineId,
};
