// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Deg = Math.PI / 180;

const BoulevardCourts = [
    {
        id: 0xc2aae7de,
        name: 'SHORT_TOP',
        RetailCourtId: 0x7173858e,
        CourtType: 4,
        TeamSize: 3,
        Pos: [0.000122070313, 0.0, -3035.12012],
        YawDeg: 90,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT'],
    },
    {
        id: 0x5ba3b664,
        name: 'SHORT_BOTTOM',
        RetailCourtId: 0x5e251185,
        CourtType: 4,
        TeamSize: 3,
        Pos: [-0.000801086426, 0.0, 3035.11816],
        YawDeg: -90,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0x2ca486f2,
        name: 'SHORT_BOTTOM_RIGHT',
        RetailCourtId: 0x9bb2e938,
        CourtType: 4,
        TeamSize: 3,
        Pos: [2610.23926, 0.0, 1500.0],
        YawDeg: 0,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0xb2c01351,
        name: 'SHORT_TOP_RIGHT',
        RetailCourtId: 0x0884c988,
        CourtType: 4,
        TeamSize: 3,
        Pos: [2610.23926, 0.0, -1499.99963],
        YawDeg: 0,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0xc5c723c7,
        name: 'SHORT_BOTTOM_LEFT',
        RetailCourtId: 0x3f1a324d,
        CourtType: 4,
        TeamSize: 3,
        Pos: [-2600.0, 0.0, 1500.0],
        YawDeg: 180,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0x5cce727d,
        name: 'SHORT_TOP_LEFT',
        RetailCourtId: 0x00c51fc0,
        CourtType: 4,
        TeamSize: 3,
        Pos: [-2599.99902, 0.0, -1499.99963],
        YawDeg: 180,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0xfc0ec110,
        name: 'HALF_CENTER_TOP',
        RetailCourtId: 0xf73eeb26,
        CourtType: 5,
        TeamSize: 2,
        Pos: [0.000995635986, 60.9599991, -1519.86853],
        YawDeg: 180,
        Locations: ['NEARSIDE_RIGHT', 'NEARSIDE_LEFT', 'NEARSIDE_CENTER'],
    },
    {
        id: 0x5fecb833,
        name: 'HALF_CENTER_BOTTOM',
        RetailCourtId: 0x7a5d66df,
        CourtType: 5,
        TeamSize: 2,
        Pos: [0.000995635986, 60.9599991, 1519.86694],
        YawDeg: 0,
        Locations: ['FARSIDE_RIGHT', 'FARSIDE_LEFT', 'FARSIDE_CENTER'],
    },
];

const Step = 120.0;

function RetailLocalBase(Court, Location) {
    const Size = Court.TeamSize;
    const Longitudinal = Size === 3 ? 2255.52001953125 : 1432.56005859375;
    const OnCourtSide = 1524.0 * 0.5 + 80.0;
    const HalfLength = Longitudinal * 0.5;
    const Flip = Size === 3 ? 0.0 : -716.280029296875;
    const GroupSpan = Step * (Size - 1);
    const Near = Location.startsWith('NEARSIDE_');
    const Side = Near ? -OnCourtSide : OnCourtSide;
    let Along;
    if (Location.endsWith('_RIGHT')) Along = HalfLength - 160.0 - GroupSpan + Flip;
    else if (Location.endsWith('_LEFT')) Along = -HalfLength + 160.0 + Flip;
    else if (Location.endsWith('_CENTER')) Along = -GroupSpan * 0.5 + Flip;
    else throw new Error(`boulevard_courts_2k19: unsupported location "${Location}"`);
    return [Side, 0.0, Along];
}

function LocalToWorld(Court, Lx, Lz) {
    const Radians = (Court.YawDeg || 0) * Deg;
    const C = Math.cos(Radians),
        S = Math.sin(Radians);
    return [Court.Pos[0] + Lx * C + Lz * S, Court.Pos[1], Court.Pos[2] - Lx * S + Lz * C];
}

function SpotAnchorsFor(Court, Winding) {
    const Location = Court.Locations[Winding];
    if (!Location) throw new Error(`boulevard_courts_2k19: no location for winding ${Winding} on ${Court.name}`);
    const Base = RetailLocalBase(Court, Location);
    const Out = [];
    for (let K = 0; K < Court.TeamSize; K++) {
        Out.push(LocalToWorld(Court, Base[0], Base[2] + K * Step));
    }
    return Out;
}

function SquadAnchorFor(Court) {
    const Location = Court.Locations.find((L) => L.endsWith('_CENTER'));
    if (!Location) return null;
    const Base = RetailLocalBase(Court, Location);
    return LocalToWorld(Court, Base[0], Base[2]);
}

function BoulevardCourtHasSquad(Court) {
    return Court.Locations.some((L) => L.endsWith('_CENTER'));
}

module.exports = {
    BoulevardCourts,
    Step,
    RetailLocalBase,
    LocalToWorld,
    SpotAnchorsFor,
    SquadAnchorFor,
    BoulevardCourtHasSquad,
};
