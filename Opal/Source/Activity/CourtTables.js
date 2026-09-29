// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const StageSpots = require('./StageSpots/GamblingCourts2K19');
const Boulevard = require('./StageSpots/BoulevardCourts2K19');
const { Crc32 } = require('../Core/Crc32');

const AnteUpSession = 0x003a190e;
const StageAllcourtsName = { GAMBLING_ONE_V_ONE: 'GAMBLING_ONE_V_ONE_1' };

function StageLowFor(MarkerName) {
    return Crc32(StageAllcourtsName[MarkerName] || MarkerName) >>> 0;
}

function StageGuidFor(MarkerName) {
    return (BigInt(AnteUpSession >>> 0) << 32n) | BigInt(StageLowFor(MarkerName));
}

const Seq = {
    Park: 0x300,
    Stage: 0x400,
    Cages: 0x500,
};

const Room = {
    Park: 0x0108,
    Stage: 0x0100,
    Cages: 0x0104,
};

const Offset = {
    cages: [0, 0, -46034],

    stage: [0, 0, 0],
};

function Place(Pos, OffsetValue) {
    return [Pos[0] + OffsetValue[0], Pos[1] + OffsetValue[1], Pos[2] + OffsetValue[2]];
}

function StageSpotAnchorsByName(OffsetValue) {
    const ByName = {};
    for (const C of StageSpots.GamblingCourts) {
        const PlaceData = (A) => Place(A, OffsetValue);
        ByName[C.name] = {
            SpotAnchors: [
                StageSpots.SpotAnchorsFor(C, 0).map(PlaceData),
                StageSpots.SpotAnchorsFor(C, 1).map(PlaceData),
            ],
            SquadAnchors: StageSpots.StageCourtHasSquad(C) ? StageSpots.SquadAnchorFor(C).map(PlaceData) : null,
            NoSquad: !StageSpots.StageCourtHasSquad(C),
        };
    }
    return ByName;
}

function BoulevardCourts() {
    return Boulevard.BoulevardCourts.map((C, Index) => ({
        Name: C.name,
        Index: Index,
        Guid: C.id,
        CourtId: C.id,
        Pos: C.Pos.slice(),
        MarkerPos: C.Pos.slice(),
        Yaw: ((C.YawDeg || 0) * Math.PI) / 180,
        SpotYaw: 0,
        Squad: undefined,
        NoSquad: !Boulevard.BoulevardCourtHasSquad(C),
        Spots: undefined,
        EdgeSign: undefined,
        CourtType: C.TeamSize === 2 ? 'NBA' : 'SHORT',
        TeamSize: C.TeamSize,
        SpotAnchors: [Boulevard.SpotAnchorsFor(C, 0), Boulevard.SpotAnchorsFor(C, 1)],
        SquadAnchors: Boulevard.BoulevardCourtHasSquad(C) ? [Boulevard.SquadAnchorFor(C)] : null,
    }));
}

function StageCourts() {
    const Anchors = StageSpotAnchorsByName(Offset.stage);
    return Table(StageMarkers, Offset.stage).map((C) => {
        const A = Anchors[C.Name];
        if (!A) return C;
        return {
            ...C,
            SpotAnchors: A.SpotAnchors,
            SquadAnchors: A.SquadAnchors,
            NoSquad: A.NoSquad,
            Guid: StageGuidFor(C.Name),
            CourtId: StageLowFor(C.Name),
        };
    });
}

const CourtId = {};

function TeamSizeFromName(Name) {
    if (/ONE_V_ONE|1V1/.test(Name)) return 1;
    if (/TWO_V_TWO|2V2/.test(Name)) return 2;
    if (/THREE_V_THREE|3V3/.test(Name)) return 3;
    throw new Error(`cannot tell the team size from the court name ${Name}`);
}

const StageMarkers = [
    { Name: 'GAMBLING_ONE_V_ONE', CourtType: 'SHORT', Yaw: 0.0, Pos: [-2.99600005, 0.0, 2834.09106] },
    { Name: 'GAMBLING_THREE_V_THREE_1', CourtType: 'SHORT', Yaw: 1.57079637, Pos: [-3165.97998, 0.0, 5.92000008] },
    { Name: 'GAMBLING_THREE_V_THREE_2', CourtType: 'SHORT', Yaw: 1.57079637, Pos: [0.0, 0.0, 0.0] },
    { Name: 'GAMBLING_THREE_V_THREE_3', CourtType: 'SHORT', Yaw: 1.57079637, Pos: [3179.63696, 0.0, 5.09800005] },
    { Name: 'GAMBLING_THREE_V_THREE_4', CourtType: 'SHORT', Yaw: 1.57079637, Pos: [-2809.62402, 0.0, 2218.22192] },
    { Name: 'GAMBLING_THREE_V_THREE_5', CourtType: 'SHORT', Yaw: 1.57079637, Pos: [2804.68701, 0.0, 2217.59595] },
    { Name: 'GAMBLING_TWO_V_TWO_1', CourtType: 'NBA', Yaw: -1.57079637, Pos: [-2573.71997, 0.0, -2194.08105] },
    { Name: 'GAMBLING_TWO_V_TWO_2', CourtType: 'NBA', Yaw: 1.57079637, Pos: [2564.73096, 0.0, -2186.95605] },
];

