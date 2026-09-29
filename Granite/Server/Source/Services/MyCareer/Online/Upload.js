// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const { BuildIdaStub, Status } = require('../../IdaSpecificStub');

const EndpointIds = Object.freeze([0xc5f871c3]);
function Build(Input, Context) {
    return BuildIdaStub(Input, Context, EndpointIds, 'MyCareer online remote upload');
}

module.exports = { Build, Upload: Build, EndpointIds, Feature: 'MYCAREER_ONLINE_REMOTE_UPLOAD_REQUEST', Status };
