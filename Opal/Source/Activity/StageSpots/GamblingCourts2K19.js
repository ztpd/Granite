// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../../Core/Log');

const GamblingCourtMarkers = [
    {
        name: 'GAMBLING_ONE_V_ONE',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high_home',
        AwayBasket: null,
        Yaw: 0.0,
        Translate: [-2.99600005, 0.0, 2834.09106],
    },
    {
        name: 'GAMBLING_THREE_V_THREE_1',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high',
        AwayBasket: 'basket_ante_up_high',
        Yaw: 1.57079637,
        Translate: [-3165.97998, 0.0, 5.92000008],
    },
    {
        name: 'GAMBLING_THREE_V_THREE_2',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high5',
        AwayBasket: 'basket_ante_up_high5',
        Yaw: 1.57079637,
        Translate: [0.0, 0.0, 0.0],
    },
    {
        name: 'GAMBLING_THREE_V_THREE_3',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high6',
        AwayBasket: 'basket_ante_up_high6',
        Yaw: 1.57079637,
        Translate: [3179.63696, 0.0, 5.09800005],
    },
    {
        name: 'GAMBLING_THREE_V_THREE_4',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high7',
        AwayBasket: 'basket_ante_up_high7',
        Yaw: 1.57079637,
        Translate: [-2809.62402, 0.0, 2218.22192],
    },
    {
        name: 'GAMBLING_THREE_V_THREE_5',
        CourtType: 'SHORT',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high8',
        AwayBasket: 'basket_ante_up_high8',
        Yaw: 1.57079637,
        Translate: [2804.68701, 0.0, 2217.59595],
    },
    {
        name: 'GAMBLING_TWO_V_TWO_1',
        CourtType: 'NBA',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high_home3',
        AwayBasket: null,
        Yaw: -1.57079637,
        Translate: [-2573.71997, 0.0, -2194.08105],
    },
    {
        name: 'GAMBLING_TWO_V_TWO_2',
        CourtType: 'NBA',
        BasketType: 'NBA_STANCHION',
        NetType: 'CLOTH',
        HomeBasket: 'basket_ante_up_high_home4',
        AwayBasket: null,
        Yaw: 1.57079637,
        Translate: [2564.73096, 0.0, -2186.95605],
    },
];

function TeamSizeFromName(Name) {
    if (Name.includes('ONE_V_ONE')) return 1;
    if (Name.includes('TWO_V_TWO')) return 2;
    if (Name.includes('THREE_V_THREE')) return 3;
    throw new Error(`gambling_courts_2k19: cannot read team size from marker name "${Name}"`);
}

const CourtTypeDims = {
    NBA: { length: 2865.12, Width: 1524.0 },
    SHORT: { length: 1432.56, Width: 1524.0 },
};

function SpotCountForTeamSize(N) {
    return N * 2 + 1;
}

const GamblingCourtSeqBase = 0x0400;

const GamblingCourts = GamblingCourtMarkers.map((M, I) => {
    const TeamSize = TeamSizeFromName(M.name);
    return {
        name: M.name,
        Seq: GamblingCourtSeqBase + I,
        Pos: M.Translate.slice(),
        Yaw: M.Yaw,
        TeamSize,
        Spots: SpotCountForTeamSize(TeamSize),
        CourtType: M.CourtType,
        Dims: CourtTypeDims[M.CourtType],
        HomeBasket: M.HomeBasket,
        AwayBasket: M.AwayBasket,
        BasketType: M.BasketType,
        NetType: M.NetType,
    };
});

const StageSpotLayoutDefaults = {
    Dx3: 880,
    Side3: 700,
    Pair3: 150,
    Dz3: 0,
    Dx2: 880,
    Side2: 700,
    Pair2: 150,
    Dz2: 0,
    Dx1: 880,
    Side1: 400,
    Pair1: 150,
    Dz1: 0,
    EnableSquad: 1,
    SquadOut3: 0,
    SquadAlong3: 0,
    SquadOut2: 0,
    SquadAlong2: 0,
    SquadSpots: 1,
    SquadSpacing: 120,
    SquadOcc: 1,
    SquadYaw3: 0,
    SquadYaw2: 0,
    SquadStep: 100,
    SquadAutoFlip: 1,
    SpotYaw3: 0,
    SpotYaw2: 0,
    SpotYaw1: 0,
    QuadHalf: 200,
    SpotQuadHalf: 200,
};

