// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');
const { GetU64 } = require('../Codec/FieldList');

const Overall = 0xf821a709;

function LoadCareerOveralls(File) {
    const Overalls = new Map();
    try {
        const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
        if (Raw && typeof Raw === 'object' && !Array.isArray(Raw)) {
            for (const [Key, Value] of Object.entries(Raw)) {
                const OverallValue = Number(Value);
                if (Number.isInteger(OverallValue) && OverallValue > 0 && OverallValue <= 99)
                    Overalls.set(String(Key), OverallValue);
            }
        }
    } catch (Failure) {
        if (Failure.code !== 'ENOENT') throw Failure;
    }
    return Overalls;
}

function SaveCareerOveralls(File, Overalls) {
    if (!(Overalls instanceof Map)) return;
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(Temporary, `${JSON.stringify(Object.fromEntries(Overalls.entries()), null, 2)}\n`, 'utf8');
    Fs.renameSync(Temporary, File);
}

function RecordOverall(Fields, Key, Overalls) {
    if (!Key || !(Overalls instanceof Map)) return null;
    const Reported = GetU64(Fields || [], Overall);
    if (Reported === null || Reported <= 0n || Reported > 99n) return null;
    const OverallValue = Number(Reported);
    if (Overalls.get(Key) === OverallValue) return null;
    Overalls.set(Key, OverallValue);
    return OverallValue;
}

module.exports = { Overall, LoadCareerOveralls, SaveCareerOveralls, RecordOverall };
