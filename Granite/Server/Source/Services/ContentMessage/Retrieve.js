// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../IdaSpecificStub');

const EndpointIds = Object.freeze([0xd5c245b1]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'Content message retrieve');
}

module.exports = { Build, Retrieve: Build, EndpointIds, Feature: 'ContentMessageData_Retrieve', Status };
