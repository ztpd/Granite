// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const AttributeIds = Object.freeze([
    0x3860eb24, 0x0c69c04e, 0x523241fa, 0xda1bf08c, 0x24b2ae2e, 0x25bffaa0, 0x0e9a4f54, 0x456a08ba, 0x8577fd4e,
    0x3e1552fe, 0x6e45e8d0, 0x77f84bad, 0xf8723c46, 0xef44fc6b, 0x108a7d94, 0x04c9326e,
]);

const Name = 0x68b693b2;
const Level = 0x6dbe0ea3;
const CurrentCap = 0xbdfe4551;
const InitialValue = CurrentCap;
const Cap = 0x9803ab6b;
const PriceCount = 0x3526dbfb;
const ToLevel = 0x50496459;
const Price = 0x3d9ce069;
const SecondPrice = 0xe9fcbd20;
const CareerSaveId = 0xd5e5f21d;

function AsBigInt(Value, Fallback = 0n) {
    try {
        return BigInt(Value ?? Fallback);
    } catch {
        return Fallback;
    }
}

const AttributeLabels = Object.freeze([
    'layups',
    'dunks',
    'midRange',
    'threePoint',
    'ballHandling',
    'passing',
    'postOffense',
    'rebounding',
    'steals',
    'blocks',
    'vertical',
    'lateralQuickness',
    'speed',
    'acceleration',
    'strength',
    'stamina',
]);

function ParseList(Value, Fallback) {
    if (Value === undefined || Value === null || Value === '') return Fallback.slice();
    let Raw = Value;
    try {
        if (typeof Raw === 'string' && Raw.trim().startsWith('[')) Raw = JSON.parse(Raw);
    } catch {
        return Fallback.slice();
    }
    if (typeof Raw === 'string') Raw = Raw.split(',');
    if (!Array.isArray(Raw)) return Fallback.slice();
    return Fallback.map((DefaultValue, Index) => {
        const Parsed = AsBigInt(Raw[Index], DefaultValue);
        return Parsed < 0n ? 0n : Parsed;
    });
}

const DefaultInitialValues = Object.freeze(
    ParseList(
        process.env.GRANITE_ATTRIBUTE_INITIALS,
        AttributeIds.map(() => 60n),
    ),
);
const DefaultCapValues = Object.freeze(
    ParseList(
        process.env.GRANITE_ATTRIBUTE_CAPS,
        AttributeIds.map((_, Index) => (Index === 10 ? 77n : 99n)),
    ),
);
const DefaultMaxLevelValues = Object.freeze(
    DefaultCapValues.map((CapValue, Index) => {
        const Room = CapValue - DefaultInitialValues[Index];
        return Room < 0n ? 0n : Room > 25n ? 25n : Room;
    }),
);
const DefaultInitial = DefaultInitialValues[0];
const DefaultCap = DefaultCapValues[0];

function ProfileValues(Profile, Key, Fallback) {
    if (!Profile || typeof Profile !== 'object') return Fallback;
    const Value = Profile[Key] ?? Profile[`${Key}Values`] ?? Profile[`${Key}s`];
    if (Array.isArray(Value)) return ParseList(Value, Fallback);
    if (Value && typeof Value === 'object') {
        return Fallback.map((DefaultValue, Index) => {
            const Id = AttributeIds[Index];
            const Label = AttributeLabels[Index];
            return AsBigInt(Value[Id] ?? Value[`0x${Id.toString(16).toUpperCase()}`] ?? Value[Label], DefaultValue);
        });
    }
    return Fallback;
}

function ProfileHasValues(Profile, Key) {
    if (!Profile || typeof Profile !== 'object') return false;
    return Profile[Key] !== undefined || Profile[`${Key}Values`] !== undefined || Profile[`${Key}s`] !== undefined;
}

function SaveIdFor(Context = {}) {
    if (Context.careerScopeId !== null && Context.careerScopeId !== undefined && String(Context.careerScopeId) !== '')
        return String(Context.careerScopeId);
    return String(AsBigInt(Context.CareerSaveId ?? Context.CloudSaveId ?? 0n));
}

