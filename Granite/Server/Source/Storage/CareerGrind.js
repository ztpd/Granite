// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Path = require('node:path');

const MaxTotal = 0x7fffffff;
const MaxCounter = 4;

function Clamp(Value, Low, High) {
    return Math.max(Low, Math.min(High, Value));
}

function LoadCareerGrind(File) {
    const Grind = new Map();
    try {
        const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
        if (Raw && typeof Raw === 'object' && !Array.isArray(Raw)) {
            for (const [Key, Value] of Object.entries(Raw)) {
                if (!Value || typeof Value !== 'object') continue;
                const Total = Number(Value.total);
                const Counter = Number(Value.counter);
                if (!Number.isInteger(Total) || !Number.isInteger(Counter)) continue;
                Grind.set(String(Key), { total: Clamp(Total, 0, MaxTotal), counter: Clamp(Counter, 0, MaxCounter) });
            }
        }
    } catch (Failure) {
        if (Failure.code !== 'ENOENT') throw Failure;
    }
    return Grind;
}

function SaveCareerGrind(File, Grind) {
    if (!(Grind instanceof Map)) return;
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(Temporary, `${JSON.stringify(Object.fromEntries(Grind.entries()), null, 2)}\n`, 'utf8');
    Fs.renameSync(Temporary, File);
}

module.exports = { MaxTotal, MaxCounter, Clamp, LoadCareerGrind, SaveCareerGrind };
