// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0xe857eb5b]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyCareer online remote delete');
}

module.exports = { Build, Delete: Build, EndpointIds, Feature: 'MYCAREER_ONLINE_REMOTE_DELETE_REQUEST', Status };