const CagesMarkers = [
    { Name: 'SLAMBALL_3V3_TOP_LEFT', CourtType: 'SHORT', Yaw: 0.0, Pos: [524.645874, 0.0, 52626.6367] },
    { Name: 'SLAMBALL_3V3_TOP_RIGHT', CourtType: 'SHORT', Yaw: 0.0, Pos: [524.645996, 0.0, 55226.6367] },
    { Name: 'SLAMBALL_3V3_BOTTOM_LEFT', CourtType: 'SHORT', Yaw: 0.0, Pos: [-1822.11377, 0.0, 52626.6367] },
    { Name: 'SLAMBALL_3V3_BOTTOM_RIGHT', CourtType: 'SHORT', Yaw: 0.0, Pos: [-1822.11365, 0.0, 55226.6367] },
    { Name: 'SLAMBALL_2V2_BOTTOM', CourtType: 'NBA', Yaw: 0.0, Pos: [-1822.02283, 0.0, 58130.8984] },
    { Name: 'SLAMBALL_2V2_TOP', CourtType: 'NBA', Yaw: 0.0, Pos: [524.239624, 0.0, 58131.8437] },
];

const ParkMarkersCaptured = [
    {
        Name: 'PARK_R2_C1',
        Squad: [480, 0, 20],
        CourtType: 'SHORT',
        TeamSize: 3,
        Yaw: 0.0,
        Pos: [-1174.0, 0.0, -1590.0],
    },
    {
        Name: 'PARK_R2_C2',
        Squad: [480, 0, -70],
        CourtType: 'SHORT',
        TeamSize: 3,
        Yaw: 0.0,
        Pos: [-1174.0, 0.0, 1601.0],
    },
    { Name: 'PARK_R3_C1', Squad: [630, 0, 20], CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [1173.0, 0.0, -1590.0] },
    { Name: 'PARK_R3_C2', Squad: [630, 0, -70], CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [1173.0, 0.0, 1601.0] },
    { Name: 'PARK_R4_C1', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [3520.0, 0.0, -1287.1] },
    { Name: 'PARK_R4_C2', CourtType: 'SHORT', TeamSize: 3, Yaw: Math.PI, Pos: [3520.0, 0.0, 1296.0] },
    { Name: 'PARK_R1_C1', NoSquad: true, CourtType: 'SHORT', TeamSize: 3, Yaw: Math.PI, Pos: [-3493.0, 0.0, -1590.0] },
    {
        Name: 'PARK_R1_C2',
        Squad: [320, 0, -70],
        CourtType: 'SHORT',
        TeamSize: 3,
        Yaw: Math.PI,
        Pos: [-3493.0, 0.0, 1601.0],
    },
];

const ParkMarkersFromLevelExport = [
    { Name: 'SHORT_BOTTOM', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [5.65428162, 0.0, 1533.37012] },
    { Name: 'SHORT_BOTTOM_LEFT', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [-2747.99243, 0.0, 1534.17371] },
    { Name: 'SHORT_BOTTOM_RIGHT', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [2766.5249, 0.0, 1535.41614] },
    { Name: 'SHORT_TOP', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [5.65428162, 0.0, -1576.0] },
    { Name: 'SHORT_TOP_LEFT', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [-2747.99243, 0.0, -1575.19] },
    { Name: 'SHORT_TOP_RIGHT', CourtType: 'SHORT', TeamSize: 3, Yaw: 0.0, Pos: [2766.5249, 0.0, -1573.95] },
    { Name: 'HALF_CENTER_BOTTOM', CourtType: 'NBA', TeamSize: 2, Yaw: 0.0, Pos: [2964.3999, 0.0, 8242.28711] },
    { Name: 'HALF_CENTER_TOP', CourtType: 'NBA', TeamSize: 2, Yaw: 0.0, Pos: [2964.3999, 0.0, 4689.5] },
];

function Table(Markers, OffsetValue = [0, 0, 0]) {
    return Markers.map((M, Index) => ({
        Name: M.Name,
        Index: Index,
        Pos: Place(M.Pos, OffsetValue),
        MarkerPos: M.Pos.slice(),
        Yaw: M.Yaw,
        SpotYaw: M.SpotYaw || 0,
        Squad: M.Squad,
        NoSquad: !!M.NoSquad,
        Spots: M.Spots,
        CourtId: CourtId[M.Name] || null,
        EdgeSign: M.EdgeSign,
        CourtType: M.CourtType,
        TeamSize: M.TeamSize || TeamSizeFromName(M.Name),
    }));
}

const Worlds = {
    neighborhood: {
        Courts: BoulevardCourts().map((C) => ({ ...C, RegionType: 0x9705bb0d, SquadRegionType: 0x6291f559 })),
        Room: Room.Park,
        SeqBase: Seq.Park,
        Offset: [0, 0, 0],
    },
    stage: {
        Courts: StageCourts(),
        Room: Room.Stage,
        SeqBase: Seq.Stage,
        Offset: Offset.stage,
    },
    cages: {
        Courts: Table(CagesMarkers, Offset.cages),
        Room: Room.Cages,
        SeqBase: Seq.Cages,
        Offset: Offset.cages,
    },
};

function For(ActivityName) {
    return Worlds[ActivityName] || null;
}

module.exports = {
    Worlds,
    For,
    Table,
    Place,
    TeamSizeFromName,
    CourtId,
    Offset,
    Seq,
    Room,
    AnteUpSession,
    StageLowFor,
    StageGuidFor,
    BoulevardCourts,
    StageCourts,
    StageMarkers,
    CagesMarkers,
    ParkMarkersCaptured,
    ParkMarkersFromLevelExport,
};