function ProfileKeys(Context = {}, IncludeLegacy = true) {
    const Identities = [];
    if (Context.userId !== null && Context.userId !== undefined) Identities.push(String(Context.userId));
    if (Context.gamertag) Identities.push(String(Context.gamertag));
    if (!Identities.length && Context.SessionKey) Identities.push(String(Context.SessionKey));
    const Scoped = Identities.map((Identity) => `${Identity}:${SaveIdFor(Context)}`);
    return IncludeLegacy && SaveIdFor(Context) === '0' ? [...Scoped, ...Identities] : Scoped;
}

function CareerKey(Context = {}) {
    return ProfileKeys(Context, false)[0] || null;
}

function ProfileFor(Context = {}) {
    const Keys = ProfileKeys(Context);
    const Profiles = Context.AttributeProfiles || Context.BuildProfiles;
    if (Profiles instanceof Map) {
        for (const Key of Keys) if (Profiles.has(Key)) return Profiles.get(Key);
    } else if (Profiles && typeof Profiles === 'object') {
        for (const Key of Keys) if (Profiles[Key]) return Profiles[Key];
    }
    return Context.BuildProfile || Context.AttributeProfile || null;
}

function Normalize(Item, Index, Profile = null) {
    const Source = Item && typeof Item === 'object' ? Item : {};
    const Initials = ProfileValues(Profile, 'initial', DefaultInitialValues);
    const Caps = ProfileValues(Profile, 'cap', DefaultCapValues);
    const ConfiguredMaxLevels = ProfileValues(Profile, 'maxLevel', DefaultMaxLevelValues);
    const Initial = AsBigInt(Source.initial ?? Source.initialValue ?? Source.base, Initials[Index]);
    const CapValue = AsBigInt(Source.cap ?? Source.capRatio ?? Source.max ?? Source.maxRating, Caps[Index]);
    const SafeCap = CapValue > 99n ? Caps[Index] : CapValue;
    const Room = SafeCap >= Initial ? SafeCap - Initial : 0n;
    const HasProfileMax = ProfileHasValues(Profile, 'maxLevel');
    const ConfiguredMax = AsBigInt(
        HasProfileMax ? ConfiguredMaxLevels[Index] : (Source.maxLevel ?? Source.maxLevels),
        ConfiguredMaxLevels[Index],
    );
    const MaxLevel = HasProfileMax
        ? ConfiguredMax < 0n
            ? 0n
            : ConfiguredMax > 25n
              ? 25n
              : ConfiguredMax
        : ConfiguredMax < Room
          ? ConfiguredMax
          : Room;
    const LevelValue = AsBigInt(Source.level ?? Source.purchased ?? Source.purchasedLevels, 0n);
    return {
        id: Number(Source.id ?? Source.AttributeId ?? AttributeIds[Index]) >>> 0,
        level: LevelValue < 0n ? 0n : LevelValue > MaxLevel ? MaxLevel : LevelValue > 25n ? 25n : LevelValue,
        initial: Initial < 0n ? 0n : Initial,
        cap: SafeCap < Initial ? Initial : SafeCap,
        maxLevel: MaxLevel < 0n ? 0n : MaxLevel > 25n ? 25n : MaxLevel,
    };
}

function AttributesFor(Context = {}) {
    const Key = CareerKey(Context);
    const Existing = Key && Context.Careers instanceof Map ? Context.Careers.get(Key) : null;
    const StoredProfile = ProfileFor(Context);
    const Profile =
        StoredProfile ||
        (Context.RequireKnownAttributeProfile
            ? {
                  maxLevels: AttributeIds.map(() => 0),
                  source: 'unknown build (closed until MyCareer/save)',
              }
            : null);
    const ById = new Map(
        Array.isArray(Existing)
            ? Existing.map((Item, Index) => {
                  const Normalized = Normalize(Item, Index, Profile);
                  return [Normalized.id, Normalized];
              })
            : [],
    );
    const Result = AttributeIds.map((Id, Index) => ById.get(Id) || Normalize({}, Index, Profile));
    if (Key && Context.Careers instanceof Map) Context.Careers.set(Key, Result);
    return Result;
}

module.exports = {
    AttributeIds,
    Name,
    Level,
    CurrentCap,
    InitialValue,
    Cap,
    PriceCount,
    ToLevel,
    Price,
    SecondPrice,
    CareerSaveId,
    AttributeLabels,
    DefaultInitial,
    DefaultCap,
    DefaultInitialValues,
    DefaultCapValues,
    DefaultMaxLevelValues,
    AsBigInt,
    Normalize,
    ProfileKeys,
    CareerKey,
    ProfileFor,
    AttributesFor,
};
