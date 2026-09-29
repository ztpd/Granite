// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0xac7546ab]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MPStore overview');
}

module.exports = { Build, Overview: Build, EndpointIds, Feature: 'MPSTORE_HELPER_REQUEST_OVERVIEW_DATA_JOB', Status };
