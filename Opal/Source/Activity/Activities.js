// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Init = require('./Init');
const Worlds = require('../Protocol/Worlds');
const { Crc } = require('../Core/Names');

const Relay = {
    Retired: Init.RetiredRelay,
    Local: {
        Ip: process.env.OPAL_RELAY_HOST || '127.0.0.1',
        Port: Number(process.env.OPAL_RELAY_PORT) || 28091,
    },
};

const Activities = [
    {
        Name: 'neighborhood',
        ActivityKey: 0x3cf672c2,
        WorldKey: Crc('BOULEVARD'),
        SessionId: 1000n,
        IncludeMatchType: false,
        Variant: Init.Variant.Standard,
        Relay: Relay.Local,
    },
    {
        Name: 'stage',
        ActivityKey: Worlds.Activities.GAMBLING,
        WorldKey: Crc('GAMBLING'),
        SessionId: 1002n,
        IncludeMatchType: true,
        Variant: Init.Variant.Standard,
        Relay: Relay.Local,
    },
    {
        Name: 'cages',
        ActivityKey: Worlds.Activities.SLAMBALL,
        WorldKey: Crc('SLAMBALL'),
        SessionId: 1004n,
        IncludeMatchType: true,
        Variant: Init.Variant.Standard,
        Relay: Relay.Local,
    },
    {
        Name: 'mycourt',
        ActivityKey: 0xfeac4070,
        WorldKey: Crc('CRIB'),
        SessionId: 1008n,
        IncludeMatchType: true,
        Variant: Init.Variant.MyCourt,
        Relay: Relay.Local,
    },
    {
        Name: 'prizewheelbuilding',
        ActivityKey: 0x5262997f,
        WorldKey: Crc('PRIZEWHEELBUILDING'),
        SessionId: 1010n,
        IncludeMatchType: true,
        Variant: Init.Variant.Standard,
        Relay: Relay.Local,
    },
];

const ByActivity = new Map();
const ByWorld = new Map();
for (const Activity of Activities) {
    if (Activity.ActivityKey !== null) ByActivity.set(Activity.ActivityKey >>> 0, Activity);
    ByWorld.set(Activity.WorldKey >>> 0, Activity);
}

function Lookup(ActivityKey, WorldKey) {
    if (ActivityKey !== null && ByActivity.has(ActivityKey >>> 0)) {
        return ByActivity.get(ActivityKey >>> 0);
    }
    if (WorldKey !== null && ByWorld.has(WorldKey >>> 0)) {
        return ByWorld.get(WorldKey >>> 0);
    }
    return null;
}

function BuildInit(Activity, Players = null, SelfMachineId = null, RelayToken = null) {
    return Init.Build({
        RelayToken,
        SessionId: Activity.SessionId,
        SessionVerify: Activity.SessionId + 1n,
        IncludeMatchType: Activity.IncludeMatchType,
        Variant: Activity.Variant,
        Relay: Activity.Relay,
        Players,
        SelfMachineId,
    });
}

module.exports = { Activities, Relay, Lookup, BuildInit, ByActivity, ByWorld };
