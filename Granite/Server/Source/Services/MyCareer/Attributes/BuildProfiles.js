// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Position = 0x801f78b9;
const PrimaryArchetype = 0xa517a20c;
const SecondaryArchetype = 0xa18e45f8;

const ArchetypeCrcs = Object.freeze([
    0x3d026016, 0x8e9dd003, 0x0baf5602, 0xd4fbef91, 0xc1393b64, 0x02cb48d9, 0xb4722a7d,
]);

const MaxLevelTable = Object.freeze([
    Object.freeze([
        Object.freeze([25, 25, 12, 8, 19, 13, 10, 13, 17, 14, 25, 19, 25, 25, 16, 25]),
        Object.freeze([24, 23, 17, 12, 19, 13, 13, 13, 16, 14, 23, 19, 23, 24, 16, 25]),
        Object.freeze([22, 20, 17, 15, 18, 13, 11, 12, 16, 12, 23, 18, 22, 23, 15, 25]),
        Object.freeze([23, 21, 13, 10, 21, 18, 10, 13, 16, 14, 23, 19, 25, 25, 15, 25]),
        Object.freeze([22, 23, 12, 9, 17, 13, 10, 14, 20, 18, 25, 21, 25, 25, 19, 25]),
        Object.freeze([24, 23, 14, 9, 18, 13, 16, 14, 16, 14, 23, 18, 23, 23, 20, 25]),
        Object.freeze([23, 23, 12, 8, 16, 13, 11, 18, 18, 16, 25, 19, 23, 23, 20, 25]),
    ]),
    Object.freeze([
        Object.freeze([23, 20, 22, 17, 20, 14, 18, 11, 14, 13, 21, 18, 22, 24, 16, 25]),
        Object.freeze([21, 17, 25, 20, 20, 14, 20, 11, 13, 13, 18, 18, 20, 23, 16, 25]),
        Object.freeze([19, 14, 25, 22, 19, 14, 18, 11, 13, 12, 17, 17, 18, 21, 15, 25]),
        Object.freeze([20, 15, 23, 19, 22, 18, 18, 11, 13, 13, 17, 18, 22, 24, 15, 25]),
        Object.freeze([19, 17, 22, 18, 18, 14, 17, 13, 18, 18, 21, 21, 22, 24, 19, 25]),
        Object.freeze([22, 17, 23, 18, 18, 14, 22, 13, 13, 13, 17, 17, 19, 21, 20, 25]),
        Object.freeze([20, 17, 22, 17, 17, 13, 19, 17, 15, 15, 21, 18, 20, 22, 20, 25]),
    ]),
    Object.freeze([
        Object.freeze([17, 12, 22, 21, 16, 14, 12, 11, 13, 9, 18, 17, 17, 18, 14, 25]),
        Object.freeze([14, 8, 25, 23, 16, 14, 15, 10, 12, 8, 15, 17, 15, 17, 14, 25]),
        Object.freeze([11, 4, 25, 25, 14, 14, 13, 10, 12, 7, 14, 16, 12, 14, 13, 25]),
        Object.freeze([13, 5, 23, 23, 18, 18, 12, 10, 12, 8, 14, 17, 17, 18, 13, 25]),
        Object.freeze([11, 7, 22, 22, 13, 14, 12, 12, 17, 14, 18, 20, 17, 18, 17, 25]),
        Object.freeze([15, 8, 23, 22, 14, 14, 18, 12, 12, 9, 14, 16, 14, 15, 18, 25]),
        Object.freeze([13, 8, 22, 21, 12, 13, 13, 16, 14, 11, 18, 17, 14, 16, 18, 25]),
    ]),
    Object.freeze([
        Object.freeze([21, 15, 16, 15, 23, 22, 10, 11, 15, 12, 18, 18, 25, 25, 14, 25]),
        Object.freeze([20, 11, 20, 18, 23, 23, 13, 11, 14, 12, 15, 18, 23, 24, 14, 25]),
        Object.freeze([17, 8, 20, 20, 23, 23, 11, 11, 14, 11, 14, 17, 22, 23, 13, 25]),
        Object.freeze([19, 9, 17, 17, 25, 25, 10, 11, 14, 12, 14, 18, 25, 25, 13, 25]),
        Object.freeze([17, 11, 16, 16, 22, 22, 10, 13, 18, 17, 18, 21, 25, 25, 17, 25]),
        Object.freeze([20, 12, 18, 16, 22, 23, 16, 13, 13, 13, 14, 17, 23, 23, 18, 25]),
        Object.freeze([18, 12, 16, 15, 21, 22, 11, 17, 16, 14, 18, 18, 23, 23, 18, 25]),
    ]),
    Object.freeze([
        Object.freeze([17, 20, 12, 11, 13, 12, 8, 17, 23, 23, 25, 23, 25, 25, 22, 25]),
        Object.freeze([15, 16, 17, 15, 14, 12, 12, 16, 22, 22, 23, 23, 23, 24, 22, 25]),
        Object.freeze([12, 13, 17, 17, 12, 12, 9, 16, 22, 21, 23, 23, 22, 23, 22, 25]),
        Object.freeze([14, 14, 13, 13, 17, 17, 8, 16, 23, 22, 23, 23, 25, 25, 22, 25]),
        Object.freeze([12, 16, 12, 12, 11, 12, 8, 18, 25, 25, 25, 25, 25, 25, 24, 25]),
        Object.freeze([16, 17, 14, 12, 11, 13, 15, 18, 22, 23, 23, 23, 23, 23, 24, 25]),
        Object.freeze([13, 17, 12, 11, 10, 12, 10, 21, 23, 23, 25, 23, 23, 23, 24, 25]),
    ]),
    Object.freeze([
        Object.freeze([24, 21, 17, 11, 15, 15, 22, 16, 13, 15, 18, 17, 21, 20, 23, 25]),
        Object.freeze([22, 18, 21, 15, 15, 15, 23, 16, 11, 15, 15, 17, 19, 19, 23, 25]),
        Object.freeze([20, 15, 21, 17, 13, 15, 22, 15, 11, 13, 14, 16, 17, 16, 22, 25]),
        Object.freeze([22, 16, 18, 13, 18, 19, 22, 16, 12, 14, 14, 17, 21, 20, 22, 25]),
        Object.freeze([21, 17, 17, 12, 13, 14, 21, 17, 17, 19, 18, 20, 21, 20, 25, 25]),
        Object.freeze([23, 18, 19, 12, 13, 15, 25, 17, 11, 15, 14, 16, 18, 16, 25, 25]),
        Object.freeze([21, 18, 17, 11, 12, 14, 23, 20, 13, 16, 18, 17, 18, 17, 25, 25]),
    ]),
    Object.freeze([
        Object.freeze([20, 21, 12, 8, 11, 11, 14, 22, 18, 18, 25, 18, 21, 21, 23, 25]),
        Object.freeze([18, 18, 17, 12, 11, 12, 17, 22, 18, 18, 23, 18, 19, 20, 23, 25]),
        Object.freeze([16, 15, 17, 15, 9, 12, 15, 22, 17, 16, 23, 17, 17, 18, 22, 25]),
        Object.freeze([18, 16, 13, 10, 14, 17, 14, 22, 18, 17, 23, 18, 21, 21, 22, 25]),
        Object.freeze([16, 17, 12, 9, 8, 11, 13, 23, 21, 21, 25, 21, 21, 21, 25, 25]),
        Object.freeze([19, 18, 14, 9, 8, 12, 19, 23, 17, 18, 23, 17, 19, 18, 25, 25]),
        Object.freeze([17, 18, 12, 8, 7, 11, 15, 25, 19, 19, 25, 18, 19, 19, 25, 25]),
    ]),
]);

