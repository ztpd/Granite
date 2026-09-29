// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0x42ecd753]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'Career upgrades badge prices');
}

module.exports = { Build, BadgePrices: Build, EndpointIds, Feature: 'CAREERUPGRADES_GET_BADGE_PRICES_JOB', Status };
