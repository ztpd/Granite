// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { Builder } = require('../../Codec/FieldList');
const { Crc32 } = require('../../Core/Crc32');
const { AttributesFor, CareerKey, ProfileKeys, Name, Level, InitialValue, Cap } = require('./Attributes/Constants');
const {
    Position,
    PrimaryArchetype,
    SecondaryArchetype,
    ProfileForArchetypes,
    BuildScopeForProfile,
} = require('./Attributes/BuildProfiles');

function Value64(Field) {
    return (BigInt(Field.Data1) << 32n) | BigInt(Field.Data2);
}

function StringCrc(Field) {
    return Field ? Field.Data1 >>> 0 : null;
}

function RememberBuildProfile(Fields, Context) {
    if (!(Context.AttributeProfiles instanceof Map)) return null;
    const Primary = StringCrc(Fields.find((Field) => Field.Crc === PrimaryArchetype));
    const Secondary = StringCrc(Fields.find((Field) => Field.Crc === SecondaryArchetype));
    const PositionValue = StringCrc(Fields.find((Field) => Field.Crc === Position));
    const Profile = ProfileForArchetypes(Primary, Secondary, PositionValue);
    if (!Profile) return null;

    let NumericSaveId = 0n;
    try {
        NumericSaveId = BigInt(Context.CareerSaveId ?? Context.CloudSaveId ?? 0n);
    } catch {
        NumericSaveId = 0n;
    }
    if (!(typeof Context.careerScopeId === 'string' && Context.careerScopeId.startsWith('slot-'))) {
        Context.careerScopeId = NumericSaveId === 0n ? BuildScopeForProfile(Profile) : NumericSaveId.toString();
    }
    if (Context.Sessions && Context.SessionKey && typeof Context.Sessions.bind === 'function') {
        Context.Sessions.bind(Context.SessionKey, { careerScopeId: Context.careerScopeId });
    }

    const Keys = ProfileKeys(Context, false);
    let Changed = false;
    for (const Key of Keys) {
        const Previous = Context.AttributeProfiles.get(Key);
        if (
            Previous &&
            (Previous.primaryArchetype !== Profile.primaryArchetype ||
                Previous.secondaryArchetype !== Profile.secondaryArchetype)
        )
            Changed = true;
        Context.AttributeProfiles.set(Key, { ...(Previous || {}), ...Profile });
    }
    if (Keys.length && typeof Context.SaveAttributeProfiles === 'function') {
        Context.SaveAttributeProfiles();
    }
    if (Changed && Context.Careers instanceof Map) {
        const Existing = Context.Careers.get(CareerKey(Context));
        if (Array.isArray(Existing)) {
            for (const Item of Existing) Item.level = 0n;
            if (typeof Context.SaveCareers === 'function') Context.SaveCareers();
        }
    }
    return Profile;
}

function Build(Input, Context = {}) {
    const Fields = Input?.Parsed?.Fields || [];
    const BuildProfile = RememberBuildProfile(Fields, Context);
    if (CareerKey(Context) && Context.Careers) {
        const Ids = Fields.filter((Field) => Field.Crc === Name);
        if (Ids.length) {
            const Current = AttributesFor(Context);
            const Initial = Fields.filter((Field) => Field.Crc === InitialValue);
            const Caps = Fields.filter((Field) => Field.Crc === Cap);
            const Levels = Fields.filter((Field) => Field.Crc === Level);
            const ById = new Map(Current.map((Item) => [Item.id, Item]));
            Ids.forEach((Field, Index) => {
                const Item = ById.get(Field.Data1 >>> 0);
                if (!Item) return;
                if (Initial[Index]) Item.initial = Value64(Initial[Index]);
                if (Caps[Index]) Item.cap = Value64(Caps[Index]);
                if (Levels[Index]) Item.level = Value64(Levels[Index]);
            });
            Context.Careers.set(CareerKey(Context), Current);
            if (typeof Context.SaveCareers === 'function') Context.SaveCareers();
        }
    }
    const Reply = new Builder();
    if (BuildProfile) {
        const PositionValue = StringCrc(Fields.find((Field) => Field.Crc === Position));
        if (PositionValue !== null) Reply.AddStringCrc(Position, PositionValue);
        Reply.AddStringCrc(SecondaryArchetype, BuildProfile.secondaryArchetype).AddStringCrc(
            PrimaryArchetype,
            BuildProfile.primaryArchetype,
        );
    }
    return Reply.AddU32(Crc32('RESULT'), Crc32('SUCCESS')).Build();
}

module.exports = { Build, Save: Build, Status: 'CAPTURED_2K19_BUILD_PROFILE_AND_SAVE_FIELDS' };
