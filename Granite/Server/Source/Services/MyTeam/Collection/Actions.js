// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0x3e0d46be, 0x59fa156c, 0xf64c61ab]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyTeam collection actions');
}

module.exports = { Build, Actions: Build, EndpointIds, Feature: 'ADD_TO_COLLECTION/SEND_TO_AUCTION_PILE/SELL', Status };
