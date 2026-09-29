// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Modules = Object.freeze([
    require('../UserContent/Download'),
    require('../UserContent/List'),
    require('../UserContent/Upload'),
    require('../MyTeam/GameSetup/SessionData'),
    require('../Blacktop/PlayWithFriends'),
    require('../MyTeam/Collection/Actions'),
    require('../Career/Upgrades/BadgePrices'),
    require('../Arbitration/Upload'),
    require('../MyCareer/Online/Download'),
    require('../MyCareer/Online/EnumerateVerify'),
    require('../MyCareer/Online/Upload'),
    require('../MyCareer/Online/Delete'),
    require('../ContentMessage/Retrieve'),
    require('../MyTeam/Lineup/GetActive'),
    require('../Store/MPStore/Overview'),
    require('../Store/GetItems'),
    require('../GameLoader/MyCourt/Banners'),
    require('../MyCourt/Endpoints'),
    require('../Gambling/Endpoints'),
    require('../ProAm/Endpoints'),
    require('./Unresolved'),
]);

const ByEndpointId = new Map();
for (const Endpoint of Modules) {
    for (const Id of Endpoint.EndpointIds || []) {
        const Key = Number(Id) >>> 0;
        if (ByEndpointId.has(Key)) throw new Error(`duplicate IDA service id 0x${Key.toString(16).toUpperCase()}`);
        ByEndpointId.set(Key, Endpoint);
    }
}

module.exports = { Modules, ByEndpointId };
