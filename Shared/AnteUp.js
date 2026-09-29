// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Config = require('./AnteUp.json');
if (Config.mode !== 'practice')
    throw new Error('Ante-Up only supports practice economics; settlement is not implemented');
const Id = BigInt(Config.gamblingId);
if (Id <= 0n || Id > 0xffffffffffffffffn) throw new Error('Invalid Ante-Up gamblingId');
const Names = new Set(),
    Indices = new Set();
const Courts = Config.courts.map((C) => {
    if (
        !C.name ||
        Names.has(C.name) ||
        Indices.has(C.index) ||
        !Number.isInteger(C.index) ||
        C.index < 0 ||
        C.index >= 64 ||
        !Number.isSafeInteger(C.entryVc) ||
        C.entryVc < 0
    )
        throw new Error('Invalid/duplicate Ante-Up court policy');
    Names.add(C.name);
    Indices.add(C.index);
    return Object.freeze({ ...C });
});
if (!Courts.length) throw new Error('Ante-Up needs a court price table');
module.exports = Object.freeze({
    GamblingId: Id,
    Courts: Object.freeze(Courts),
    ByName: (Name) => Courts.find((C) => C.name === Name),
    ByIndex: (Index) => Courts.find((C) => C.index === Index),
    LimitCount: Math.max(...Courts.map((C) => C.index)) + 1,
});
