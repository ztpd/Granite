// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0x0244196c]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyTeam game setup/session data');
}

module.exports = {
    Build,
    SessionData: Build,
    EndpointIds,
    Feature: 'MYTEAM::GAMESETUP::StartOnlineMyteamGame',
    Status,
};
