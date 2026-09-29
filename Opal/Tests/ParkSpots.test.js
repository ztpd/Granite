// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const CourtTables = require('../Source/Activity/CourtTables');
const Courts = require('../Source/Protocol/Courts');

let Passed = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}

function ParkGroups() {
    const World = CourtTables.For('neighborhood');
    Assert.ok(World, 'neighborhood world exists');
    return World.Courts.flatMap((C) => Courts.GroupsFor(C, World.Room, World.SeqBase));
}

const At = (Xs) => Xs.map((P) => P.map((V) => Math.round(V * 10) / 10));

Test('park has 8 retail Boulevard courts', () => {
    const World = CourtTables.For('neighborhood');
    Assert.strictEqual(World.Courts.length, 8);
    Assert.deepStrictEqual(
        World.Courts.map((C) => C.Name),
        [
            'SHORT_TOP',
            'SHORT_BOTTOM',
            'SHORT_BOTTOM_RIGHT',
            'SHORT_TOP_RIGHT',
            'SHORT_BOTTOM_LEFT',
            'SHORT_TOP_LEFT',
            'HALF_CENTER_TOP',
            'HALF_CENTER_BOTTOM',
        ],
    );
});

Test('only SHORT_TOP has no squad mat', () => {
    const World = CourtTables.For('neighborhood');
    Assert.deepStrictEqual(
        World.Courts.filter((C) => C.NoSquad).map((C) => C.Name),
        ['SHORT_TOP'],
    );
});

Test('park yields 23 spot groups', () => {
    const Groups = ParkGroups();
    Assert.strictEqual(Groups.filter((G) => G.Kind === 'gotnext').length, 16);
    Assert.strictEqual(Groups.filter((G) => G.Kind === 'squad').length, 7);
    Assert.strictEqual(Groups.length, 23);
});

Test('SHORT_BOTTOM_LEFT winding trios match the retail bases', () => {
    const Groups = ParkGroups().filter((G) => G.CourtName === 'SHORT_BOTTOM_LEFT');
    const W0 = Groups.find((G) => G.Kind === 'gotnext' && G.Winding === 0);
    const W1 = Groups.find((G) => G.Kind === 'gotnext' && G.Winding === 1);
    Assert.deepStrictEqual(At(W0.Anchors), [
        [-1758, 0, 772.2],
        [-1758, 0, 652.2],
        [-1758, 0, 532.2],
    ]);
    Assert.deepStrictEqual(At(W1.Anchors), [
        [-1758, 0, 2467.8],
        [-1758, 0, 2347.8],
        [-1758, 0, 2227.8],
    ]);
    const Squad = Groups.find((G) => G.Kind === 'squad');
    Assert.deepStrictEqual(At(Squad.Anchors), [[-1758, 0, 1620]]);
});

Test('HALF_CENTER_BOTTOM winding pairs match the retail bases', () => {
    const Groups = ParkGroups().filter((G) => G.CourtName === 'HALF_CENTER_BOTTOM');
    const W0 = Groups.find((G) => G.Kind === 'gotnext' && G.Winding === 0);
    Assert.deepStrictEqual(At(W0.Anchors), [
        [842, 61, 1239.9],
        [842, 61, 1359.9],
    ]);
    const Squad = Groups.find((G) => G.Kind === 'squad');
    Assert.deepStrictEqual(At(Squad.Anchors), [[842, 61, 743.6]]);
});

Test('SHORT spots sit at Y 0 and HALF spots at the retail 60.96 height', () => {
    for (const G of ParkGroups()) {
        const WantY = G.CourtName.startsWith('HALF_') ? 60.9599991 : 0;
        for (const P of G.Anchors) Assert.strictEqual(P[1], WantY, G.Name);
    }
});

process.stdout.write(`\n${Passed} passing\n`);