function CrcNumber(Value) {
    if (typeof Value === 'string') {
        const Text = Value.trim();
        if (/^0x[0-9a-f]+$/i.test(Text)) return Number.parseInt(Text, 16) >>> 0;
        if (/^\d+$/.test(Text)) return Number(Text) >>> 0;
    }
    if (typeof Value === 'bigint') return Number(Value) >>> 0;
    return Number(Value) >>> 0;
}

function ArchetypeIndex(Value) {
    const Wanted = CrcNumber(Value);
    return ArchetypeCrcs.findIndex((Crc) => Crc >>> 0 === Wanted);
}

function ProfileForArchetypes(PrimaryArchetypeValue, SecondaryArchetypeValue, PositionValue = null) {
    const PrimaryIndex = ArchetypeIndex(PrimaryArchetypeValue);
    const SecondaryIndex = ArchetypeIndex(SecondaryArchetypeValue);
    if (PrimaryIndex < 0 || SecondaryIndex < 0) return null;
    return {
        position: PositionValue === null || PositionValue === undefined ? null : CrcNumber(PositionValue),
        primaryArchetype: ArchetypeCrcs[PrimaryIndex],
        secondaryArchetype: ArchetypeCrcs[SecondaryIndex],
        primaryIndex: PrimaryIndex,
        secondaryIndex: SecondaryIndex,
        maxLevels: MaxLevelTable[PrimaryIndex][SecondaryIndex].slice(),
        source: 'NBA2K19.exe byte_141EF6792',
    };
}

function BuildScopeForProfile(Profile) {
    if (!Profile) return '0';
    const Hex = (Value) => (Number(Value || 0) >>> 0).toString(16).padStart(8, '0');
    return `build-${Hex(Profile.position)}-${Hex(Profile.primaryArchetype)}-${Hex(Profile.secondaryArchetype)}`;
}

module.exports = {
    Position,
    PrimaryArchetype,
    SecondaryArchetype,
    ArchetypeCrcs,
    MaxLevelTable,
    ArchetypeIndex,
    ProfileForArchetypes,
    BuildScopeForProfile,
};