const StageCourtNudgeDefault = {
    Dx: 0,
    Dz: 0,
    Dx0: 0,
    Dz0: 0,
    Dx1: 0,
    Dz1: 0,
    Side: 0,
    Flip: 0,
    Mirror: 0,
    Decal: 0,
    NoSquad: 0,
};
const StageCourtNudges = {};

function ReadStageSpotLayout() {
    const Layout = { ...StageSpotLayoutDefaults };
    let Raw;
    try {
        Raw = require('fs').readFileSync(require('path').join(__dirname, 'StageSpots.txt'), 'utf8');
    } catch (E) {
        return Layout;
    }
    for (const Line of String(Raw).replace(/^﻿/, '').split(/\r?\n/)) {
        const T = Line.replace(/(^|\s)(#|\/\/).*$/, '').trim();
        if (!T) continue;
        const C = T.match(
            /^([A-Za-z_]\w*)\.(Dx|Dz|Dx0|Dz0|Dx1|Dz1|Side|Flip|Mirror|Decal|NoSquad)\s*[=:]\s*(-?\d+(?:\.\d+)?)$/,
        );
        if (C) {
            const [, Court, Axis, Val] = C;
            (StageCourtNudges[Court] ||= { ...StageCourtNudgeDefault })[Axis] = Number(Val);
            continue;
        }
        const M = T.match(/^([A-Za-z_]\w*)\s*[=:]\s*(-?\d+(?:\.\d+)?)$/);
        if (!M) {
            Log.Verbose(`[stage_courts] StageSpots.txt: ignoring unparseable line "${T}"`);
            continue;
        }
        if (!(M[1] in Layout)) {
            Log.Verbose(`[stage_courts] StageSpots.txt: unknown key "${M[1]}" — ignored`);
            continue;
        }
        Layout[M[1]] = Number(M[2]);
    }
    return Layout;
}

const StageSpotLayout = ReadStageSpotLayout();

function ModeLayoutFor(TeamSize) {
    const L = StageSpotLayout;
    if (TeamSize === 1) return { Dx: L.Dx1, Side: L.Side1, Pair: L.Pair1, Dz: L.Dz1, SquadOut: 0, SquadAlong: 0 };
    if (TeamSize === 2)
        return { Dx: L.Dx2, Side: L.Side2, Pair: L.Pair2, Dz: L.Dz2, SquadOut: L.SquadOut2, SquadAlong: L.SquadAlong2 };
    return { Dx: L.Dx3, Side: L.Side3, Pair: L.Pair3, Dz: L.Dz3, SquadOut: L.SquadOut3, SquadAlong: L.SquadAlong3 };
}

function LocalToWorld(Court, Lx, Lz) {
    const C = Math.cos(Court.Yaw || 0),
        S = Math.sin(Court.Yaw || 0);
    return [Court.Pos[0] + Lx * C + Lz * S, Court.Pos[1], Court.Pos[2] - Lx * S + Lz * C];
}

function SpotAnchorsFor(Court, Winding) {
    const N = Math.max(1, Math.min(3, Court.TeamSize));
    const M = ModeLayoutFor(Court.TeamSize);
    const Nudge = StageCourtNudges[Court.name] || StageCourtNudgeDefault;
    const SideMag = Nudge.Side !== 0 ? Nudge.Side : M.Side;
    const Side = (Winding === 0 ? -1 : +1) * SideMag;
    const SideDx = (Winding === 0 ? Nudge.Dx0 : Nudge.Dx1) || 0;
    const SideDz = (Winding === 0 ? Nudge.Dz0 : Nudge.Dz1) || 0;
    const Sign = Nudge.Flip ? -1 : +1;
    const Mir = Nudge.Mirror ? -1 : +1;
    const Anchors = [];
    for (let I = 0; I < N; I++) {
        const Along = (I - (N - 1) / 2) * M.Pair;
        const Lx = Sign * (M.Dx + Nudge.Dx + SideDx);
        const Lz = Mir * (M.Dz + Nudge.Dz + SideDz + Side + Along);
        Anchors.push(LocalToWorld(Court, Lx, Lz));
    }
    return Anchors;
}

function SquadAnchorFor(Court) {
    const M = ModeLayoutFor(Court.TeamSize);
    const L = StageSpotLayout;
    const Nudge = StageCourtNudges[Court.name] || StageCourtNudgeDefault;
    const Sign = Nudge.Flip ? -1 : +1;
    const Mir = Nudge.Mirror ? -1 : +1;
    const N = Math.max(1, Math.min(3, L.SquadSpots));
    const Lx = Sign * (M.Dx + M.SquadOut + Nudge.Dx);
    const Anchors = [];
    for (let I = 0; I < N; I++) {
        const Along = (I - (N - 1) / 2) * L.SquadSpacing;
        Anchors.push(LocalToWorld(Court, Lx, Mir * (M.Dz + M.SquadAlong + Nudge.Dz + Along)));
    }
    return Anchors;
}

const Deg = Math.PI / 180;

function SquadStepFor(Court) {
    const L = StageSpotLayout;
    if (!L.SquadStep) return null;
    const Nudge = StageCourtNudges[Court.name] || StageCourtNudgeDefault;
    const Extra = ((Court.TeamSize === 2 ? L.SquadYaw2 : L.SquadYaw3) + Nudge.Decal) * Deg;
    const Ang = (Court.Yaw || 0) + (Nudge.Flip ? Math.PI : 0) + Extra;
    return [Math.sin(Ang) * L.SquadStep, 0, Math.cos(Ang) * L.SquadStep];
}

function SquadDecalAngle(Court) {
    const S = SquadStepFor(Court);
    if (!S) return 0;
    return Math.round(Math.atan2(S[0], S[2]) / Deg);
}

function SquadYawFor(Court) {
    return Court.Yaw || 0;
}

function SpotYawFor(Court) {
    const L = StageSpotLayout;
    const Extra = (Court.TeamSize === 1 ? L.SpotYaw1 : Court.TeamSize === 2 ? L.SpotYaw2 : L.SpotYaw3) * Deg;
    return (Court.Yaw || 0) + Extra;
}

function StageCourtHasSquad(Court) {
    if (!StageSpotLayout.EnableSquad) return false;
    const Nudge = StageCourtNudges[Court.name] || StageCourtNudgeDefault;
    return !Nudge.NoSquad;
}

{
    const L = StageSpotLayout;
    Log.Verbose(
        `[stage_courts] SPOT LAYOUT  3v3(dx=${L.Dx3} side=${L.Side3} pair=${L.Pair3} dz=${L.Dz3}) ` +
            `2v2(dx=${L.Dx2} side=${L.Side2} pair=${L.Pair2} dz=${L.Dz2}) ` +
            `1v1(dx=${L.Dx1} side=${L.Side1} dz=${L.Dz1}) ` +
            `squad=${
                L.EnableSquad
                    ? `ON(spots=${L.SquadSpots} occ=${L.SquadOcc} 3v3 out/along=${L.SquadOut3}/${L.SquadAlong3} ` +
                      `2v2 out/along=${L.SquadOut2}/${L.SquadAlong2})`
                    : 'OFF'
            } ` +
            `quadHalf=${L.QuadHalf} spotQuadHalf=${L.SpotQuadHalf}` +
            (Object.keys(StageCourtNudges).length
                ? `\n[stage_courts] PER-COURT NUDGES ` +
                  Object.entries(StageCourtNudges)
                      .map(
                          ([K, V]) =>
                              `${K}(dx=${V.Dx || 0},dz=${V.Dz || 0}` +
                              (V.Flip ? ',FLIP' : '') +
                              (V.Decal ? `,decal=${V.Decal}°` : '') +
                              (V.Mirror ? ',MIRROR' : '') +
                              (V.Side ? `,side=${V.Side}` : '') +
                              (V.Dx0 || V.Dz0 ? ` W0:${V.Dx0 || 0},${V.Dz0 || 0}` : '') +
                              (V.Dx1 || V.Dz1 ? ` W1:${V.Dx1 || 0},${V.Dz1 || 0}` : '') +
                              (V.NoSquad ? ',NOSQUAD' : '') +
                              ')',
                      )
                      .join(' ')
                : ''),
    );
}

module.exports = {
    GamblingCourtMarkers,
    GamblingCourts,
    CourtTypeDims,
    GamblingCourtSeqBase,
    StageSpotLayout,
    StageCourtNudges,
    TeamSizeFromName,
    SpotCountForTeamSize,
    SpotAnchorsFor,
    SquadAnchorFor,
    StageCourtHasSquad,
    SquadYawFor,
    SpotYawFor,
    SquadStepFor,
    SquadDecalAngle,
};
