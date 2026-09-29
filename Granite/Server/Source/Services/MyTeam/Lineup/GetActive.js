// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const JsonBlob = require('../JsonBlob');
const Logger = require('../../../Core/Logger');

const EndpointIds = Object.freeze([0xdb18fc2c]);

const LineupListMember = 'lineup';

const Document = Object.freeze({ [LineupListMember]: [] });

const Routes = Object.freeze(['myteam2k19/get_active_lineup']);

function Resolve(Route) {
    return Routes.includes(Route);
}

function Build() {
    Logger.Verbose('MyTeam2k19/get_active_lineup: no MyTeam cards; answering an empty active lineup');
    return JsonBlob.Reply(Document);
}

module.exports = {
    Build,
    GetActive: Build,
    Resolve,
    EndpointIds,
    LineupListMember,
    Document,
    Routes,
    Feature: 'MYTEAM::LINEUP_MANAGEMENT::GetActiveLineup',
    Status: 'IDA_TRACED_EMPTY_ACTIVE_LINEUP',
};
